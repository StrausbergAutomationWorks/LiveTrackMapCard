import L from "leaflet";
import Logger from "../../util/Logger.js";
import { isoTime } from "../radar/RadarFrames.js";

/**
 * The cloud overlay (10_SEED/06_MAP_CONTRACT_OVERLAYS.md D17, Live Track
 * Weather item 307). Infrared satellite pictures: GOES from NOAA nowCOAST,
 * every 5 minutes, for a tile that lies wholly inside GOES's box; everywhere
 * else EUMETSAT (Lee, 2026-10-28, after NOAA's global mosaic was MEASURED
 * rescaling its greys tile by tile): MTG every 10 minutes over Europe, Africa
 * and the Atlantic, Meteosat IODC every 15 minutes over the Indian Ocean, and
 * the 3-hourly world cloud map under both and alone over East Asia and the
 * Pacific, layered so the freshest picture with data wins. North to about
 * 77-81 N; south only to 72.74 S, where the ice sheet begins (Lee, "North
 * only"). All arrive as solid grey (warm ground dark, cold cloud tops
 * bright), so each tile is redrawn in a canvas: clear sky transparent, cloud
 * from its brightness on each picture's own ramp (at most 65% opaque), light
 * grey on the light map and white on the dark one (Lee, 2026-10-28). One
 * checkbox, "Clouds", unticked by default; its own pane right above the tiles
 * and under the radar.
 */

/** The checkbox label. */
export const CLOUD_NAME = "Clouds";

/** The pane the clouds draw in. */
export const CLOUD_PANE = "ltmcClouds";

/** nowCOAST's satellite WMS and its GOES layer (D17, measured 2026-10-28). */
export const CLOUD_WMS = "https://nowcoast.noaa.gov/geoserver/observations/satellite/ows";
export const CLOUD_CAPS = `${CLOUD_WMS}?service=WMS&version=1.3.0&request=GetCapabilities`;
export const GOES_LAYER = "goes_longwave_imagery";

/**
 * EUMETSAT's three pictures, each with its own small capabilities (6.4-7.9 KB, CORS `*`, `max-age=120`,
 * measured 2026-10-28): MTG's IR 10.5 every 10 minutes (the newest about 20 minutes old), Meteosat IODC's
 * IR 10.8 every 15 minutes (about 17 minutes old), the world cloud map every 3 hours (2.5-3 h old).
 */
export const MTG_WMS = "https://view.eumetsat.int/geoserver/mtg_fd/ir105_hrfi/ows";
export const MTG_LAYER = "mtg_fd:ir105_hrfi";
export const IODC_WMS = "https://view.eumetsat.int/geoserver/msg_iodc/ir108/ows";
export const IODC_LAYER = "msg_iodc:ir108";
export const WORLD_WMS = "https://view.eumetsat.int/geoserver/mumi/worldcloudmap_ir108/ows";
export const WORLD_LAYER = "mumi:worldcloudmap_ir108";

/**
 * @param {string} base a WMS
 * @returns {string} its capabilities
 */
export function capsUrl(base) {
  return `${base}?service=WMS&version=1.3.0&request=GetCapabilities`;
}

/** Each layer's WMS. */
export const LAYER_WMS = Object.freeze({
  [GOES_LAYER]: CLOUD_WMS, [MTG_LAYER]: MTG_WMS, [IODC_LAYER]: IODC_WMS, [WORLD_LAYER]: WORLD_WMS,
});

/** Nothing is drawn south of this: past it the pictures show Antarctica's ice as cloud (Lee, 2026-10-28). */
export const SOUTH_LIMIT = -72.74;

/**
 * GOES's box, its capabilities' EX_GeographicBoundingBox (179.50 W to 50.75 W,
 * 10.91 N to 50.55 N, read 2026-10-28), rounded inward: a tile wholly inside
 * it is drawn from GOES alone.
 */
export const GOES_BOUNDS = Object.freeze({ w: -179.5, e: -50.76, s: 10.92, n: 50.55 });

