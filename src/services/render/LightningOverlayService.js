import L from "leaflet";
import Logger from "../../util/Logger.js";
import { RADAR_PANE } from "./RadarOverlayService.js";
import { isoTime } from "../radar/RadarFrames.js";

/**
 * The lightning overlay (10_SEED/06_MAP_CONTRACT_OVERLAYS.md D14, Live Track
 * Weather item 304): NOAA nowCOAST's 15-minute lightning strike density, one
 * WMS layer, one checkbox. Drawn in a pane of its own right above the radar's,
 * so it sits over the radar and every tile, under the alert fills (D12) and
 * every marker, and outside the dark-mode filter. The newest frame only, also
 * while the radar loops (D14 "Frames").
 */

/** The checkbox label. */
export const LIGHTNING_NAME = "Lightning";

/** The pane the lightning draws in. */
export const LIGHTNING_PANE = "ltmcLightning";

/** nowCOAST's lightning WMS and its one layer (D14, measured 2026-10-27). */
export const LIGHTNING_WMS = "https://nowcoast.noaa.gov/geoserver/observations/lightning_detection/ows";
export const LIGHTNING_LAYER = "ldn_lightning_strike_density";
export const LIGHTNING_CAPS = `${LIGHTNING_WMS}?service=WMS&version=1.3.0&request=GetCapabilities`;

/**
 * Where the layer has data: its capabilities' EX_GeographicBoundingBox,
 * 25 S to 80 N at every longitude (NLDN and GLD360). No tile is asked for
 * outside it, and its credit shows only while the view overlaps it.
 */
export const LIGHTNING_BOUNDS = Object.freeze({ w: -180, e: 180, s: -25, n: 80 });

/**
 * The data are an 8 km grid drawn as smooth contours: a z8 tile scaled 4x
 * differed from the 16 real z10 tiles in 0.36% of pixels (measured
 * 2026-10-27), so nothing above z8 is ever requested.
 */
export const LIGHTNING_MAX_NATIVE_ZOOM = 8;

/** The frame list is read this often while the overlay is on. */
export const LIGHTNING_POLL_MS = 5 * 60 * 1000;

/** A newest frame older than this is treated as down: nothing is drawn (D14 "Stale"). */
export const LIGHTNING_STALE_MS = 45 * 60 * 1000;

/** How often the service looks at the clock. */
export const TICK_MS = 30 * 1000;

/** A new frame waits at most this long for its tiles before it is shown anyway. */
export const SWAP_TIMEOUT_MS = 30 * 1000;

/** A frame list that has not answered by now is given up on until its next turn. */
export const FETCH_TIMEOUT_MS = 20 * 1000;

/** The credit line while lightning is drawn (D14 "Credit"). */
export const LIGHTNING_CREDIT = "Lightning: NOAA nowCOAST";

/**
 * A 1 px dark ring round every strike cell. MEASURED 2026-10-27: the
 * commonest class, the lowest density, is cream (255, 255, 204), fully
 * opaque, on OSM land of (242, 239, 233), so without a ring light strikes
 * vanish on the light map.
 */
export const LIGHTNING_OUTLINE = "drop-shadow(0 0 1px rgba(0, 0, 0, 0.85))";

/**
 * Defaults; `lightning` in the card config overrides each. Opacity 0.6
 * (Lee, 2026-10-27 02:24: "a bit more transparent so you can read the map
 * underneath"), from pictures of 0.85, 0.7, 0.6 and 0.5 over a storm.
 */
export const DEFAULT_LIGHTNING = Object.freeze({ enabled: true, opacity: 0.6, show: true, outline: true });

/**
 * @param {*} v
 * @returns {boolean}
 */
function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * `lightning`: absent or true offers the overlay with D14's defaults; false
 * turns it off (no checkbox, no fetch); a mapping overrides `opacity`,
 * `show` (the checkbox's start state) and `outline`.
 * @param {*} input
 * @returns {{enabled: boolean, opacity: number, show: boolean, outline: boolean}}
 */
export function parseLightningOption(input) {
  if (input === undefined || input === null || input === true || input === "auto") return { ...DEFAULT_LIGHTNING };
  if (input === false || input === "off") return { ...DEFAULT_LIGHTNING, enabled: false };
  const o = { ...DEFAULT_LIGHTNING };
  if (!isObj(input)) {
    Logger.warn("[Lightning] lightning ignored: expected true, false or a mapping", input);
    return o;
  }
  if (typeof input.opacity === "number" && Number.isFinite(input.opacity) && input.opacity >= 0 && input.opacity <= 1) o.opacity = input.opacity;
  if (typeof input.show === "boolean") o.show = input.show;
  if (typeof input.outline === "boolean") o.outline = input.outline;
  return o;
}

/**
 * The newest frame from nowCOAST's capabilities: the `default` of the time
 * Dimension inside the lightning layer's own Layer element.
 * @param {string} text
 * @returns {?{key: string, time: number}}
 */
export function parseLightningCaps(text) {
  if (typeof text !== "string") return null;
  const at = text.indexOf(`<Name>${LIGHTNING_LAYER}</Name>`);
  if (at < 0) return null;
  const rest = text.slice(at);
  const end = rest.indexOf("</Layer>");
  const own = end < 0 ? rest : rest.slice(0, end);
  const m = own.match(/<Dimension\b[^>]*\bname="time"[^>]*>/);
  if (!m) return null;
  const d = m[0].match(/\bdefault="([^"]+)"/);
  if (!d) return null;
  const time = isoTime(d[1]);
  return Number.isFinite(time) ? { key: d[1], time } : null;
}

