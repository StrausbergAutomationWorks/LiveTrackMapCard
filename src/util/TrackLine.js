/**
 * A marker's recent track, fetched on click (06_MAP_CONTRACT.md D4h `marker_track`, backlog 348).
 *
 * The integration keeps the track and publishes only WHERE to fetch it: a path under `/api/` that the card asks
 * with the viewer's own sign-in (hass.callApi). Nothing is fetched or drawn until the viewer presses "Track" in the
 * click popup, so a busy port is never covered in lines. The answer holds REAL fixes only (D3c-ii), oldest first.
 */

export const TRACK_COLOR_DEFAULT = "#ff6d00";
export const TRACK_WEIGHT = 3;
export const TRACK_OPACITY = 0.85;
export const TRACK_POINTS_MAX = 25000;

const PATH = /^\/api\/[A-Za-z0-9_\-/]+$/;
const COLOR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/**
 * `marker_track` -> the API path, or null. A path under /api/ of letters, digits, `_`, `-` and `/` only, with no
 * empty segment.
 * @param {*} v
 * @returns {?string}
 */
export function trackOf(v) {
  if (typeof v !== "string" || v.length > 200 || !PATH.test(v) || v.includes("//") || v.endsWith("/")) return null;
  return v;
}

/**
 * hass.callApi takes the path without `/api/`.
 * @param {string} path a checked `marker_track`
 * @returns {string}
 */
export function apiPath(path) {
  return path.slice("/api/".length);
}

/**
 * The answer's `points` -> [[lat, lon], ...], keeping only well-formed pairs, at most TRACK_POINTS_MAX (the newest).
 * @param {*} answer
 * @returns {number[][]}
 */
export function trackPoints(answer) {
  const pts = Array.isArray(answer?.points) ? answer.points : [];
  const out = [];
  for (const p of pts) {
    if (!Array.isArray(p)) continue;
    const [lat, lon] = p;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.push([lat, lon]);
  }
  return out.length > TRACK_POINTS_MAX ? out.slice(out.length - TRACK_POINTS_MAX) : out;
}

/**
 * The line's colour: the marker's own `marker_color` when it is a hex colour, else the default.
 * @param {object} attrs
 * @returns {string}
 */
export function trackColor(attrs) {
  const c = attrs?.marker_color;
  return typeof c === "string" && COLOR.test(c.trim()) ? c.trim() : TRACK_COLOR_DEFAULT;
}

/**
 * Append the marker's current position when it is new (not the last point).
 * @param {number[][]} latlngs
 * @param {?number} lat
 * @param {?number} lon
 * @returns {boolean} whether it was appended
 */
export function appendPosition(latlngs, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const last = latlngs[latlngs.length - 1];
  if (last && last[0] === lat && last[1] === lon) return false;
  latlngs.push([lat, lon]);
  return true;
}
