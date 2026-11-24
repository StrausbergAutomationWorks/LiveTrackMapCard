/**
 * Points on the map (06_MAP_CONTRACT_OVERLAYS.md D19): the parts that need no Leaflet.
 *
 * A publisher is one entity whose `points_url` names a file of points under /api/ and whose `point_styles` say
 * how each style looks. The card draws the file's points as dots on one canvas per publisher, only those on
 * screen, at most one dot per radius of screen, and opens a popup for a clicked dot. Nothing here names a
 * publisher. First publishers: Live Track Weather's fire detections and air-quality sites (2026-11-17).
 */

import { trackOf } from "./TrackLine.js";
import { escapeHtml } from "./InfoPopup.js";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A style the publisher did not send (D19 rule 7). */
export const UNKNOWN_POINT_STYLE = Object.freeze({ color: "#808080", label: "Point", radius: 4, outline: null });
export const RADIUS_MIN = 2;
export const RADIUS_MAX = 10;
/** A click this many px beyond a dot's radius still hits it (D19 rule 4). */
export const HIT_SLOP_PX = 3;
/** The most lines a popup lists. */
export const POPUP_LINES_MAX = 12;
const MAX_LAT = 85.0511287798;

/**
 * @param {object} attributes
 * @returns {?string} the checked `points_url` (the D4h path rule), or null
 */
export function pointsUrlOf(attributes) {
  return trackOf(attributes?.points_url);
}

/**
 * Whether a state is a point publisher that can be drawn now (D19 rules 1, 8).
 * @param {object|undefined} state
 * @returns {boolean}
 */
export function isPointPublisherState(state) {
  if (!state || state.state === "unavailable" || state.state === "unknown") return false;
  const a = state.attributes;
  return isPlainObject(a) && isPlainObject(a.point_styles) && pointsUrlOf(a) !== null;
}

/**
 * @param {object} states hass.states
 * @returns {string[]} every point publisher, sorted
 */
export function discoverPointPublishers(states) {
  return Object.keys(states ?? {}).filter((id) => isPointPublisherState(states[id])).sort();
}

/**
 * `point_layers`: absent or "auto" discovers; false or "off" turns it off; a list names publishers as
 * `{entity, name, show}` or a bare entity id (as `shape_layers`). `show` is null when the dashboard set none, so the
 * publisher's `layer_default` decides (backlog 363).
 * @param {*} input
 * @returns {{mode: string, items?: {entity: string, name: ?string, show: ?boolean}[]}}
 */
export function parsePointLayersOption(input) {
  if (input === undefined || input === null || input === true || input === "auto") return { mode: "auto" };
  if (input === false || input === "off") return { mode: "off" };
  const items = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : [input]) {
    const o = typeof raw === "string" ? { entity: raw } : raw;
    if (!isPlainObject(o) || typeof o.entity !== "string" || o.entity.trim() === "") continue;
    const entity = o.entity.trim();
    if (seen.has(entity)) continue;
    seen.add(entity);
    items.push({ entity, name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : null, show: typeof o.show === "boolean" ? o.show : null });
  }
  return { mode: "list", items };
}

/**
 * @param {object} attributes
 * @returns {number} `point_order`, an integer, else 0
 */
export function pointOrderOf(attributes) {
  const o = attributes?.point_order;
  return Number.isInteger(o) ? o : 0;
}

/**
 * One style's look (D19): colour, label, radius 2-10 (default 4), outline or null. Unknown or malformed: grey.
 * @param {string} style
 * @param {object} styles the publisher's `point_styles`
 * @returns {{color: string, label: string, radius: number, outline: ?string}}
 */
export function pointStyleFor(style, styles) {
  const s = isPlainObject(styles) ? styles[style] : undefined;
  if (!isPlainObject(s) || typeof s.color !== "string" || !HEX.test(s.color)) return { ...UNKNOWN_POINT_STYLE };
  const label = typeof s.label === "string" && s.label.trim() ? s.label.trim().slice(0, 200) : UNKNOWN_POINT_STYLE.label;
  const radius = Number.isInteger(s.radius) && s.radius >= RADIUS_MIN && s.radius <= RADIUS_MAX ? s.radius : UNKNOWN_POINT_STYLE.radius;
  const outline = typeof s.outline === "string" && HEX.test(s.outline) ? s.outline : null;
  return { color: s.color, label, radius, outline };
}

