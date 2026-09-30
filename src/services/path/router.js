/**
 * Water routing between two fixes (item 270 part 2). Pure: no Leaflet, no
 * DOM, no network. The caller hands in a grid that answers, per global cell,
 * 1 water, 0 land, -1 not loaded; see mercator.js for the cell grid.
 *
 * The method is the offline prototype's (bin\lts_river_analyse.py), measured
 * on the Chicago River capture: A* on the raster in a window round the two
 * ends, each step costing up to 4x at the wall and fading ~10 m off it so
 * paths run mid-channel, then simplified and kept only if the simplified line
 * stays wet. Added for the card, from the 2026-09-29 measurements
 * (bin\river\p2_measure.txt, p2_land.txt):
 *  - a fix on land is SNAPPED to the nearest water (Lee, 2026-09-29: a boat
 *    is drawn in the water, not in a building); display only, never state;
 *  - a destination in water the router cannot reach (a dock that OSM seals
 *    off from the river with its own pier outline - all 8 unrouted river
 *    chords) is reached by routing to the nearest reachable water and a
 *    short straight connector;
 *  - a path more than MAX_RATIO times its chord is refused (12 of 372 river
 *    paths; nearly all moored boats jittering across a seawall).
 */
import { fromCell, toCell, metresPerCell, haversine, CELLS_PER_TILE } from "./mercator.js";
import { HARD } from "./rasterize.js";

export const DEFAULTS = Object.freeze({
  maxSnapM: 300,        // furthest a fix on land is moved to water (max seen: 268 m)
  landToleranceM: 5,    // a chord over land by less than this is noise
  marginM: 300,         // search window round the two ends, at least
  marginChordFactor: 0.6, // ...and this much of the chord, for long detours
  marginMaxM: 1200,     // ...but never more
  wallFadeM: 10,        // wall cost fades over this distance
  wallCost: 3,          // extra cost at the wall (step costs 1 + 3 = 4x there)
  connectorM: 60,       // longest straight connector into sealed-off water
  maxRatio: 2.0,        // path longer than this times its chord: refuse
  maxWindowCells: 1500000,
  simplifyM: [3, 1, 0], // tolerances tried, coarsest first
  wetToleranceM: 0.5,   // land a simplified inner leg may cross
});

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const DX = [-1, 1, 0, 0, -1, 1, -1, 1];
const DY = [0, 0, -1, 1, -1, -1, 1, 1];
const STEP = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/**
 * The search margin for a chord: long chords get room for long detours.
 * @param {{lat: number, lng: number}} a
 * @param {{lat: number, lng: number}} b
 * @param {object} [o] options
 * @returns {number} metres
 */
export function marginFor(a, b, o = DEFAULTS) {
  const chord = haversine(a, b);
  return Math.min(o.marginMaxM, Math.max(o.marginM, chord * o.marginChordFactor));
}

/**
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {Array<{x: number, y: number}>} tiles a cell box touches
 */
function tilesOfBox(x0, y0, x1, y1) {
  const out = [];
  for (let ty = Math.floor(y0 / CELLS_PER_TILE); ty <= Math.floor(y1 / CELLS_PER_TILE); ty++) {
    for (let tx = Math.floor(x0 / CELLS_PER_TILE); tx <= Math.floor(x1 / CELLS_PER_TILE); tx++) out.push({ x: tx, y: ty });
  }
  return out;
}

/**
 * Tiles the router needs for a chord, whether or not they are loaded.
 * @param {{lat: number, lng: number}} a
 * @param {{lat: number, lng: number}} b
 * @param {object} [options]
 * @returns {Array<{x: number, y: number}>}
 */
export function tilesForChord(a, b, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const mpc = metresPerCell((a.lat + b.lat) / 2);
  const m = Math.ceil(Math.max(marginFor(a, b, o), o.maxSnapM) / mpc);
  const ca = toCell(a.lat, a.lng), cb = toCell(b.lat, b.lng);
  return tilesOfBox(Math.min(ca.gx, cb.gx) - m, Math.min(ca.gy, cb.gy) - m,
    Math.max(ca.gx, cb.gx) + m, Math.max(ca.gy, cb.gy) + m);
}

