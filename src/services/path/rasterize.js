/**
 * Rasterise vector-tile geometry into one tile's water grid (item 270 part 2).
 *
 * The grid is size x size cells, row-major, 1 = water. Geometry arrives in
 * tile units (0..extent); features may run past the tile edge (the tile
 * buffer) and are clipped here. Pure: no Leaflet, no DOM.
 */

/**
 * Fill a polygon feature by the even-odd rule over ALL its rings, which is
 * what an MVT polygon means: holes sit inside their outer ring. Each FEATURE
 * is filled on its own, so two overlapping water features never cancel.
 * @param {Uint8Array} grid
 * @param {number} size cells per side
 * @param {number} extent tile units per side
 * @param {Array<Array<{x: number, y: number}>>} rings
 * @param {number} value 1 to paint water, 0 to clear it
 */
export function fillPolygon(grid, size, extent, rings, value) {
  const k = size / extent;
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const ay = a.y * k, by = b.y * k;
      if (ay === by) continue;
      edges.push([a.x * k, ay, b.x * k, by]);
      if (ay < minY) minY = ay; if (by < minY) minY = by;
      if (ay > maxY) maxY = ay; if (by > maxY) maxY = by;
    }
  }
  if (!edges.length) return;
  const r0 = Math.max(0, Math.floor(minY)), r1 = Math.min(size - 1, Math.ceil(maxY));
  const xs = [];
  for (let row = r0; row <= r1; row++) {
    const y = row + 0.5;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) {
        xs.push(x0 + (y - y0) * (x1 - x0) / (y1 - y0));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    const base = row * size;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      // Cells whose CENTRE lies between the two crossings.
      const c0 = Math.max(0, Math.ceil(xs[i] - 0.5));
      const c1 = Math.min(size - 1, Math.floor(xs[i + 1] - 0.5));
      for (let c = c0; c <= c1; c++) grid[base + c] = value;
    }
  }
}

/**
 * Paint every cell whose centre lies within `radius` cells of a line.
 * @param {Uint8Array} grid
 * @param {number} size
 * @param {number} extent
 * @param {Array<Array<{x: number, y: number}>>} lines
 * @param {number} radius in cells
 * @param {number} value
 */
export function strokeLines(grid, size, extent, lines, radius, value) {
  const k = size / extent;
  const r2 = radius * radius;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const ax = line[i].x * k, ay = line[i].y * k;
      const bx = line[i + 1].x * k, by = line[i + 1].y * k;
      const c0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
      const c1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + radius));
      const r0 = Math.max(0, Math.floor(Math.min(ay, by) - radius));
      const r1 = Math.min(size - 1, Math.ceil(Math.max(ay, by) + radius));
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      for (let row = r0; row <= r1; row++) {
        const py = row + 0.5;
        for (let c = c0; c <= c1; c++) {
          const px = c + 0.5;
          let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + t * dx - px, ey = ay + t * dy - py;
          if (ex * ex + ey * ey <= r2) grid[row * size + c] = value;
        }
      }
    }
  }
}

/**
 * Build one tile's water grid from adapter output: water polygons painted,
 * then structure polygons and structure lines cleared.
 * @param {{extent: number, water: Array, structurePolygons: Array, structureLines: Array}} geom
 * @param {number} size
 * @param {number} lineRadiusCells half-width of a pier or breakwater LINE, in cells
 * @returns {Uint8Array}
 */
export function rasteriseTile(geom, size, lineRadiusCells) {
  const grid = new Uint8Array(size * size);
  for (const rings of geom.water) fillPolygon(grid, size, geom.extent, rings, 1);
  for (const rings of geom.structurePolygons) fillPolygon(grid, size, geom.extent, rings, 0);
  strokeLines(grid, size, geom.extent, geom.structureLines, lineRadiusCells, 0);
  return grid;
}

/**
 * Run-length encode a 0/1 grid, for the 7-day store: water and land come in
 * long runs, so a tile shrinks from 256 KB to a few KB.
 * @param {Uint8Array} grid
 * @returns {Uint32Array} run lengths, alternating, starting with a run of 0s
 */
export function encodeRuns(grid) {
  const runs = [];
  let cur = 0, n = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === cur) { n++; continue; }
    runs.push(n); cur = grid[i]; n = 1;
  }
  runs.push(n);
  return Uint32Array.from(runs);
}

/**
 * @param {Uint32Array|Array<number>} runs
 * @param {number} length
 * @returns {Uint8Array|null} null when the runs do not add up to `length`
 */
export function decodeRuns(runs, length) {
  const grid = new Uint8Array(length);
  let i = 0, v = 0;
  for (const n of runs) {
    if (i + n > length) return null;
    if (v) grid.fill(1, i, i + n);
    i += n; v ^= 1;
  }
  return i === length ? grid : null;
}