/**
 * @param {?{time: number}} frame
 * @param {number} now
 * @returns {boolean} whether the frame can be drawn
 */
export function lightningFresh(frame, now) {
  return !!frame && Number.isFinite(frame.time) && now - frame.time <= LIGHTNING_STALE_MS;
}

/**
 * Whether a view overlaps the covered band.
 * @param {?{getSouth: Function, getNorth: Function}} b the map's bounds
 * @returns {boolean}
 */
export function viewCovered(b) {
  if (!b || typeof b.getSouth !== "function") return false;
  return b.getSouth() < LIGHTNING_BOUNDS.n && b.getNorth() > LIGHTNING_BOUNDS.s;
}

/**
 * The lightning pane: right after the radar pane when there is one, else
 * right after the tile pane; before the overlay and marker panes either way.
 * @param {object} map
 * @param {boolean} outline
 * @returns {HTMLElement}
 */
export function placeLightningPane(map, outline = true) {
  const pane = map.getPane(LIGHTNING_PANE) ?? map.createPane(LIGHTNING_PANE);
  const after = map.getPane(RADAR_PANE) ?? map.getPane("tilePane");
  if (after?.parentNode && pane.previousSibling !== after) {
    after.parentNode.insertBefore(pane, after.nextSibling);
  }
  pane.style.pointerEvents = "none";
  pane.style.filter = outline ? LIGHTNING_OUTLINE : "";
  return pane;
}

/**
 * The WMS tile layer for one frame.
 * @param {string} key the frame time, as the capabilities wrote it
 * @param {number} opacity
 * @returns {object} a Leaflet layer
 */
export function lightningLayer(key, opacity) {
  const b = LIGHTNING_BOUNDS;
  return L.tileLayer.wms(LIGHTNING_WMS, {
    layers: LIGHTNING_LAYER,
    styles: "",
    format: "image/png",
    transparent: true,
    version: "1.3.0",
    // Every request carries its frame (D13's rule): a new frame is a new URL.
    time: key,
    pane: LIGHTNING_PANE,
    opacity,
    maxNativeZoom: LIGHTNING_MAX_NATIVE_ZOOM,
    maxZoom: 24,
    bounds: L.latLngBounds([b.s, b.w], [b.n, b.e]),
    updateWhenZooming: false,
    keepBuffer: 1,
  });
}