/**
 * The nearest water to a point, or the point itself when it is in water.
 * @param {{lat: number, lng: number}} ll
 * @param {{cell: function(number, number): number}} grid
 * @param {number} maxM
 * @returns {{status: string, gx?: number, gy?: number, movedM?: number}}
 *   status 'ok', 'missing' (a tile in reach is not loaded) or 'none'
 */
export function snapToWater(ll, grid, maxM = DEFAULTS.maxSnapM) {
  const { gx, gy } = toCell(ll.lat, ll.lng);
  const cx = Math.floor(gx), cy = Math.floor(gy);
  const here = grid.cell(cx, cy);
  if (here === -1) return { status: "missing" };
  if (here === 1) return { status: "ok", gx, gy, movedM: 0 };
  const mpc = metresPerCell(ll.lat);
  const R = Math.ceil(maxM / mpc);
  let best = null, missing = false;
  for (let r = 1; r <= R; r++) {
    if (best && r - 1 > best.d) break;
    for (let dy = -r; dy <= r; dy++) {
      const step = (dy === -r || dy === r) ? 1 : 2 * r;
      for (let dx = -r; dx <= r; dx += step) {
        const v = grid.cell(cx + dx, cy + dy);
        if (v === -1) { missing = true; continue; }
        if (v !== 1) continue;
        const x = cx + dx + 0.5, y = cy + dy + 0.5;
        const d = Math.hypot(x - gx, y - gy);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
  }
  if (best && best.d * mpc <= maxM) return { status: "ok", gx: best.x, gy: best.y, movedM: best.d * mpc };
  return { status: missing ? "missing" : "none" };
}

/**
 * Metres of land a straight line crosses, sampling every quarter cell.
 * @param {{cell: function(number, number): number}} grid
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} mpc metres per cell
 * @returns {number} metres, or -1 if it touches a cell not loaded, or Infinity if
 *   it touches a pier or breakwater (HARD), which no tolerance forgives
 */
export function landAlong(grid, x0, y0, x1, y1, mpc) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len * 4));
  let land = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const v = grid.cell(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t));
    if (v === -1) return -1;
    if (v === HARD) return Infinity;
    if (v !== 1) land++;
  }
  return land * (len / n) * mpc;
}

/**
 * Two-pass chamfer distance, in cells, from every water cell to the nearest
 * land cell (0 on land).
 * @param {Uint8Array} mask 1 water
 * @param {number} w
 * @param {number} h
 * @returns {Float32Array}
 */
export function distanceToLand(mask, w, h) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - w] + a);
        if (x > 0) v = Math.min(v, d[i - w - 1] + b);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (x > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

/** A binary min-heap of (priority, index), in two typed-array-backed lists. */
class Heap {
  constructor() { this.p = []; this.v = []; }
  get size() { return this.p.length; }
  push(pri, val) {
    const p = this.p, v = this.v;
    let i = p.length; p.push(pri); v.push(val);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= pri) break;
      p[i] = p[j]; v[i] = v[j]; i = j;
    }
    p[i] = pri; v[i] = val;
  }
  pop() {
    const p = this.p, v = this.v;
    const top = v[0], lastP = p.pop(), lastV = v.pop();
    if (p.length) {
      let i = 0;
      const n = p.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lastP) break;
        p[i] = p[c]; v[i] = v[c]; i = c;
      }
      p[i] = lastP; v[i] = lastV;
    }
    return top;
  }
}

/**
 * A* over a window mask. Returns the cell indices from start to goal, or, if
 * the goal cannot be reached, to the reached cell nearest it (`reached:
 * false`).
 * @param {Uint8Array} mask
 * @param {Float32Array} cost
 * @param {number} w
 * @param {number} h
 * @param {number} start
 * @param {number} goal
 * @param {number} [weight] heuristic multiplier
 * @returns {{cells: Array<number>, reached: boolean}}
 */