/**
 * Where each EUMETSAT picture is used. `reach`: a tile outside is not asked, and the picture's pixels are
 * laid only between its west and east (cut at those longitudes); `full`: boxes wholly inside its data (a
 * tile inside one needs no picture underneath). MEASURED 2026-10-28: the data (`bin\ltw307_cover.py`, 0.25
 * deg, masks `bin\ltw307\cover_*.png`) MTG 80.1 W-80.4 E, 77.4 S-77.1 N, whole 45 W-45 E to 75.25; IODC
 * 30.1 W-121.1 E, 76.9 S-75.1 N, whole 15.5-75.5 E to 71.5 and 15.5 W-106.5 E to 64.75; the world map every
 * longitude, its ragged edge 70.1-81.4 N, whole to 69.75. And where their greys hold (`bin\ltw307_limb.py`,
 * ramp against the world map in 15-degree bands, 40 S-40 N): MTG 0.171-0.176 / 0.561-0.571 from 45 W to
 * 30 E, then 0.186/0.602 (30-45 E), 0.197/0.624, 0.241/0.717 and 0.206/0.688 (60-45 W), 0.321/0.763 past
 * 60 W: its limb reads colder, a hard seam against IODC at 80 E in pictures. IODC 0.181 / 0.702-0.706 from
 * 30 to 90 E, 0.201/0.732 (90-105 E), 0.261/0.963 past 105 E. So MTG from GOES's edge (51 W) to 45 E, IODC
 * east of that to 100 E, the world map beyond.
 */
export const MTG_REACH = Object.freeze({ w: -51, e: 45, s: -77.4, n: 77.2 });
export const MTG_FULL = Object.freeze([Object.freeze({ w: -45, e: 45, s: -75, n: 75 })]);
export const IODC_REACH = Object.freeze({ w: -10, e: 100, s: -77, n: 75.2 });
export const IODC_FULL = Object.freeze([
  Object.freeze({ w: 16, e: 75, s: -71, n: 71 }), Object.freeze({ w: -10, e: 100, s: -64.5, n: 64.5 }),
]);
export const WORLD_REACH = Object.freeze({ w: -180, e: 180, s: -81.4, n: 81.4 });
export const WORLD_FULL = Object.freeze([Object.freeze({ w: -180, e: 180, s: -69.5, n: 69.5 })]);

/**
 * MEASURED 2026-10-28 (`bin\ltw307_zoom.py`): a z6 tile scaled 2x differed
 * from its four z7 tiles in 0.0% (GOES) of pixels by more than 16 grey
 * levels, so nothing above z6 is asked for.
 */
export const CLOUD_MAX_NATIVE_ZOOM = 6;

/** The frame lists are read this often while the overlay is on: GOES frames every 5 minutes. */
export const CLOUD_POLL_MS = 5 * 60 * 1000;

/** A GOES frame older than this is not used: EUMETSAT's pictures draw its tiles instead. */
export const GOES_STALE_MS = 30 * 60 * 1000;

/** An MTG frame older than this is not used (10-minute frames, listed about 20 minutes after their time). */
export const MTG_STALE_MS = 40 * 60 * 1000;

/** An IODC frame older than this is not used (15-minute frames, listed about 17 minutes after their time). */
export const IODC_STALE_MS = 45 * 60 * 1000;

/** A world-map frame older than this is not used (3-hourly, listed 2.5-3 h after its time). */
export const WORLD_STALE_MS = 7 * 60 * 60 * 1000;

/** How often the service looks at the clock (and the theme). */
export const TICK_MS = 30 * 1000;

/** A new frame waits at most this long for its tiles before it is shown anyway. */
export const SWAP_TIMEOUT_MS = 30 * 1000;

/** A frame list that has not answered by now is given up on until its next turn. */
export const FETCH_TIMEOUT_MS = 20 * 1000;

/** The credit line while GOES's clouds can show. */
export const CLOUD_CREDIT = "Clouds: NOAA nowCOAST, GOES";

/** The credit line while EUMETSAT's clouds can show (EUMETSAT's data policy asks for it). */
export const EUMETSAT_CREDIT = "Clouds: © EUMETSAT";

/**
 * Brightness (0 to 1, the mean of red, green and blue) at which a GOES pixel starts
 * to be cloud, and at which it is cloud at full strength; and that strength.
 * Chosen from pictures over the real map, 2026-10-28 (`bin\ltw307\sheet_*.png`); the top
 * lowered from 0.85 by Lee the same day ("more transparent", `sheet_lighter_crop.png` B).
 */
