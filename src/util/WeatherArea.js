/**
 * `weather_area`: the one place weather is drawn (Lee, 2026-11-02). Shapes outside it are not drawn and radar tiles
 * outside its box are not asked for. Nothing here names a publisher or a place.
 */

const KM_PER_DEG = 111.2;
const STEP_DEG = 0.25;
const MAX_STEPS = 64;

/**
 * @param {*} input `{latitude, longitude, radius_km}`
 * @returns {?{lat: number, lon: number, km: number}} null when absent or not usable
 */
export function parseWeatherArea(input) {
  if (input === null || typeof input !== "object") return null;
  const { latitude: lat, longitude: lon, radius_km: km } = input;
  if (![lat, lon, km].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || km <= 0) return null;
  return { lat, lon, km };
}

/**
 * @param {{lat: number, lon: number, km: number}} area
 * @returns {number[][]} [[south, west], [north, east]], the box around the circle, as Leaflet takes it
 */
export function areaBounds(area) {
  const dLat = area.km / KM_PER_DEG;
  const dLon = area.km / (KM_PER_DEG * Math.max(Math.cos((area.lat * Math.PI) / 180), 0.01));
  return [[area.lat - dLat, area.lon - dLon], [area.lat + dLat, area.lon + dLon]];
}

/**
 * Near enough for a circle of tens of km and up: flat earth at the area's latitude.
 * @returns {boolean} the point is inside the circle
 */
function inArea(lon, lat, area) {
  const dy = (lat - area.lat) * KM_PER_DEG;
  const dx = (lon - area.lon) * KM_PER_DEG * Math.cos((area.lat * Math.PI) / 180);
  return dx * dx + dy * dy <= area.km * area.km;
}

/** @returns {boolean} a vertex of the path, or a point along a segment, is inside the circle */
function pathTouches(path, area) {
  for (let i = 0; i < path.length; i++) {
    const [lon, lat] = path[i];
    if (inArea(lon, lat, area)) return true;
    if (i === 0) continue;
    const [lon0, lat0] = path[i - 1];
    const steps = Math.min(MAX_STEPS, Math.ceil(Math.max(Math.abs(lon - lon0), Math.abs(lat - lat0)) / STEP_DEG));
    for (let s = 1; s < steps; s++) {
      if (inArea(lon0 + ((lon - lon0) * s) / steps, lat0 + ((lat - lat0) * s) / steps, area)) return true;
    }
  }
  return false;
}

/** @returns {boolean} the point is inside the ring (ray casting) */
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Whether a shape applies to the area: its outline crosses or lies inside the circle, or it covers the circle's centre.
 * @param {{type: string, coordinates: Array}} geometry GeoJSON Polygon, MultiPolygon, LineString or MultiLineString
 * @param {{lat: number, lon: number, km: number}} area
 * @returns {boolean}
 */
export function geometryTouchesArea(geometry, area) {
  const c = geometry?.coordinates;
  if (!Array.isArray(c)) return false;
  if (geometry.type === "LineString") return pathTouches(c, area);
  if (geometry.type === "MultiLineString") return c.some((p) => pathTouches(p, area));
  const polys = geometry.type === "Polygon" ? [c] : geometry.type === "MultiPolygon" ? c : [];
  return polys.some((rings) => rings.some((r) => pathTouches(r, area)) || (rings[0] && inRing(area.lon, area.lat, rings[0])));
}