export function astar(mask, cost, w, h, start, goal, weight = 1) {
  const g = new Float32Array(w * h).fill(Infinity);
  const came = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const gx = goal % w, gy = (goal / w) | 0;
  const heur = (i) => {
    const dx = Math.abs(i % w - gx), dy = Math.abs(((i / w) | 0) - gy);
    return weight * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
  };
  const heap = new Heap();
  g[start] = 0; heap.push(heur(start), start);
  let nearest = start, nearestH = heur(start);
  while (heap.size) {
    const u = heap.pop();
    if (closed[u]) continue;
    closed[u] = 1;
    const hu = heur(u);
    if (hu < nearestH) { nearestH = hu; nearest = u; }
    if (u === goal) break;
    const ux = u % w, uy = (u / w) | 0, gu = g[u];
    for (let k = 0; k < 8; k++) {
      const x = ux + DX[k], y = uy + DY[k];
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const v = y * w + x;
      if (!mask[v] || closed[v]) continue;
      const nc = gu + STEP[k] * cost[v];
      if (nc < g[v]) { g[v] = nc; came[v] = u; heap.push(nc + heur(v), v); }
    }
  }
  const end = closed[goal] ? goal : nearest;
  const cells = [];
  for (let u = end; u !== -1; u = came[u]) cells.push(u);
  cells.reverse();
  return { cells, reached: end === goal };
}

/**
 * Douglas-Peucker on [x, y] points.
 * @param {Array<Array<number>>} pts
 * @param {number} tol
 * @returns {Array<Array<number>>}
 */