export const CLEAR = 0.36;
export const CLOUDY = 0.72;
export const MAX_ALPHA = 0.65;

/**
 * Each picture's ramp [clear, cloudy] on its own grey scale, where its greys match GOES's CLEAR and CLOUDY.
 * MEASURED 2026-10-28 at 18:00Z (`bin\ltw307_calib.py`, 0.05 deg, the median of the reference's grey per 0.01
 * of the picture's): the world map against GOES over 125-60 W 0.326/0.585 (the same over 180-125 W); MTG
 * against the world map over Europe and Africa 0.175/0.566; IODC against the world map over 50-100 E
 * 0.180/0.706, and 0.181/0.702-0.706 in each 15-degree band from 30 to 90 E. (IODC against MTG over 20-60 E
 * read 0.174/0.654, and MTG against GOES at MTG's limb 0.265/0.784: MTG's limb reads colder, see MTG_REACH.)
 */
export const RAMPS = Object.freeze({
  [GOES_LAYER]: Object.freeze([CLEAR, CLOUDY]),
  [MTG_LAYER]: Object.freeze([0.175, 0.566]),
  [IODC_LAYER]: Object.freeze([0.181, 0.704]),
  [WORLD_LAYER]: Object.freeze([0.326, 0.585]),
});

/**
 * Cloud colour by theme (Lee, 2026-10-28: grey on the light map, white on the dark). The grey
 * lightened from #5F6B7A to #8A94A1 by Lee the same day ("lighten the clouds").
 */
export const CLOUD_COLOURS = Object.freeze({ light: Object.freeze([0x8a, 0x94, 0xa1]), dark: Object.freeze([255, 255, 255]) });

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
 * @param {string} text nowCOAST's capabilities
 * @returns {{goes: ?{key: string, time: number}}}
 */
export function parseCloudCaps(text) {
  return { goes: layerFrame(text, GOES_LAYER) };
}

/**
 * The newest frame of a one-layer capabilities document (EUMETSAT's per-layer ones): the first time
 * Dimension's `default`.
 * @param {string} text
 * @returns {?{key: string, time: number}}
 */
export function singleFrame(text) {
  if (typeof text !== "string") return null;
  const m = text.match(/<Dimension\b[^>]*\bname="time"[^>]*>/);
  const d = m && m[0].match(/\bdefault="([^"]+)"/);
  if (!d) return null;
  const time = isoTime(d[1]);
  return Number.isFinite(time) ? { key: d[1], time } : null;
}

/** The four kinds of frame, bottom of the pile first. */
export const KINDS = Object.freeze(["world", "iodc", "mtg", "goes"]);

/**
 * The frames that may be drawn now.
 * @param {?object} frames goes, mtg, iodc, world
 * @param {number} now
 * @returns {{goes: ?object, mtg: ?object, iodc: ?object, world: ?object}}
 */
