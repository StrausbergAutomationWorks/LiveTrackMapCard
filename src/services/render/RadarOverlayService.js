import L from "leaflet";
import Logger from "../../util/Logger.js";
import { SOURCES, tilePlan, tilesInView, sourcesForView } from "../radar/RadarSources.js";
import {
  POLL_MS, parseRainViewer, parseJma, parseGeoMetCaps, parseNowCoastCaps,
  computedFiveMinute, isFresh, isoTime,
} from "../radar/RadarFrames.js";

/**
 * The weather radar overlay (10_SEED/06_MAP_CONTRACT_OVERLAYS.md D13,
 * backlog 280): ONE tile layer, one checkbox, the sharpest source per whole
 * tile, RainViewer elsewhere. Drawn in a pane of its own between the tiles
 * and the overlay pane, so it sits over every base and overlay tile, under
 * the alert fills (D12) and every marker, and outside the dark-mode filter.
 * Nothing here names an integration; relays are found by attribute shape.
 */

/** The checkbox label. */
export const RADAR_NAME = "Weather radar";

/** The pane the radar draws in. */
export const RADAR_PANE = "ltmcRadar";

/** How often the service looks at the clock and the view. */
export const TICK_MS = 30 * 1000;

/** A new frame waits at most this long for its tiles before it is shown anyway. */
export const SWAP_TIMEOUT_MS = 30 * 1000;

/** A frame list that has not answered by now is given up on until its next turn. */
export const FETCH_TIMEOUT_MS = 20 * 1000;

/** A signed relay path is asked for with this lifetime, and reused for 90% of it. */
export const SIGN_SECONDS = 600;

/**
 * Defaults; `weather_radar` in the card config overrides each. Opacity is
 * provisional until Lee picks from pictures (D13 "Drawing" item 2). The
 * scheme is RainViewer's URL colour parameter (D13 item 6).
 */
export const DEFAULT_RADAR = Object.freeze({ enabled: true, opacity: 0.65, show: true, scheme: 2, order: null });

/**
 * @param {*} v
 * @returns {boolean}
 */
