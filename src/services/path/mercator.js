/**
 * Web Mercator cell arithmetic for path-following (item 270 part 2).
 *
 * The water raster is a global grid: every z14 tile is rasterised at
 * CELLS_PER_TILE x CELLS_PER_TILE cells, so a cell is (tile size / 512) -
 * about 3.5 m at 42 N, 4.8 m at the equator, 2.4 m at 60 N. Cell (gx, gy) is
 * the same place whichever tile source drew it. Nothing here knows Leaflet.
 */

export const TILE_ZOOM = 14;
export const CELLS_PER_TILE = 512;
export const WORLD_CELLS = (2 ** TILE_ZOOM) * CELLS_PER_TILE;
const EARTH_CIRCUMFERENCE_M = 40075016.686;
const MAX_LAT = 85.05112878;

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {{gx: number, gy: number}} fractional global cell coordinates
 */
export function toCell(lat, lng) {
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const s = Math.sin(la * Math.PI / 180);
  const gx = (lng + 180) / 360 * WORLD_CELLS;
  const gy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD_CELLS;
  return { gx, gy };
}

/**
 * @param {number} gx
 * @param {number} gy
 * @returns {{lat: number, lng: number}}
 */
export function fromCell(gx, gy) {
  const lng = gx / WORLD_CELLS * 360 - 180;
  const n = Math.PI - 2 * Math.PI * gy / WORLD_CELLS;
  const lat = 180 / Math.PI * Math.atan(Math.sinh(n));
  return { lat, lng };
}

/**
 * Ground metres per cell at a latitude.
 * @param {number} lat
 * @returns {number}
 */
export function metresPerCell(lat) {
  return EARTH_CIRCUMFERENCE_M * Math.cos(lat * Math.PI / 180) / WORLD_CELLS;
}

/**
 * The z14 tile holding a cell.
 * @param {number} gx
 * @param {number} gy
 * @returns {{x: number, y: number}}
 */
export function tileOfCell(gx, gy) {
  return { x: Math.floor(gx / CELLS_PER_TILE), y: Math.floor(gy / CELLS_PER_TILE) };
}

/**
 * Great-circle distance in metres.
 * @param {{lat: number, lng: number}} a
 * @param {{lat: number, lng: number}} b
 * @returns {number}
 */
export function haversine(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