export function freshFrames(frames, now) {
  const ok = (f, ms) => (f && Number.isFinite(f.time) && now - f.time <= ms ? f : null);
  return {
    goes: ok(frames?.goes, GOES_STALE_MS), mtg: ok(frames?.mtg, MTG_STALE_MS),
    iodc: ok(frames?.iodc, IODC_STALE_MS), world: ok(frames?.world, WORLD_STALE_MS),
  };
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

/** The pictures, top of the pile first: where each reaches (and is cut), where it is whole, its frame. */
const PILE = Object.freeze([
  { kind: "goes", layer: GOES_LAYER, reach: GOES_BOUNDS, full: [GOES_BOUNDS] },
  { kind: "mtg", layer: MTG_LAYER, reach: MTG_REACH, full: MTG_FULL },
  { kind: "iodc", layer: IODC_LAYER, reach: IODC_REACH, full: IODC_FULL },
  { kind: "world", layer: WORLD_LAYER, reach: WORLD_REACH, full: WORLD_FULL },
]);

/**
 * Which pictures draw a tile, bottom first (each draws over the ones before it wherever it has data).
 * From the top of the pile (GOES, MTG, IODC, the world map) every fresh picture that reaches the tile is
 * taken, down to the first whose data covers the whole tile: nothing under that one would show. Nothing
 * for a tile wholly south of SOUTH_LIMIT.
 * @param {{x: number, y: number, z: number}} c
 * @param {object} fresh from freshFrames
 * @returns {{layer: string, key: string}[]} empty when none
 */
export function tilePlan(c, fresh) {
  const t = tileBounds(c);
  if (t.n <= SOUTH_LIMIT) return [];
  const plan = [];
  for (const p of PILE) {
    const f = fresh?.[p.kind];
    if (!f || !overlaps(t, p.reach)) continue;
    plan.unshift({ layer: p.layer, key: f.key });
    if (p.full.some((b) => inside(t, b))) break;
  }
  return plan;
}

/**
 * The first pixel row of a 256 px tile that lies south of SOUTH_LIMIT (256 when none does).
 * @param {{x: number, y: number, z: number}} c
 * @returns {number}
 */
export function southRow(c) {
  const r = Math.log(Math.tan(Math.PI / 4 + (SOUTH_LIMIT * Math.PI) / 360));
  const y = ((1 - r / Math.PI) / 2) * 2 ** c.z * 256 - c.y * 256;
  return Math.min(256, Math.max(0, Math.ceil(y)));
}

/**
 * The columns of a 256 px tile whose centres lie between two longitudes: [first, past the last).
 * @param {{x: number, y: number, z: number}} c
 * @param {number} w
 * @param {number} e
 * @returns {number[]}
 */
export function colRange(c, w, e) {
  const px = (lon) => ((lon + 180) / 360) * 2 ** c.z * 256 - c.x * 256;
  const clamp = (v) => Math.min(256, Math.max(0, v));
  return [clamp(Math.ceil(px(w) - 0.5)), clamp(Math.ceil(px(e) - 0.5))];
}

/** Each layer's reach, for its cut. */
const REACH = Object.freeze(Object.fromEntries(PILE.map((p) => [p.layer, p.reach])));

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
  return `${LAYER_WMS[src.layer] ?? CLOUD_WMS}?${p.toString()}`;
}

/**
 * Recolour a tile's pixels in place: clear sky transparent, cloud in `rgb`
 * with an alpha that rises from `ramp[0]` to `ramp[1]` brightness up to MAX_ALPHA.
 * @param {Uint8ClampedArray|number[]} d RGBA
 * @param {number[]} rgb
 * @param {number[]} [ramp] [clear, cloudy]
 */
export function recolour(d, rgb, ramp = [CLEAR, CLOUDY]) {
  const span = ramp[1] - ramp[0];
  for (let i = 0; i < d.length; i += 4) {
    let a = 0;
    if (d[i + 3] > 0) {
      const t = ((d[i] + d[i + 1] + d[i + 2]) / 765 - ramp[0]) / span;
      a = t <= 0 ? 0 : Math.round(255 * MAX_ALPHA * Math.min(1, t));
    }
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
    d[i + 3] = a;
  }
}

/**
 * Lay one picture's pixels over a tile already drawn: wherever the picture has data (alpha above 0) its
 * recoloured pixel replaces what is there, clear sky included; elsewhere, and outside columns [c0, c1),
 * the tile is left alone.
 * @param {Uint8ClampedArray|number[]} dst RGBA, already recoloured
 * @param {Uint8ClampedArray|number[]} src RGBA, as fetched
 * @param {number[]} rgb
 * @param {number[]} ramp
 * @param {number} [c0]
 * @param {number} [c1]
 */
export function layerOver(dst, src, rgb, ramp, c0 = 0, c1 = 256) {
  const px = [0, 0, 0, 0];
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    const col = (i >> 2) & 255;
    if (col < c0 || col >= c1) continue;
    px[0] = src[i]; px[1] = src[i + 1]; px[2] = src[i + 2]; px[3] = src[i + 3];
    recolour(px, rgb, ramp);
    dst[i] = px[0]; dst[i + 1] = px[1]; dst[i + 2] = px[2]; dst[i + 3] = px[3];
  }
}

/**
 * A view's box; a view a whole world wide or more spans every longitude.
 * @param {?object} b Leaflet bounds
 * @returns {?{w: number, e: number, s: number, n: number}}
 */
