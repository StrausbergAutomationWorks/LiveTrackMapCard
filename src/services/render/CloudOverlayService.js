import L from "leaflet";
import Logger from "../../util/Logger.js";
import { isoTime } from "../radar/RadarFrames.js";

/**
 * The cloud overlay (10_SEED/06_MAP_CONTRACT_OVERLAYS.md D17, Live Track
 * Weather item 307). Infrared satellite pictures from NOAA nowCOAST: GOES,
 * every 5 minutes, for a tile that lies wholly inside GOES's box; the hourly
 * global mosaic for every other tile. Both arrive as solid grey (warm ground
 * dark, cold cloud tops bright), so each tile is redrawn in a canvas: clear
 * sky transparent, cloud from its brightness, grey on the light map and white
 * on the dark one (Lee, 2026-10-28). One checkbox, "Clouds", unticked by
 * default; its own pane right above the tiles and under the radar.
 */

/** The checkbox label. */
export const CLOUD_NAME = "Clouds";

/** The pane the clouds draw in. */
export const CLOUD_PANE = "ltmcClouds";

/** nowCOAST's satellite WMS and the two layers (D17, measured 2026-10-28). */
export const CLOUD_WMS = "https://nowcoast.noaa.gov/geoserver/observations/satellite/ows";
export const CLOUD_CAPS = `${CLOUD_WMS}?service=WMS&version=1.3.0&request=GetCapabilities`;
export const GOES_LAYER = "goes_longwave_imagery";
export const GLOBAL_LAYER = "global_longwave_imagery_mosaic";

/**
 * GOES's box, its capabilities' EX_GeographicBoundingBox (179.50 W to 50.75 W,
 * 10.91 N to 50.55 N, read 2026-10-28), rounded inward: a tile wholly inside
 * it is drawn from GOES.
 */
export const GOES_BOUNDS = Object.freeze({ w: -179.5, e: -50.76, s: 10.92, n: 50.55 });

/** The global mosaic's box (72.74 S to 72.74 N at every longitude, read 2026-10-28). */
export const GLOBAL_BOUNDS = Object.freeze({ w: -180, e: 180, s: -72.74, n: 72.74 });

/**
 * MEASURED 2026-10-28 (`bin\ltw307_zoom.py`): a z6 tile scaled 2x differed
 * from its four z7 tiles in 0.0% (GOES) and 0.1% (global) of pixels by more
 * than 16 grey levels, so nothing above z6 is asked for.
 */
export const CLOUD_MAX_NATIVE_ZOOM = 6;

/** The frame list is read this often while the overlay is on: GOES frames every 5 minutes. */
export const CLOUD_POLL_MS = 5 * 60 * 1000;

/** A GOES frame older than this is not used: the global mosaic draws its tiles instead. */
export const GOES_STALE_MS = 30 * 60 * 1000;

/** A global frame older than this is not used (it is hourly, listed about 1.5 h after its time). */
export const GLOBAL_STALE_MS = 3 * 60 * 60 * 1000;

/** How often the service looks at the clock (and the theme). */
export const TICK_MS = 30 * 1000;

/** A new frame waits at most this long for its tiles before it is shown anyway. */
export const SWAP_TIMEOUT_MS = 30 * 1000;

/** A frame list that has not answered by now is given up on until its next turn. */
export const FETCH_TIMEOUT_MS = 20 * 1000;

/** The credit line while clouds are drawn. */
export const CLOUD_CREDIT = "Clouds: NOAA nowCOAST, GOES and global satellite mosaic";

/**
 * Brightness (0 to 1, the mean of red, green and blue) at which a pixel starts
 * to be cloud, and at which it is cloud at full strength; and that strength.
 * Chosen from pictures over the real map, 2026-10-28 (`bin\ltw307\sheet_*.png`).
 */
export const CLEAR = 0.36;
export const CLOUDY = 0.72;
export const MAX_ALPHA = 0.85;

