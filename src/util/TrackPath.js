/**
 * The rail route hint (06_MAP_CONTRACT.md D3c-v): an emitter that knows its
 * line publishes `track_path`, the line from where the object was last
 * drawn to where it is now, and the card slides along it instead of across.
 *
 * Lee, 2026-10-09 17:44: "Trains are off the track by a long way". The
 * PUBLISHED positions were on the line (p50 3 m); the straight slide between
 * two of them, up to 30 s and 2 km apart, cut across curves.
 *
 * Display only: nothing is written to state (D3c-ii).
 */

/** At most this many points are read; more is refused whole. */
export const TRACK_PATH_MAX_POINTS = 500;
/** The path must end this close to where the marker is going, or it is stale. */
export const TRACK_PATH_END_M = 5;
/**
 * ...and pass this close to where the marker is drawn. A marker still sliding
 * along the last path is behind the start of the new one by what is left of
 * that slide; a card opened late, or a hidden tab, can be farther: then the
 * slide is the straight one, as before.
 */
export const TRACK_PATH_JOIN_M = 1000;

/**
 * Metres between two points, equirectangular: plenty at these distances.
 * @param {{lat: number, lng: number}} a
 * @param {{lat: number, lng: number}} b
 * @returns {number}
 */
export function metres(a, b) {
  const k = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(b.lat - a.lat, (b.lng - a.lng) * k) * 111195;
}

/**
 * An emitted `track_path`: an array of 2 to TRACK_PATH_MAX_POINTS [lat, lon]
 * pairs of finite numbers in range, as {lat, lng}; anything else null.
 * @param {*} value
 * @returns {Array<{lat: number, lng: number}>|null}
 */
export function parseTrackPath(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > TRACK_PATH_MAX_POINTS) return null;
  const pts = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [lat, lng] = p;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    pts.push({ lat, lng });
  }
  return pts;
}

/**
 * The route to slide along from `start` (where the marker is drawn) to `to`
 * (where it is going), or null for the straight slide: [start, the nearest
 * point of the path to start, the path's points after it ..., to].
 * @param {*} value the entity's track_path attribute
 * @param {{lat: number, lng: number}} start
 * @param {{lat: number, lng: number}} to
 * @returns {Array<{lat: number, lng: number}>|null}
 */
export function trackRoute(value, start, to) {
  const pts = parseTrackPath(value);
  if (!pts || !start || !to) return null;
  if (metres(pts[pts.length - 1], to) > TRACK_PATH_END_M) return null;
  // The nearest point of the path to start, in a local metric frame.
  const k = Math.cos(start.lat * Math.PI / 180);
  let best = { d: Infinity, i: 0, p: pts[0] };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const ax = (a.lng - start.lng) * k, ay = a.lat - start.lat;
    const bx = (b.lng - start.lng) * k, by = b.lat - start.lat;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
    const p = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    const d = metres(start, p);
    if (d < best.d) best = { d, i, p };
  }
  if (best.d > TRACK_PATH_JOIN_M) return null;
  // The joining point is dropped when the marker is already on it: a leg of
  // no length has no bearing for the picture or the arrow to face.
  const join = best.d < 1 ? [] : [best.p];
  return [start, ...join, ...pts.slice(best.i + 1, -1), to];
}