export default class LightningOverlayService {
  /**
   * @param {object} map Leaflet map
   * @param {*} option the card's `lightning`
   * @param {{addOverlay: Function, removeOverlay: Function}} overlays the layer control (TileLayersService)
   * @param {{fetch?: Function, now?: Function, setInterval?: Function, clearInterval?: Function, setTimeout?: Function, clearTimeout?: Function}} [deps] for tests
   */
  constructor(map, option, overlays, deps = {}) {
    this.map = map;
    this.opt = parseLightningOption(option);
    this.overlays = overlays;
    this.fetch = deps.fetch ?? ((...a) => globalThis.fetch(...a));
    this.now = deps.now ?? (() => Date.now());
    this.setInterval = deps.setInterval ?? ((f, ms) => globalThis.setInterval(f, ms));
    this.clearInterval = deps.clearInterval ?? ((h) => globalThis.clearInterval(h));
    this.setTimeout = deps.setTimeout ?? ((f, ms) => globalThis.setTimeout(f, ms));
    this.clearTimeout = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h));
    this.group = null;
    this.layer = null;
    this.pending = null;
    this.frame = null;
    this.nextAt = 0;
    this.inflight = null;
    this.credited = false;
    this.warned = new Set();
    this.on = false;
    this.timer = null;
    this.disposed = false;
    this._onMove = () => this._credit();
  }

  /** Create the checkbox (and, if it starts ticked, the layer). Never throws. */
  setup() {
    if (!this.opt.enabled || this.disposed) return;
    try {
      placeLightningPane(this.map, this.opt.outline);
      this.group = L.layerGroup([]);
      this.group.on("add", () => this._start());
      this.group.on("remove", () => this._stop());
      this.map.on("moveend", this._onMove);
      this.overlays.addOverlay(this.group, LIGHTNING_NAME, this.opt.show);
    } catch (e) {
      Logger.error("[Lightning] setup failed; map unaffected", e);
    }
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
    try { this.inflight?.abort(); } catch { /* nothing */ }
    this.inflight = null;
    this._dropPending();
    if (this.layer) { this.group?.removeLayer(this.layer); this.layer = null; }
    this.shownKey = null;
    this._credit();
  }

  /** Read the frame list when due; draw the newest fresh frame, or nothing. */
  _refresh() {
    if (!this.on || this.disposed) return;
    try {
      const now = this.now();
      if (!this.inflight && this.nextAt <= now) this._fetchFrame();
      if (this.frame && !lightningFresh(this.frame, now)) {
        this._warnOnce("stale", "[Lightning] nowCOAST's newest lightning frame is over 45 minutes old: none is drawn");
        this._dropPending();
        if (this.layer) { this.group.removeLayer(this.layer); this.layer = null; }
        this.shownKey = null;
      } else if (this.frame && this.frame.key !== this.shownKey) {
        this._swap(this.frame.key);
      }
      this._credit();
    } catch (e) {
      Logger.error("[Lightning] refresh failed; map unaffected", e);
    }
  }

  _fetchFrame() {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    this.inflight = ctl ?? { abort() {} };
    this.nextAt = this.now() + LIGHTNING_POLL_MS;
    let timedOut = false;
    const timer = this.setTimeout(() => { timedOut = true; try { ctl?.abort(); } catch { /* nothing */ } }, FETCH_TIMEOUT_MS);
    const mine = this.inflight;
    let req;
    try {
      // no-cache: the capabilities say max-age=600, longer than a frame is fresh news.
      req = Promise.resolve(this.fetch(LIGHTNING_CAPS, { signal: ctl?.signal, credentials: "omit", cache: "no-cache" }));
    } catch (e) {
      req = Promise.reject(e);
    }
    req
      .then((r) => {
        if (!r || !r.ok) throw new Error(`HTTP ${r?.status}`);
        return r.text();
      })
      .then((body) => {
        const f = parseLightningCaps(body);
        if (!f) throw new Error("no frame in the answer");
        // A failed or older answer never replaces a frame already held.
        if (!this.frame || f.time >= this.frame.time) this.frame = f;
      })
      .catch((e) => {
        if (e?.name === "AbortError" && !timedOut) return;
        const why = timedOut ? `no answer in ${FETCH_TIMEOUT_MS / 1000} s` : (e?.message ?? e);
        this._warnOnce("fetch", `[Lightning] frame list not read (${why}); the last frame stays until it is stale`);
      })
      .finally(() => {
        this.clearTimeout(timer);
        if (this.inflight === mine) this.inflight = null;
        if (this.on && !this.disposed) this._refresh();
      });
  }

  /**
   * Show a new frame without a blank: it loads at opacity 0 and is shown on
   * its `load`, then the old one is dropped.
   * @param {string} key
   */
  _swap(key) {
    if (this.pending?.key === key) return;
    this._dropPending();
    const first = !this.layer;
    const layer = lightningLayer(key, first ? this.opt.opacity : 0);
    if (first) {
      this.layer = layer;
      this.shownKey = key;
      this.group.addLayer(layer);
      return;
    }
    const show = () => {
      if (this.pending?.layer !== layer) return;
      this.clearTimeout(this.pending.timer);
      this.pending = null;
      layer.setOpacity(this.opt.opacity);
      if (this.layer) this.group.removeLayer(this.layer);
      this.layer = layer;
      this.shownKey = key;
    };
    this.pending = { layer, key, timer: this.setTimeout(show, SWAP_TIMEOUT_MS) };
    layer.once("load", show);
    this.group.addLayer(layer);
  }

  _dropPending() {
    if (!this.pending) return;
    this.clearTimeout(this.pending.timer);
    this.group?.removeLayer(this.pending.layer);
    this.pending = null;
  }

  /** The credit line while a frame is drawn and the view overlaps the covered band. */
  _credit() {
    let want = false;
    try { want = this.on && !!this.layer && viewCovered(this.map?.getBounds?.()); } catch { want = false; }
    if (want === this.credited) return;
    const ctl = this.map?.attributionControl;
    if (want) ctl?.addAttribution(LIGHTNING_CREDIT); else ctl?.removeAttribution(LIGHTNING_CREDIT);
    this.credited = want;
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

  /** Teardown: stop timers, abort the fetch, remove the layer, checkbox and pane. */
  cleanup() {
    if (this.disposed) return;
    try {
      this._stop();
      this.map?.off("moveend", this._onMove);
      if (this.group) {
        this.overlays?.removeOverlay(this.group);
        this.group.remove();
      }
      this.map?.getPane?.(LIGHTNING_PANE)?.remove?.();
    } catch (e) {
      Logger.error("[Lightning] cleanup", e);
    }
    this.disposed = true;
  }
}