/** Cloud colour by theme (Lee, 2026-10-28: grey on the light map, white on the dark). */
export const CLOUD_COLOURS = Object.freeze({ light: Object.freeze([0x5f, 0x6b, 0x7a]), dark: Object.freeze([255, 255, 255]) });

/** Defaults; `clouds` in the card config overrides each. The box starts UNTICKED (Lee, 2026-10-28). */
export const DEFAULT_CLOUDS = Object.freeze({ enabled: true, opacity: 1, show: false });

const HALF = 20037508.342789244;

/**
 * @param {*} v
 * @returns {boolean}
 */
function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * `clouds`: absent or true offers the overlay with D17's defaults; false turns
 * it off (no checkbox, no fetch); a mapping overrides `opacity` and `show`.
 * @param {*} input
 * @returns {{enabled: boolean, opacity: number, show: boolean}}
 */
export function parseCloudsOption(input) {
  if (input === undefined || input === null || input === true || input === "auto") return { ...DEFAULT_CLOUDS };
  if (input === false || input === "off") return { ...DEFAULT_CLOUDS, enabled: false };
  const o = { ...DEFAULT_CLOUDS };
  if (!isObj(input)) {
    Logger.warn("[Clouds] clouds ignored: expected true, false or a mapping", input);
    return o;
  }
  if (typeof input.opacity === "number" && Number.isFinite(input.opacity) && input.opacity >= 0 && input.opacity <= 1) o.opacity = input.opacity;
  if (typeof input.show === "boolean") o.show = input.show;
  return o;
}

/**
 * The newest frame of one layer: the `default` of the time Dimension inside
 * that layer's own Layer element.
 * @param {string} text the capabilities
 * @param {string} name the layer
 * @returns {?{key: string, time: number}}
 */
export function layerFrame(text, name) {
  if (typeof text !== "string") return null;
  const at = text.indexOf(`<Name>${name}</Name>`);
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
 * @param {string} text the capabilities
 * @returns {{goes: ?{key: string, time: number}, global: ?{key: string, time: number}}}
 */
export function parseCloudCaps(text) {
  return { goes: layerFrame(text, GOES_LAYER), global: layerFrame(text, GLOBAL_LAYER) };
}

/**
 * The frames that may be drawn now.
 * @param {{goes: ?object, global: ?object}} frames
 * @param {number} now
 * @returns {{goes: ?object, global: ?object}}
 */
export function freshFrames(frames, now) {
  const ok = (f, ms) => (f && Number.isFinite(f.time) && now - f.time <= ms ? f : null);
  return { goes: ok(frames?.goes, GOES_STALE_MS), global: ok(frames?.global, GLOBAL_STALE_MS) };
}

/**
 * A tile's box in longitude and latitude.
 * @param {{x: number, y: number, z: number}} c
 * @returns {{w: number, e: number, s: number, n: number}}
 */
export function tileBounds(c) {
  const n2 = 2 ** c.z;
  const lon = (x) => (x / n2) * 360 - 180;
  const lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n2))) * 180) / Math.PI;
  return { w: lon(c.x), e: lon(c.x + 1), n: lat(c.y), s: lat(c.y + 1) };
}

/**
 * @param {object} t a box
 * @param {object} b a box
 * @returns {boolean} t wholly inside b
 */
function inside(t, b) {
  return t.w >= b.w && t.e <= b.e && t.s >= b.s && t.n <= b.n;
}

/**
 * @param {object} t a box
 * @param {object} b a box
 * @returns {boolean} t and b overlap
 */
function overlaps(t, b) {
  return t.w < b.e && t.e > b.w && t.s < b.n && t.n > b.s;
}

/**
 * Which picture draws a tile: GOES when the tile lies wholly inside its box;
 * the global mosaic for any other tile it overlaps; GOES for a tile on its
 * edge when the global mosaic is not fresh; else none.
 * @param {{x: number, y: number, z: number}} c
 * @param {{goes: ?object, global: ?object}} fresh from freshFrames
 * @returns {?{layer: string, key: string}}
 */