/**
 * A parsed file -> its columns and well-formed points, each with its Mercator position in [0, 1] (computed once,
 * so a redraw only scales and shifts). Null when it is not a D19 file (rule 6). Rule 7: a malformed point is
 * skipped. `keep(lon, lat)` filters by place (weather_area, rule 9).
 * @param {*} json
 * @param {?Function} [keep]
 * @returns {?{columns: {key: string, label: string}[], points: Array[], mx: Float64Array, my: Float64Array}}
 */
export function pointsOf(json, keep = null) {
  if (!isPlainObject(json) || !Array.isArray(json.points)) return null;
  const columns = Array.isArray(json.columns)
    ? json.columns.map((c) => ({ key: String(c?.key ?? ""), label: typeof c?.label === "string" ? c.label : String(c?.key ?? "") }))
    : [];
  const points = [];
  for (const p of json.points) {
    if (!Array.isArray(p)) continue;
    const [lon, lat, style] = p;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (typeof style !== "string") continue;
    if (keep && !keep(lon, lat)) continue;
    points.push(p);
  }
  const mx = new Float64Array(points.length);
  const my = new Float64Array(points.length);
  points.forEach((p, i) => { [mx[i], my[i]] = mercator(p[0], p[1]); });
  return { columns, points, mx, my };
}

/**
 * Web Mercator in [0, 1], as Leaflet's EPSG:3857 at scale 1 (x east, y south).
 * @param {number} lon
 * @param {number} lat
 * @returns {number[]}
 */
export function mercator(lon, lat) {
  const la = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return [0.5 + lon / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + la / 2)) / (2 * Math.PI)];
}

/**
 * The dots to draw: points inside the canvas (width x height px, its top left at (left, top) in container px),
 * at most one per cell of `cell` px (D19 rule 3), in file order.
 * @param {{mx: Float64Array, my: Float64Array, points: Array[]}} data
 * @param {{scale: number, ox: number, oy: number}} view container x = mx * scale - ox, y = my * scale - oy
 * @param {{left: number, top: number, width: number, height: number}} box
 * @param {number} cell
 * @returns {{i: Int32Array, x: Float64Array, y: Float64Array, n: number}}
 */
export function visiblePoints(data, view, box, cell) {
  const n = data.points.length;
  const c = Math.max(1, cell);
  const cols = Math.ceil(box.width / c) + 1;
  const rows = Math.ceil(box.height / c) + 1;
  const taken = new Uint8Array(cols * rows);
  const i = new Int32Array(Math.min(n, cols * rows));
  const x = new Float64Array(i.length);
  const y = new Float64Array(i.length);
  let k = 0;
  for (let j = 0; j < n && k < i.length; j++) {
    const px = data.mx[j] * view.scale - view.ox - box.left;
    const py = data.my[j] * view.scale - view.oy - box.top;
    if (px < 0 || py < 0 || px >= box.width || py >= box.height) continue;
    const g = Math.floor(py / c) * cols + Math.floor(px / c);
    if (taken[g]) continue;
    taken[g] = 1;
    i[k] = j; x[k] = px + box.left; y[k] = py + box.top; k++;
  }
  return { i, x, y, n: k };
}

/**
 * The drawn dot under a container point, nearest first: within its radius + HIT_SLOP_PX.
 * @param {{i: Int32Array, x: Float64Array, y: Float64Array, n: number}} drawn
 * @param {number} px
 * @param {number} py
 * @param {Function} radiusOf (index into the points) -> px
 * @returns {number} the point's index, or -1
 */
export function hitTest(drawn, px, py, radiusOf) {
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < drawn.n; k++) {
    const dx = drawn.x[k] - px;
    const dy = drawn.y[k] - py;
    const d = dx * dx + dy * dy;
    const r = radiusOf(drawn.i[k]) + HIT_SLOP_PX;
    if (d <= r * r && d < bestD) { best = drawn.i[k]; bestD = d; }
  }
  return best;
}

/**
 * The popup for one point (D19 rule 4): the style's label in bold, then `label: value` per column with a value.
 * Everything escaped.
 * @param {Array} point
 * @param {{key: string, label: string}[]} columns
 * @param {{label: string}} style
 * @returns {string}
 */
export function pointPopupHtml(point, columns, style) {
  const lines = [];
  columns.forEach((c, n) => {
    const v = point[n + 3];
    if (v === null || v === undefined || v === "" || lines.length >= POPUP_LINES_MAX) return;
    if (typeof v !== "string" && !Number.isFinite(v)) return;
    lines.push(`${escapeHtml(c.label)}: ${escapeHtml(String(v))}`);
  });
  const title = `<b>${escapeHtml(style.label)}</b>`;
  return `<div class="ltmc-shape-info">${title}${lines.length ? `<br>${lines.join("<br>")}` : ""}</div>`;
}