function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * `weather_radar`: absent or true offers the overlay with D13's defaults;
 * false turns it off (no checkbox, no fetch); a mapping overrides `opacity`,
 * `show` (the checkbox's start state), `rainviewer_scheme` and `sources`
 * (ids to keep, in trying order; a relay by its own `id`).
 * @param {*} input
 * @returns {{enabled: boolean, opacity: number, show: boolean, scheme: number, order: ?string[]}}
 */
export function parseRadarOption(input) {
  if (input === undefined || input === null || input === true || input === "auto") return { ...DEFAULT_RADAR };
  if (input === false || input === "off") return { ...DEFAULT_RADAR, enabled: false };
  const o = { ...DEFAULT_RADAR };
  if (!isObj(input)) {
    Logger.warn("[Radar] weather_radar ignored: expected true, false or a mapping", input);
    return o;
  }
  if (typeof input.opacity === "number" && Number.isFinite(input.opacity) && input.opacity >= 0 && input.opacity <= 1) o.opacity = input.opacity;
  if (typeof input.show === "boolean") o.show = input.show;
  if (Number.isInteger(input.rainviewer_scheme) && input.rainviewer_scheme >= 0 && input.rainviewer_scheme <= 8) o.scheme = input.rainviewer_scheme;
  if (Array.isArray(input.sources)) {
    o.order = [...new Set(input.sources.filter((s) => typeof s === "string" && s.trim() !== "").map((s) => s.trim()))];
  }
  return o;
}

/**
 * @param {string} s
 * @returns {string} HTML-escaped
 */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * A relay from an entity state (D13 "Relays"), or null when it cannot be
 * used: entity unavailable/unknown, `radar_relay` not a mapping, a field
 * missing or malformed, or a frame-only relay (no `tiles`).
 * @param {object} state
 * @returns {?object} a source, kind "relay", with its frame
 */
export function parseRelay(state) {
  if (!state || state.state === "unavailable" || state.state === "unknown") return null;
  const r = state.attributes?.radar_relay;
  if (!isObj(r)) return null;
  if (typeof r.id !== "string" || !/^[a-z0-9_-]{1,32}$/.test(r.id)) return null;
  if (typeof r.tiles !== "string" || !r.tiles.startsWith("/") || r.tiles.startsWith("//")) return null;
  if (!["{z}", "{x}", "{y}"].every((k) => r.tiles.includes(k))) return null;
  const time = isoTime(r.time);
  if (!Number.isFinite(time)) return null;
  const b = r.bounds;
  if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [w, s, e, n] = b;
  if (!(w < e && s < n && w >= -180 && e <= 180 && s >= -90 && n <= 90)) return null;
  if (!Number.isInteger(r.max_native_zoom) || r.max_native_zoom < 0 || r.max_native_zoom > 22) return null;
  return {
    id: `relay:${r.id}`,
    relayId: r.id,
    kind: "relay",
    tiles: r.tiles,
    boxes: [{ w, e, s, n }],
    maxNativeZoom: r.max_native_zoom,
    credit: typeof r.attribution === "string" && r.attribution.trim() !== "" ? esc(r.attribution.trim()) : esc(r.id),
    relayFrame: { key: r.time, time },
  };
}

/**
 * Every usable relay in the states, by attribute shape (no entity id or
 * domain in code). An entity with a `radar_relay` that does not parse is
 * reported once per page by the caller.
 * @param {object} states hass.states
 * @returns {{relays: object[], malformed: string[]}}
 */
export function discoverRelays(states) {
  const relays = [];
  const malformed = [];
  const seen = new Set();
  for (const id of Object.keys(states ?? {}).sort()) {
    const st = states[id];
    if (st?.attributes?.radar_relay === undefined) continue;
    const relay = parseRelay(st);
    if (!relay) {
      if (st.state !== "unavailable" && st.state !== "unknown") malformed.push(id);
      continue;
    }
    if (seen.has(relay.id)) continue;
    seen.add(relay.id);
    relays.push(relay);
  }
  return { relays, malformed };
}

/**
 * The trying order: relays first (D13 row 1), then the built-in table, both
 * filtered and reordered by `sources` when given.
 * @param {object[]} relays
 * @param {?string[]} order
 * @returns {object[]}
 */
export function orderSources(relays, order) {
  const all = [...relays, ...SOURCES];
  if (!order) return all;
  const byName = new Map(all.map((s) => [s.kind === "relay" ? s.relayId : s.id, s]));
  return order.map((n) => byName.get(n)).filter(Boolean);
}

/**
 * Place the radar pane right after the tile pane, before the overlay pane:
 * stacking is DOM order in this card (`.leaflet-pane { z-index: 0 }`), and
 * where createPane() puts it (after the marker pane) would draw radar over
 * every marker. Outside the tile pane, so the dark filter does not reach it.
 * @param {object} map
 * @returns {?HTMLElement} the pane
 */
export function placeRadarPane(map) {
  const pane = map.getPane(RADAR_PANE) ?? map.createPane(RADAR_PANE);
  const tiles = map.getPane("tilePane");
  if (tiles?.parentNode && pane.previousSibling !== tiles) {
    tiles.parentNode.insertBefore(pane, tiles.nextSibling);
  }
  pane.style.pointerEvents = "none";
  return pane;
}

let GridClass = null;
/**
 * The grid layer class, made on first use (Leaflet is mocked in tests).
 * Every tile is a div holding at most one image: the source's tile at its
 * native zoom, scaled and offset when the display zoom is beyond it. An
 * image that fails to load, or is not an image (GeoMet answers XML off its
 * grid), is removed: the tile stays blank, never a broken-image icon.
 * @returns {Function}
 */
export function radarGridClass() {
  if (GridClass) return GridClass;
  GridClass = L.GridLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement("div");
      tile.style.overflow = "hidden";
      let plan = null;
      try { plan = this.options.plan(coords); } catch (e) { Logger.error("[Radar] tile plan", e); }
      if (!plan) {
        setTimeout(() => done(null, tile), 0);
        return tile;
      }
      const img = document.createElement("img");
      img.alt = "";
      img.setAttribute("role", "presentation");
      img.draggable = false;
      const size = 256 * plan.scale;
      img.style.cssText = `position:absolute;left:${-plan.offX * 256}px;top:${-plan.offY * 256}px;width:${size}px;height:${size}px;max-width:none;pointer-events:none;`;
      let settled = false;
      const finish = () => { if (!settled) { settled = true; done(null, tile); } };
      img.onload = finish;
      img.onerror = () => { img.remove(); finish(); };
      tile.appendChild(img);
      if (plan.relay) {
        Promise.resolve(this.options.sign(plan.url))
          .then((u) => { if (u) img.src = u; else img.onerror(); })
          .catch(() => img.onerror());
      } else {
        img.src = plan.url;
      }
      return tile;
    },
  });
  return GridClass;
}