export function tileSource(c, fresh) {
  const t = tileBounds(c);
  if (fresh.goes && inside(t, GOES_BOUNDS)) return { layer: GOES_LAYER, key: fresh.goes.key };
  if (fresh.global && overlaps(t, GLOBAL_BOUNDS)) return { layer: GLOBAL_LAYER, key: fresh.global.key };
  if (fresh.goes && overlaps(t, GOES_BOUNDS)) return { layer: GOES_LAYER, key: fresh.goes.key };
  return null;
}

/**
 * The GetMap URL for one 256 px tile in Web Mercator.
 * @param {{x: number, y: number, z: number}} c
 * @param {{layer: string, key: string}} src
 * @returns {string}
 */
export function tileUrl(c, src) {
  const span = (2 * HALF) / 2 ** c.z;
  const minx = -HALF + c.x * span;
  const maxy = HALF - c.y * span;
  const p = new URLSearchParams({
    service: "WMS", request: "GetMap", version: "1.3.0", layers: src.layer, styles: "", crs: "EPSG:3857",
    bbox: [minx, maxy - span, minx + span, maxy].join(","), width: "256", height: "256",
    format: "image/png", transparent: "true", time: src.key,
  });
  return `${CLOUD_WMS}?${p.toString()}`;
}

/**
 * Recolour a tile's pixels in place: clear sky transparent, cloud in `rgb`
 * with an alpha that rises from CLEAR to CLOUDY brightness up to MAX_ALPHA.
 * @param {Uint8ClampedArray|number[]} d RGBA
 * @param {number[]} rgb
 */
export function recolour(d, rgb) {
  const span = CLOUDY - CLEAR;
  for (let i = 0; i < d.length; i += 4) {
    let a = 0;
    if (d[i + 3] > 0) {
      const t = ((d[i] + d[i + 1] + d[i + 2]) / 765 - CLEAR) / span;
      a = t <= 0 ? 0 : Math.round(255 * MAX_ALPHA * Math.min(1, t));
    }
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
    d[i + 3] = a;
  }
}

/**
 * Whether a view overlaps where either picture has data.
 * @param {?{getSouth: Function, getNorth: Function}} b
 * @returns {boolean}
 */
export function viewCovered(b) {
  if (!b || typeof b.getSouth !== "function") return false;
  return b.getSouth() < GLOBAL_BOUNDS.n && b.getNorth() > GLOBAL_BOUNDS.s;
}

/**
 * The cloud pane: right after the tile pane, so the radar's (also placed right
 * after the tile pane, earlier) ends up above it; outside the tile pane, so
 * the dark filter does not reach it.
 * @param {object} map
 * @returns {HTMLElement}
 */
export function placeCloudPane(map) {
  const pane = map.getPane(CLOUD_PANE) ?? map.createPane(CLOUD_PANE);
  const tiles = map.getPane("tilePane");
  if (tiles?.parentNode && pane.previousSibling !== tiles) {
    tiles.parentNode.insertBefore(pane, tiles.nextSibling);
  }
  pane.style.pointerEvents = "none";
  return pane;
}

let CloudGrid = null;

/**
 * The grid layer for one pair of frames. Each tile is fetched as an image
 * (CORS `*`, measured), recoloured in a canvas, and handed to Leaflet.
 * @param {{goes: ?object, global: ?object}} fresh
 * @param {Function} colour () => [r, g, b] for the current theme
 * @param {number} opacity
 * @param {Function} onError (err) => void, once per failure kind
 * @returns {object} a Leaflet layer
 */