function viewBox(b) {
  if (!b || typeof b.getSouth !== "function") return null;
  const s = b.getSouth();
  const n = b.getNorth();
  let w = typeof b.getWest === "function" ? b.getWest() : -180;
  let e = typeof b.getEast === "function" ? b.getEast() : 180;
  if (e - w >= 360) { w = -180; e = 180; } else {
    // Leaflet's longitudes run on past 180 when the map is panned round; bring the west edge back.
    const k = Math.floor((w + 180) / 360);
    w -= k * 360;
    e -= k * 360;
  }
  return { w, e, s, n };
}

/**
 * @param {object} v a view box
 * @param {object} b a box
 * @returns {boolean} they overlap, the view taken also one world east (a view across 180)
 */
function viewMeets(v, b) {
  return overlaps(v, b) || overlaps({ ...v, w: v.w - 360, e: v.e - 360 }, b);
}

/**
 * Whether a view overlaps GOES's box.
 * @param {?object} b Leaflet bounds
 * @returns {boolean}
 */
export function viewCovered(b) {
  const v = viewBox(b);
  return !!v && viewMeets(v, GOES_BOUNDS);
}

/**
 * Whether EUMETSAT's pictures can show in a view: it overlaps where they have data and, while GOES is
 * fresh, reaches past GOES's box (inside it GOES draws alone).
 * @param {?object} b Leaflet bounds
 * @param {boolean} [goesFresh]
 * @returns {boolean}
 */
export function viewEumetsat(b, goesFresh = true) {
  const v = viewBox(b);
  if (!v || v.n <= SOUTH_LIMIT || v.s >= WORLD_REACH.n) return false;
  return !goesFresh || !(v.e - v.w < 360 && inside(v, GOES_BOUNDS));
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
 * The grid layer for one set of frames. Each tile's pictures are fetched as images
 * (CORS `*`, measured), recoloured in a canvas, laid bottom first, and handed to Leaflet.
 * @param {object} fresh from freshFrames
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
      const plan = tilePlan(coords, this.options.fresh);
      if (!plan.length) {
        setTimeout(() => done(null, canvas), 0);
        return canvas;
      }
      // Every picture is fetched at once; they are laid bottom first when all have answered.
      const imgs = plan.map((src) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        const p = new Promise((resolve) => {
          img.onload = () => resolve(img);
          img.onerror = () => {
            this.options.onError(new Error(`tile not loaded: ${src.layer}`));
            resolve(null);
          };
        });
        img.src = tileUrl(coords, src);
        return p;
      });
      Promise.all(imgs).then((loaded) => {
        if (!loaded.some(Boolean)) {
          done(new Error("no cloud picture loaded"), canvas);
          return;
        }
        try {
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          const rgb = this.options.colour();
          const out = ctx.createImageData(256, 256);
          loaded.forEach((img, i) => {
            if (!img) return;
            ctx.clearRect(0, 0, 256, 256);
            ctx.drawImage(img, 0, 0, 256, 256);
            const raw = ctx.getImageData(0, 0, 256, 256);
            const r = REACH[plan[i].layer];
            const [c0, c1] = r ? colRange(coords, r.w, r.e) : [0, 256];
            layerOver(out.data, raw.data, rgb, RAMPS[plan[i].layer] ?? [CLEAR, CLOUDY], c0, c1);
          });
          out.data.fill(0, southRow(coords) * 256 * 4);
          ctx.putImageData(out, 0, 0);
        } catch (e) {
          this.options.onError(e);
        }
        done(null, canvas);
      });
      return canvas;
    },
  });
  return new CloudGrid({
    fresh, colour, onError, opacity,
    pane: CLOUD_PANE,
    tileSize: 256,
    maxNativeZoom: CLOUD_MAX_NATIVE_ZOOM,
    maxZoom: 24,
    bounds: L.latLngBounds([SOUTH_LIMIT, -180], [WORLD_REACH.n, 180]),
    updateWhenZooming: false,
    keepBuffer: 1,
  });
}

/**
 * @param {?object} f fresh frames
 * @returns {string} the frames' key: a new frame of any kind is a new layer
 */
