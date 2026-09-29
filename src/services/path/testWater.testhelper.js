/**
 * Synthetic water for the path tests: shapes in metres round an origin in
 * Chicago, answered per global cell the way TileStore answers.
 */
import { fromCell, CELLS_PER_TILE } from "./mercator.js";

export const O = { lat: 41.88, lng: -87.63 };
const KX = 111320 * Math.cos(O.lat * Math.PI / 180), KY = 110540;

/**
 * @param {number} x metres east of O
 * @param {number} y metres north of O
 * @returns {{lat: number, lng: number}}
 */
export function at(x, y) {
  return { lat: O.lat + y / KY, lng: O.lng + x / KX };
}

/**
 * @param {{lat: number, lng: number}} ll
 * @returns {{x: number, y: number}} metres east / north of O
 */
export function xy(ll) {
  return { x: (ll.lng - O.lng) * KX, y: (ll.lat - O.lat) * KY };
}

/**
 * @param {function(number, number): boolean} isWater in metres
 * @param {object} [opts]
 * @param {function(number, number): boolean} [opts.loaded] which tiles exist
 * @returns {object} a grid as TileStore answers
 */
export function makeGrid(isWater, opts = {}) {
  const loaded = opts.loaded ?? (() => true);
  const calls = { cell: 0 };
  return {
    calls,
    hasTile: (tx, ty) => loaded(tx, ty),
    cell(gx, gy) {
      calls.cell++;
      if (!loaded(Math.floor(gx / CELLS_PER_TILE), Math.floor(gy / CELLS_PER_TILE))) return -1;
      const p = xy(fromCell(gx + 0.5, gy + 0.5));
      return isWater(p.x, p.y) ? 1 : 0;
    },
  };
}

/**
 * An L-shaped river 40 m wide: west-east along y=0, then north along x=400.
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function lRiver(x, y) {
  return (Math.abs(y) <= 20 && x >= -600 && x <= 420) || (Math.abs(x - 400) <= 20 && y >= -20 && y <= 600);
}