export function cloudLayer(fresh, colour, opacity, onError) {
  CloudGrid ??= L.GridLayer.extend({
    createTile(coords, done) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const src = tileSource(coords, this.options.fresh);
      if (!src) {
        setTimeout(() => done(null, canvas), 0);
        return canvas;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 256, 256);
          const data = ctx.getImageData(0, 0, 256, 256);
          recolour(data.data, this.options.colour());
          ctx.putImageData(data, 0, 0);
        } catch (e) {
          this.options.onError(e);
        }
        done(null, canvas);
      };
      img.onerror = () => {
        const e = new Error(`tile not loaded: ${src.layer}`);
        this.options.onError(e);
        done(e, canvas);
      };
      img.src = tileUrl(coords, src);
      return canvas;
    },
  });
  const b = GLOBAL_BOUNDS;
  return new CloudGrid({
    fresh, colour, onError, opacity,
    pane: CLOUD_PANE,
    tileSize: 256,
    maxNativeZoom: CLOUD_MAX_NATIVE_ZOOM,
    maxZoom: 24,
    bounds: L.latLngBounds([b.s, b.w], [b.n, b.e]),
    updateWhenZooming: false,
    keepBuffer: 1,
  });
}

/**
 * @param {?{goes: ?object, global: ?object}} f
 * @returns {string} the pair's key: a new frame of either is a new layer
 */
export function pairKey(f) {
  return `${f?.goes?.key ?? "-"}|${f?.global?.key ?? "-"}`;
}

export default class CloudOverlayService {
  /**
   * @param {object} map Leaflet map
   * @param {*} option the card's `clouds`
   * @param {{addOverlay: Function, removeOverlay: Function}} overlays the layer control (TileLayersService)
   * @param {Function} isDark () => whether the card is dark now
   * @param {object} [deps] for tests: fetch, now, setInterval, clearInterval, setTimeout, clearTimeout, layer
   */
  constructor(map, option, overlays, isDark, deps = {}) {
    this.map = map;
    this.opt = parseCloudsOption(option);
    this.overlays = overlays;
    this.isDark = typeof isDark === "function" ? isDark : () => false;
    this.fetch = deps.fetch ?? ((...a) => globalThis.fetch(...a));
    this.now = deps.now ?? (() => Date.now());
    this.setInterval = deps.setInterval ?? ((f, ms) => globalThis.setInterval(f, ms));
    this.clearInterval = deps.clearInterval ?? ((h) => globalThis.clearInterval(h));
    this.setTimeout = deps.setTimeout ?? ((f, ms) => globalThis.setTimeout(f, ms));
    this.clearTimeout = deps.clearTimeout ?? ((h) => globalThis.clearTimeout(h));
    this.makeLayer = deps.layer ?? cloudLayer;
    this.group = null;
    this.layer = null;
    this.pending = null;
    this.frames = { goes: null, global: null };
    this.shownKey = null;
    this.dark = null;
    this.nextAt = 0;
    this.inflight = null;
    this.credited = false;
    this.warned = new Set();
    this.on = false;
    this.timer = null;
    this.disposed = false;
    this._onMove = () => this._credit();
    this._colour = () => (this.dark ? CLOUD_COLOURS.dark : CLOUD_COLOURS.light);
    this._onTileError = () => this._warnOnce("tile", "[Clouds] a cloud tile was not drawn (network or CORS); the rest of the map is unaffected");
  }

  /** Create the checkbox (and, if it starts ticked, the layer). Never throws. */
  setup() {
    if (!this.opt.enabled || this.disposed) return;
    try {
      placeCloudPane(this.map);
      this.group = L.layerGroup([]);
      this.group.on("add", () => this._start());
      this.group.on("remove", () => this._stop());
      this.map.on("moveend", this._onMove);
      this.overlays.addOverlay(this.group, CLOUD_NAME, this.opt.show);
    } catch (e) {
      Logger.error("[Clouds] setup failed; map unaffected", e);
    }
  }