export function pairKey(f) {
  return KINDS.map((k) => f?.[k]?.key ?? "-").join("|");
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
    this.frames = { goes: null, mtg: null, iodc: null, world: null };
    this.eumCredited = false;
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
      if (this.frames.goes && !fresh.goes) this._warnOnce("goes", "[Clouds] the newest GOES frame is over 30 minutes old: EUMETSAT's pictures draw its tiles");
      const key = pairKey(fresh);
      if (!KINDS.some((k) => fresh[k])) {
        if (KINDS.some((k) => this.frames[k])) this._warnOnce("stale", "[Clouds] no fresh cloud frame: none is drawn");
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
    // Each list is read on its own: one failing never holds back the others.
    const one = (url, parse, warnKey, label) => {
      let req;
      try {
        // no-cache: NOAA's capabilities say max-age=240, nearly a whole GOES frame.
        req = Promise.resolve(this.fetch(url, { signal: ctl?.signal, credentials: "omit", cache: "no-cache" }));
      } catch (e) {
        req = Promise.reject(e);
      }
      return req
        .then((r) => {
          if (!r || !r.ok) throw new Error(`HTTP ${r?.status}`);
          return r.text();
        })
        .then((body) => {
          const f = parse(body);
          if (!KINDS.some((k) => f[k])) throw new Error("no frame in the answer");
          this._keep(f);
        })
        .catch((e) => {
          if (e?.name === "AbortError" && !timedOut) return;
          const why = timedOut ? `no answer in ${FETCH_TIMEOUT_MS / 1000} s` : (e?.message ?? e);
          this._warnOnce(warnKey, `[Clouds] ${label}frame list not read (${why}); the last frames stay until they are stale`);
        });
    };
    Promise.all([
      one(CLOUD_CAPS, parseCloudCaps, "fetch", ""),
      one(capsUrl(MTG_WMS), (b) => ({ mtg: singleFrame(b) }), "fetch-mtg", "EUMETSAT MTG "),
      one(capsUrl(IODC_WMS), (b) => ({ iodc: singleFrame(b) }), "fetch-iodc", "EUMETSAT IODC "),
      one(capsUrl(WORLD_WMS), (b) => ({ world: singleFrame(b) }), "fetch-world", "EUMETSAT world map "),
    ]).finally(() => {
      this.clearTimeout(timer);
      if (this.inflight === mine) this.inflight = null;
      if (this.on && !this.disposed) this._refresh();
    });
  }

  /**
   * Keep the newer of each kind: an older answer never replaces a frame already held.
   * @param {object} f frames read
   */
  _keep(f) {
    for (const k of KINDS) {
      if (f[k] && (!this.frames[k] || f[k].time >= this.frames[k].time)) this.frames[k] = f[k];
    }
  }

  /**
   * Show a new pair of frames without a blank, as D13 and D14: it loads at
   * opacity 0 and is shown on its `load` (or after SWAP_TIMEOUT_MS).
   * @param {string} key
   * @param {object} fresh from freshFrames
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

  /**
   * The credit lines while clouds are drawn: NOAA's while the view overlaps GOES's box and a GOES frame is
   * fresh, EUMETSAT's while the view reaches past that box and one of EUMETSAT's frames is fresh.
   */
  _credit() {
    let noaa = false;
    let eum = false;
    try {
      const b = this.map?.getBounds?.();
      if (this.on && this.layer) {
        const fresh = freshFrames(this.frames, this.now());
        noaa = !!fresh.goes && viewCovered(b);
        eum = !!(fresh.mtg || fresh.iodc || fresh.world) && viewEumetsat(b, !!fresh.goes);
      }
    } catch {
      noaa = false;
      eum = false;
    }
    const ctl = this.map?.attributionControl;
    if (noaa !== this.credited) {
      if (noaa) ctl?.addAttribution(CLOUD_CREDIT); else ctl?.removeAttribution(CLOUD_CREDIT);
      this.credited = noaa;
    }
    if (eum !== this.eumCredited) {
      if (eum) ctl?.addAttribution(EUMETSAT_CREDIT); else ctl?.removeAttribution(EUMETSAT_CREDIT);
      this.eumCredited = eum;
    }
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