export default class RadarOverlayService {
  /**
   * @param {object} map Leaflet map
   * @param {*} option the card's `weather_radar`
   * @param {{addOverlay: Function, removeOverlay: Function}} overlays the layer control (TileLayersService)
   * @param {{fetch?: Function, now?: Function, setInterval?: Function, clearInterval?: Function, setTimeout?: Function, clearTimeout?: Function}} [deps] for tests
   */
  constructor(map, option, overlays, deps = {}) {
    this.map = map;
    this.opt = parseRadarOption(option);
    this.overlays = overlays;
    this.fetch = deps.fetch ?? ((...a) => globalThis.fetch(...a));
    this.now = deps.now ?? (() => Date.now());
    this.setInterval = deps.setInterval ?? ((f, ms) => globalThis.setInterval(f, ms));
    this.clearInterval = deps.clearInterval ?? ((h) => globalThis.clearInterval(h));
    this.setTimeout = deps.setTimeout ?? ((f, ms) => globalThis.setTimeout(f, ms));
    this.clearTimeout = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h));
    this.hass = null;
    /** Fetched frames by source id; computed and relay frames are not kept here. */
    this.frames = new Map();
    this.nextAt = new Map();
    this.inflight = new Map();
    this.relays = [];
    this.relaySig = "[]";
    this.warned = new Set();
    this.signed = new Map();
    this.group = null;
    this.layer = null;
    this.pending = null;
    /** What the newest layer (pending or shown) draws with. */
    this.snap = null;
    this.credits = new Set();
    this.on = false;
    this.timer = null;
    this.disposed = false;
    this._onMove = () => this._refresh();
  }

  /** Create the checkbox (and, if it starts ticked, the layer). Never throws. */
  setup() {
    if (!this.opt.enabled || this.disposed) return;
    try {
      placeRadarPane(this.map);
      this.group = L.layerGroup([]);
      this.group.on("add", () => this._start());
      this.group.on("remove", () => this._stop());
      this.map.on("moveend", this._onMove);
      this.overlays.addOverlay(this.group, RADAR_NAME, this.opt.show);
    } catch (e) {
      Logger.error("[Radar] setup failed; map unaffected", e);
    }
  }

  /**
   * Called on every card render: picks up relays. Never throws.
   * @param {object} hass
   */
  render(hass) {
    if (this.disposed || !this.opt.enabled) return;
    try {
      if (hass) this.hass = hass;
      const { relays, malformed } = discoverRelays(this.hass?.states);
      for (const id of malformed) this._warnOnce(`relay:${id}`, `[Radar] ${id} has a radar_relay that cannot be used; ignored`);
      const sig = JSON.stringify(relays.map((r) => [r.id, r.tiles, r.relayFrame.key, r.boxes, r.maxNativeZoom, r.credit]));
      if (sig !== this.relaySig) {
        this.relaySig = sig;
        this.relays = relays;
        if (this.on) this._refresh();
      }
    } catch (e) {
      Logger.error("[Radar] render failed; markers unaffected", e);
    }
  }

  /** @returns {object[]} sources in trying order */
  _sources() {
    return orderSources(this.relays, this.opt.order);
  }

  /**
   * The frame each source would draw with now, when usable.
   * @returns {Map<string, object>}
   */
  _usableFrames() {
    const now = this.now();
    const out = new Map();
    for (const s of this._sources()) {
      let f;
      if (s.kind === "relay") f = s.relayFrame;
      else if (s.frame === "computed5") f = computedFiveMinute(now);
      else f = this.frames.get(s.id);
      if (isFresh(f, now)) out.set(s.id, f);
    }
    return out;
  }

  /** @returns {{x: number, y: number}[]} with the zoom the grid draws at */
  _view() {
    const z = Math.round(this.map.getZoom());
    const pb = this.map.getPixelBounds();
    const scale = this.map.getZoomScale(z, this.map.getZoom());
    const px = { minX: pb.min.x * scale, minY: pb.min.y * scale, maxX: pb.max.x * scale, maxY: pb.max.y * scale };
    return { z, tiles: tilesInView(z, px) };
  }

  _start() {
    if (this.disposed || this.on) return;
    this.on = true;
    this.timer = this.setInterval(() => this._refresh(), TICK_MS);
    this._refresh();
  }

  _stop() {
    this.on = false;
    if (this.timer !== null) { this.clearInterval(this.timer); this.timer = null; }
    for (const ctl of this.inflight.values()) { try { ctl?.abort(); } catch { /* nothing */ } }
    this.inflight.clear();
    this._dropPending();
    if (this.layer) { this.group?.removeLayer(this.layer); this.layer = null; }
    this.snap = null;
    this._setCredits(new Set());
  }

  /** Fetch what the view needs and is due, swap if the drawn frames changed, update credits. */
  _refresh() {
    if (!this.on || this.disposed) return;
    try {
      const sources = this._sources();
      const usable = this._usableFrames();
      const { z, tiles } = this._view();
      const { drawing, wanted } = sourcesForView(z, tiles, sources, (s) => usable.has(s.id));
      const now = this.now();
      for (const s of sources) {
        if (!wanted.has(s.id) || !s.list || this.inflight.has(s.id)) continue;
        if ((this.nextAt.get(s.id) ?? 0) > now) continue;
        this._fetchFrame(s);
      }
      const rv = this.frames.get("rainviewer");
      if (wanted.has("rainviewer") && rv && !usable.has("rainviewer")) {
        this._warnOnce("rv-stale", "[Radar] RainViewer's newest frame is over 30 minutes old: no radar where it is the source");
      }
      // No new layer while a frame list is still on its way: MEASURED 2026-10-06, a cold
      // view over Florida otherwise drew nowCOAST (whose list answered first) and then
      // GeoMet, fetching 26 nowCOAST tiles (618 KB at z9) only to throw them away. The
      // last list to settle refreshes again (its finally), so the layer follows at once.
      if (this.inflight.size === 0) {
        this._swapIfChanged(usable, drawing, wanted);
        this._setCredits(drawing);
      }
    } catch (e) {
      Logger.error("[Radar] refresh failed; map unaffected", e);
    }
  }

  /** @param {object} s a listed source */
  _fetchFrame(s) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    this.inflight.set(s.id, ctl);
    this.nextAt.set(s.id, this.now() + (POLL_MS[s.id] ?? 5 * 60 * 1000));
    const json = s.frame === "rainviewer" || s.frame === "jma";
    let timedOut = false;
    const timer = this.setTimeout(() => { timedOut = true; try { ctl?.abort(); } catch { /* nothing */ } }, FETCH_TIMEOUT_MS);
    let req;
    try {
      req = Promise.resolve(this.fetch(s.list, { signal: ctl?.signal, credentials: "omit" }));
    } catch (e) {
      req = Promise.reject(e);
    }
    req
      .then((r) => {
        if (!r || !r.ok) throw new Error(`HTTP ${r?.status}`);
        return json ? r.json() : r.text();
      })
      .then((body) => {
        const parse = { rainviewer: parseRainViewer, jma: parseJma, geomet: parseGeoMetCaps, nowcoast: parseNowCoastCaps }[s.frame];
        const f = parse ? parse(body) : null;
        if (!f) throw new Error("no frame in the answer");
        this.frames.set(s.id, f);
      })
      .catch((e) => {
        if (e?.name === "AbortError" && !timedOut) return;
        const why = timedOut ? `no answer in ${FETCH_TIMEOUT_MS / 1000} s` : (e?.message ?? e);
        this._warnOnce(`fetch:${s.id}`, `[Radar] ${s.id} frame list not read (${why}); its tiles fall to the next source`);
      })
      .finally(() => {
        this.clearTimeout(timer);
        if (this.inflight.get(s.id) === ctl) this.inflight.delete(s.id);
        if (this.on && !this.disposed) this._refresh();
      });
  }

  /**
   * Whether the newest layer is out of date for THIS view: a source drawing on
   * screen has a newer frame, a source the layer drew with is no longer usable
   * where a visible tile wants it, or the relays changed. Sources off screen do
   * not count: MEASURED 2026-10-06, FMI's and DWD's computed frames rolling
   * over every 5 minutes otherwise rebuilt the layer over Florida for nothing.
   * @param {Map<string, object>} usable
   * @param {Set<string>} drawing
   * @param {Set<string>} wanted
   * @returns {boolean}
   */
  _outOfDate(usable, drawing, wanted) {
    const snap = this.snap;
    if (!snap) return true;
    if (snap.relaySig !== this.relaySig) return true;
    for (const id of drawing) if (snap.frames.get(id)?.key !== usable.get(id)?.key) return true;
    for (const id of snap.frames.keys()) if (wanted.has(id) && !usable.has(id)) return true;
    return false;
  }

  /**
   * A new grid layer when the frames a visible tile would draw with have
   * changed. The new layer loads at opacity 0 and is shown on its `load`,
   * then the old one is dropped: never a blank between frames, never `redraw()`.
   * @param {Map<string, object>} usable
   * @param {Set<string>} drawing
   * @param {Set<string>} wanted
   */
  _swapIfChanged(usable, drawing, wanted) {
    if (!this._outOfDate(usable, drawing, wanted)) return;
    const snap = { sources: this._sources(), frames: new Map(usable), scheme: this.opt.scheme, relaySig: this.relaySig };
    this.snap = snap;
    const Grid = radarGridClass();
    const first = !this.layer;
    const layer = new Grid({
      pane: RADAR_PANE,
      tileSize: 256,
      opacity: first ? this.opt.opacity : 0,
      updateWhenZooming: false,
      keepBuffer: 1,
      plan: (c) => tilePlan(c.z, c.x, c.y, snap.sources, snap.frames, { scheme: snap.scheme }),
      sign: (path) => this._sign(path),
    });
    if (first) {
      this.layer = layer;
      this.group.addLayer(layer);
      return;
    }
    this._dropPending();
    const show = () => {
      if (this.pending?.layer !== layer) return;
      this.clearTimeout(this.pending.timer);
      this.pending = null;
      layer.setOpacity(this.opt.opacity);
      if (this.layer) this.group.removeLayer(this.layer);
      this.layer = layer;
    };
    this.pending = { layer, timer: this.setTimeout(show, SWAP_TIMEOUT_MS) };
    layer.once("load", show);
    this.group.addLayer(layer);
  }

  _dropPending() {
    if (!this.pending) return;
    this.clearTimeout(this.pending.timer);
    this.group?.removeLayer(this.pending.layer);
    this.pending = null;
  }

  /**
   * A relay tile's path, signed by Home Assistant (`auth/sign_path`): a relay
   * spends the user's key and must not be open to anyone who can reach HA.
   * @param {string} path
   * @returns {Promise<?string>}
   */
  async _sign(path) {
    const now = this.now();
    const hit = this.signed.get(path);
    if (hit && hit.until > now) return hit.url;
    if (typeof this.hass?.callWS !== "function") return null;
    const r = await this.hass.callWS({ type: "auth/sign_path", path, expires: SIGN_SECONDS });
    const url = typeof r?.path === "string" ? r.path : null;
    if (url) {
      if (this.signed.size > 2000) this.signed.clear();
      this.signed.set(path, { url, until: now + SIGN_SECONDS * 900 });
    }
    return url;
  }

  /**
   * The attribution line carries the credit of every source with a tile in
   * view (D13), and nothing once the overlay is off.
   * @param {Set<string>} ids
   */
  _setCredits(ids) {
    const ctl = this.map?.attributionControl;
    const byId = new Map(this._sources().map((s) => [s.id, s.credit]));
    const want = new Set([...ids].map((id) => byId.get(id)).filter(Boolean));
    for (const c of this.credits) if (!want.has(c)) ctl?.removeAttribution(c);
    for (const c of want) if (!this.credits.has(c)) ctl?.addAttribution(c);
    this.credits = want;
  }

  /**
   * @param {string} key
   * @param {string} msg
   */
  _warnOnce(key, msg) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    Logger.warn(msg);
  }

  /** Teardown: stop timers, abort fetches, remove the layer, checkbox and pane. */
  cleanup() {
    if (this.disposed) return;
    try {
      this._stop();
      this.map?.off("moveend", this._onMove);
      if (this.group) {
        this.overlays?.removeOverlay(this.group);
        this.group.remove();
      }
      const pane = this.map?.getPane?.(RADAR_PANE);
      pane?.remove?.();
    } catch (e) {
      Logger.error("[Radar] cleanup", e);
    }
    this.disposed = true;
  }
}