  _start() {
    if (this.disposed || this.on) return;
    this.on = true;
    this.dark = !!this.isDark();
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

  /** Read the frame list when due; draw the fresh frames, or nothing; follow the theme. */
  _refresh() {
    if (!this.on || this.disposed) return;
    try {
      const now = this.now();
      if (!this.inflight && this.nextAt <= now) this._fetchFrames();
      const fresh = freshFrames(this.frames, now);
      if (this.frames.goes && !fresh.goes) this._warnOnce("goes", "[Clouds] the newest GOES frame is over 30 minutes old: the global mosaic draws its tiles");
      const key = pairKey(fresh);
      if (!fresh.goes && !fresh.global) {
        if (this.frames.goes || this.frames.global) this._warnOnce("stale", "[Clouds] no fresh cloud frame: none is drawn");
        this._dropPending();
        if (this.layer) { this.group.removeLayer(this.layer); this.layer = null; }
        this.shownKey = null;
      } else if (key !== this.shownKey) {
        this._swap(key, fresh);
      }
      const dark = !!this.isDark();
      if (dark !== this.dark) {
        this.dark = dark;
        this.layer?.redraw?.();
      }
      this._credit();
    } catch (e) {
      Logger.error("[Clouds] refresh failed; map unaffected", e);
    }
  }

  _fetchFrames() {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    this.inflight = ctl ?? { abort() {} };
    this.nextAt = this.now() + CLOUD_POLL_MS;
    let timedOut = false;
    const timer = this.setTimeout(() => { timedOut = true; try { ctl?.abort(); } catch { /* nothing */ } }, FETCH_TIMEOUT_MS);
    const mine = this.inflight;
    let req;
    try {
      // no-cache: the capabilities say max-age=240, nearly a whole GOES frame.
      req = Promise.resolve(this.fetch(CLOUD_CAPS, { signal: ctl?.signal, credentials: "omit", cache: "no-cache" }));
    } catch (e) {
      req = Promise.reject(e);
    }
    req
      .then((r) => {
        if (!r || !r.ok) throw new Error(`HTTP ${r?.status}`);
        return r.text();
      })
      .then((body) => {
        const f = parseCloudCaps(body);
        if (!f.goes && !f.global) throw new Error("no frame in the answer");
        // An older answer never replaces a frame already held.
        for (const k of ["goes", "global"]) {
          if (f[k] && (!this.frames[k] || f[k].time >= this.frames[k].time)) this.frames[k] = f[k];
        }
      })
      .catch((e) => {
        if (e?.name === "AbortError" && !timedOut) return;
        const why = timedOut ? `no answer in ${FETCH_TIMEOUT_MS / 1000} s` : (e?.message ?? e);
        this._warnOnce("fetch", `[Clouds] frame list not read (${why}); the last frames stay until they are stale`);
      })
      .finally(() => {
        this.clearTimeout(timer);
        if (this.inflight === mine) this.inflight = null;
        if (this.on && !this.disposed) this._refresh();
      });
  }

  /**
   * Show a new pair of frames without a blank, as D13 and D14: it loads at
   * opacity 0 and is shown on its `load` (or after SWAP_TIMEOUT_MS).
   * @param {string} key
   * @param {{goes: ?object, global: ?object}} fresh
   */
  _swap(key, fresh) {
    if (this.pending?.key === key) return;
    this._dropPending();
    const first = !this.layer;
    const layer = this.makeLayer(fresh, this._colour, first ? this.opt.opacity : 0, this._onTileError);
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

  /** The credit line while clouds are drawn and the view overlaps where there are pictures. */
  _credit() {
    let want = false;
    try { want = this.on && !!this.layer && viewCovered(this.map?.getBounds?.()); } catch { want = false; }
    if (want === this.credited) return;
    const ctl = this.map?.attributionControl;
    if (want) ctl?.addAttribution(CLOUD_CREDIT); else ctl?.removeAttribution(CLOUD_CREDIT);
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
      this.map?.getPane?.(CLOUD_PANE)?.remove?.();
    } catch (e) {
      Logger.error("[Clouds] cleanup", e);
    }
    this.disposed = true;
  }
}