export function simplify(pts, tol) {
  if (tol <= 0 || pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * @param {Array<Array<number>>} pts
 * @returns {number}
 */
function lengthOf(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/**
 * Route between two fixes through water.
 * @param {{lat: number, lng: number}} a where the slide starts (the fix it left)
 * @param {{lat: number, lng: number}} b the new fix
 * @param {{cell: function(number, number): number, hasTile: function(number, number): boolean}} grid
 * @param {object} [options] overrides of DEFAULTS
 * @returns {{status: string, points?: Array<{lat: number, lng: number}>, tiles?: Array, reason?: string}}
 *   status: 'missing' (tiles listed), 'straight' (the snapped chord is wet),
 *   'path', or 'refused' (reason says why; the caller slides straight)
 */
export function routeWater(a, b, grid, options = {}) {
  const o = { ...DEFAULTS, ...options };
  // Phase timing for measurement only: options.profile gets timestamps.
  const prof = options.profile;
  const mark = prof ? (k) => { prof[k] = clock(); } : () => {};
  mark("start");
  const need = tilesForChord(a, b, o);
  const missing = need.filter((t) => !grid.hasTile(t.x, t.y));
  if (missing.length) return { status: "missing", tiles: missing };

  const mpc = metresPerCell((a.lat + b.lat) / 2);
  const sa = snapToWater(a, grid, o.maxSnapM);
  const sb = snapToWater(b, grid, o.maxSnapM);
  if (sa.status !== "ok" || sb.status !== "ok") return { status: "refused", reason: "no water near an end" };
  mark("snapped");
  const A = fromCell(sa.gx, sa.gy), B = fromCell(sb.gx, sb.gy);
  const ends = [sa.movedM ? A : a, sb.movedM ? B : b];

  const land = landAlong(grid, sa.gx, sa.gy, sb.gx, sb.gy, mpc);
  if (land >= 0 && land <= o.landToleranceM) return { status: "straight", points: ends };

  const m = Math.ceil(marginFor(a, b, o) / mpc);
  const x0 = Math.floor(Math.min(sa.gx, sb.gx)) - m, y0 = Math.floor(Math.min(sa.gy, sb.gy)) - m;
  const x1 = Math.floor(Math.max(sa.gx, sb.gx)) + m, y1 = Math.floor(Math.max(sa.gy, sb.gy)) + m;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w * h > o.maxWindowCells) return { status: "refused", reason: "window too large", points: ends };

  const mask = new Uint8Array(w * h);
  // A tile store copies whole rows (fillWindow); anything else answers per cell.
  if (!(typeof grid.fillWindow === "function" && grid.fillWindow(x0, y0, w, h, mask))) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = grid.cell(x0 + x, y0 + y) === 1 ? 1 : 0;
  } else {
    // The store's rows carry HARD for piers and breakwaters: land, to the search.
    for (let i = 0; i < mask.length; i++) if (mask[i] !== 1) mask[i] = 0;
  }
  mark("mask");
  const dist = distanceToLand(mask, w, h);
  mark("distance");
  const fade = o.wallFadeM / mpc;
  const cost = new Float32Array(w * h);
  for (let i = 0; i < cost.length; i++) if (mask[i]) cost[i] = 1 + o.wallCost * Math.exp(-dist[i] / fade);

  mark("cost");
  if (prof) prof.cells = w * h;
  const idx = (gx, gy) => (Math.floor(gy) - y0) * w + (Math.floor(gx) - x0);
  const start = idx(sa.gx, sa.gy), goal = idx(sb.gx, sb.gy);
  if (start === goal) return { status: "straight", points: ends };
  const { cells, reached } = astar(mask, cost, w, h, start, goal, o.heuristicWeight);
  const cellXY = (c) => [c % w + x0 + 0.5, ((c / w) | 0) + y0 + 0.5];
  const gapM = (c, gx, gy) => { const [x, y] = cellXY(c); return Math.hypot(x - gx, y - gy) * mpc; };
  let head = null, tail = null, water = cells;
  if (!reached) {
    // Leaving a dock sealed off from the river is the same problem from the
    // other end: try the connector at the start by routing backwards.
    if (gapM(cells[cells.length - 1], sb.gx, sb.gy) <= o.connectorM) {
      tail = [sb.gx, sb.gy];
    } else {
      const back = astar(mask, cost, w, h, goal, start, o.heuristicWeight);
      if (gapM(back.cells[back.cells.length - 1], sa.gx, sa.gy) > o.connectorM) return { status: "refused", reason: "no water path", points: ends };
      water = back.cells.slice().reverse();
      head = [sa.gx, sa.gy];
    }
  }

  mark("astar");
  const raw = water.map(cellXY);
  if (head) raw[raw.length - 1] = [sb.gx, sb.gy]; else raw[0] = [sa.gx, sa.gy];
  if (reached) raw[raw.length - 1] = [sb.gx, sb.gy];

  // The water part is simplified and checked; a connector is appended after,
  // so simplification can never stretch it across more land.
  let line = raw;
  for (const tolM of o.simplifyM) {
    const cand = simplify(raw, tolM / mpc);
    if (allWet(grid, cand, mpc, o.wetToleranceM)) { line = cand; break; }
  }
  if (tail) line = line.concat([tail]);
  if (head) line = [head].concat(line);

  mark("simplified");
  const chordCells = Math.hypot(sb.gx - sa.gx, sb.gy - sa.gy);
  if (chordCells > 0 && lengthOf(line) / chordCells > o.maxRatio) return { status: "refused", reason: "path over the ratio cap", points: ends };

  const points = line.map(([x, y]) => fromCell(x, y));
  points[0] = ends[0];
  points[points.length - 1] = ends[1];
  return { status: "path", points };
}

/**
 * Every leg of a line stays wet, within tolM of land. The ends are already
 * snapped into water, so no leg is excused.
 * @param {{cell: function(number, number): number}} grid
 * @param {Array<Array<number>>} pts
 * @param {number} mpc
 * @param {number} tolM
 * @returns {boolean}
 */
export function allWet(grid, pts, mpc, tolM) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const land = landAlong(grid, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], mpc);
    if (land < 0 || land > tolM) return false;
  }
  return true;
}
