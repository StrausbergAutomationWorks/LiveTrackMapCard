/**
 * @jest-environment node
 */
import { routeWater, snapToWater, landAlong, simplify, distanceToLand, astar, tilesForChord, marginFor, allWet } from "./router.js";
import { HARD, rasteriseTile, strokeLines, MIN_LINE_RADIUS_CELLS } from "./rasterize.js";
import { TileStore } from "./TileStore.js";
import { toCell, fromCell, metresPerCell, haversine, CELLS_PER_TILE } from "./mercator.js";
import { at, xy, makeGrid, lRiver } from "./testWater.testhelper.js";

const wetAll = (grid, pts) => {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = toCell(pts[i].lat, pts[i].lng), b = toCell(pts[i + 1].lat, pts[i + 1].lng);
    const land = landAlong(grid, a.gx, a.gy, b.gx, b.gy, metresPerCell(pts[i].lat));
    if (land > 1) return false;
  }
  return true;
};
const pathLength = (pts) => pts.slice(1).reduce((s, p, i) => s + haversine(pts[i], p), 0);

describe("snapToWater", () => {
  const grid = makeGrid(lRiver);
  test("a fix in the water stays where it is", () => {
    const s = snapToWater(at(0, 5), grid);
    expect(s.status).toBe("ok");
    expect(s.movedM).toBe(0);
  });
  test("a fix on land moves to the nearest water, about as far as the bank", () => {
    const s = snapToWater(at(0, 70), grid);
    expect(s.status).toBe("ok");
    expect(s.movedM).toBeGreaterThan(45);
    expect(s.movedM).toBeLessThan(55);
    expect(grid.cell(Math.floor(s.gx), Math.floor(s.gy))).toBe(1);
  });
  test("beyond the limit there is no snap", () => {
    expect(snapToWater(at(0, 400), grid, 300).status).toBe("none");
  });

  test("the limit is a distance, not a square: water 340 m away on the diagonal is too far", () => {
    // Inside the square the search walks (240 m < 300 m on each axis) but 339 m away.
    const pond = makeGrid((x, y) => x >= 240 && x <= 260 && y >= 240 && y <= 260);
    expect(snapToWater(at(0, 0), pond, 300).status).toBe("none");
    expect(snapToWater(at(0, 0), pond, 350).status).toBe("ok");
  });
  test("a tile not loaded is reported, not guessed", () => {
    const g = makeGrid(lRiver, { loaded: () => false });
    expect(snapToWater(at(0, 0), g).status).toBe("missing");
  });
});

describe("routeWater", () => {
  const grid = makeGrid(lRiver);

  test("a chord that stays in the water is a straight slide between the fixes", () => {
    const a = at(-300, 0), b = at(-100, 5);
    const r = routeWater(a, b, grid);
    expect(r.status).toBe("straight");
    expect(r.points).toEqual([a, b]);
  });

  test("a chord across the corner is routed round it, wet all the way", () => {
    const a = at(200, 0), b = at(400, 250);
    const r = routeWater(a, b, grid);
    expect(r.status).toBe("path");
    expect(r.points[0]).toEqual(a);
    expect(r.points[r.points.length - 1]).toEqual(b);
    expect(r.points.length).toBeGreaterThan(2);
    expect(wetAll(grid, r.points)).toBe(true);
    const ratio = pathLength(r.points) / haversine(a, b);
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(1.5);
  });

  test("the path keeps off the walls: its turning points sit well inside the 40 m channel", () => {
    const r = routeWater(at(200, 0), at(400, 250), grid);
    const inner = r.points.slice(1, -1);
    expect(inner.length).toBeGreaterThan(0);
    for (const p of inner) {
      const q = xy(p);
      // Within 12 m of the centre line of either arm, so at least 8 m from
      // its banks. A shortest path with no wall cost turns at the inside
      // corner (380, 20), 20 m off both centre lines.
      const westArm = q.x <= 420 && Math.abs(q.y) <= 12;
      const northArm = q.y >= -20 && Math.abs(q.x - 400) <= 12;
      expect(westArm || northArm).toBe(true);
    }
  });

  test("a fix on land is drawn in the water: the last point is snapped, not the fix", () => {
    const a = at(200, 0), b = at(460, 250); // 40 m east of the north arm's bank
    const r = routeWater(a, b, grid);
    expect(r.status).toBe("path");
    const end = xy(r.points[r.points.length - 1]);
    expect(Math.abs(end.x - 400)).toBeLessThanOrEqual(21);
    expect(wetAll(grid, r.points)).toBe(true);
  });

  test("a path more than twice its chord is refused, and the snapped ends come back", () => {
    // Two arms 60 m apart joined only 800 m away: a U.
    const u = (x, y) => (Math.abs(y) <= 15 && x >= -100 && x <= 800) || (Math.abs(y - 80) <= 15 && x >= -100 && x <= 800) || (x >= 780 && x <= 800 && y >= -15 && y <= 95);
    const g = makeGrid(u);
    const r = routeWater(at(0, 0), at(0, 80), g, { marginM: 900 });
    expect(r.status).toBe("refused");
    expect(r.reason).toBe("path over the ratio cap");
    expect(r.points).toHaveLength(2);
  });

  test("water sealed off by a pier outline is reached with a short connector", () => {
    // A dock pond 12 m north of the river bank, not joined to it.
    const dock = (x, y) => lRiver(x, y) || (x >= -60 && x <= -20 && y >= 32 && y <= 70);
    const g = makeGrid(dock);
    const a = at(-300, 0), b = at(-40, 50);
    const r = routeWater(a, b, g);
    expect(r.status).toBe("path");
    expect(r.points[r.points.length - 1]).toEqual(b);
    // Everything but the connector is wet.
    expect(wetAll(g, r.points.slice(0, -1))).toBe(true);
    expect(haversine(r.points[r.points.length - 2], b)).toBeLessThanOrEqual(60);
  });

  test("leaving a sealed dock takes the connector at the start", () => {
    const dock = (x, y) => lRiver(x, y) || (x >= -60 && x <= -20 && y >= 32 && y <= 70);
    const g = makeGrid(dock);
    const a = at(-40, 50), b = at(-300, 0);
    const r = routeWater(a, b, g);
    expect(r.status).toBe("path");
    expect(r.points[0]).toEqual(a);
    expect(wetAll(g, r.points.slice(1))).toBe(true);
  });

  test("sealed-off water further than the connector allows is refused", () => {
    const pond = (x, y) => lRiver(x, y) || (x >= -60 && x <= -20 && y >= 150 && y <= 190);
    const g = makeGrid(pond);
    const r = routeWater(at(-300, 0), at(-40, 170), g);
    expect(r.status).toBe("refused");
    expect(r.reason).toBe("no water path");
  });

  test("a long chord gets a window wide enough for a long detour (round the end of a pier)", () => {
    // A spit 120 m wide from x = -500 to 1,950 between two open basins; the
    // way round is 550 m past the chord's east end - beyond a fixed 300 m margin.
    const spit = (x, y) => x >= -500 && x <= 2500 && y >= -600 && y <= 600 && !(Math.abs(y) <= 60 && x <= 1950);
    const g = makeGrid(spit);
    const a = at(0, -100), b = at(1500, 100);
    const r = routeWater(a, b, g);
    expect(r.status).toBe("path");
    expect(Math.max(...r.points.map((p) => xy(p).x))).toBeGreaterThan(1950);
    expect(routeWater(a, b, g, { marginChordFactor: 0 }).status).toBe("refused");
  });

  test("tiles not loaded: nothing is routed and the tiles are listed", () => {
    const g = makeGrid(lRiver, { loaded: () => false });
    const r = routeWater(at(200, 0), at(400, 250), g);
    expect(r.status).toBe("missing");
    expect(r.tiles.length).toBeGreaterThan(0);
    expect(r.tiles).toEqual(tilesForChord(at(200, 0), at(400, 250)));
  });

  test("no water near an end: refused, with no points", () => {
    const r = routeWater(at(0, 0), at(0, 900), grid);
    expect(r.status).toBe("refused");
    expect(r.points).toBeUndefined();
  });
});

describe("pieces", () => {
  test("the search margin grows with the chord, between 300 m and 1,200 m", () => {
    expect(marginFor(at(0, 0), at(100, 0))).toBe(300);
    expect(marginFor(at(0, 0), at(1000, 0))).toBeCloseTo(600, -1);
    expect(marginFor(at(0, 0), at(5000, 0))).toBe(1200);
  });

  test("tilesForChord covers the grown margin: a long chord asks for more tiles", () => {
    const short = tilesForChord(at(0, 0), at(100, 0)).length;
    const long = tilesForChord(at(0, 0), at(2500, 0));
    expect(long.length).toBeGreaterThan(short);
    // The margin (1,200 m here) reaches past both ends.
    const cells = long.map((t) => t.x);
    const west = toCell(at(-1150, 0).lat, at(-1150, 0).lng).gx / 512;
    expect(Math.min(...cells)).toBeLessThanOrEqual(Math.floor(west));
  });

  test("allWet: a line in the water is wet; one across the bank is not", () => {
    const grid = makeGrid(lRiver);
    const c = (x, y) => { const q = at(x, y); const t = toCell(q.lat, q.lng); return [t.gx, t.gy]; };
    const mpc = metresPerCell(41.88);
    expect(allWet(grid, [c(-300, 0), c(-100, 0), c(300, 5)], mpc, 0.5)).toBe(true);
    expect(allWet(grid, [c(-300, 0), c(-100, 60), c(300, 5)], mpc, 0.5)).toBe(false);
  });

  test("simplify keeps the ends and drops collinear points", () => {
    expect(simplify([[0, 0], [1, 0], [2, 0], [2, 5]], 0.5)).toEqual([[0, 0], [2, 0], [2, 5]]);
    expect(simplify([[0, 0], [1, 0.2], [2, 0]], 0)).toEqual([[0, 0], [1, 0.2], [2, 0]]);
  });

  test("distanceToLand counts cells to the nearest land", () => {
    const w = 7, h = 1, m = new Uint8Array([0, 1, 1, 1, 1, 1, 0]);
    expect(Array.from(distanceToLand(m, w, h))).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });

  test("astar reaches the goal, or stops at the reached cell nearest it", () => {
    const w = 5, h = 1;
    const cost = new Float32Array(5).fill(1);
    expect(astar(new Uint8Array([1, 1, 1, 1, 1]), cost, w, h, 0, 4)).toEqual({ cells: [0, 1, 2, 3, 4], reached: true });
    expect(astar(new Uint8Array([1, 1, 0, 1, 1]), cost, w, h, 0, 4)).toEqual({ cells: [0, 1], reached: false });
  });
});


describe("piers and breakwaters are never crossed (HARD, 2026-09-29)", () => {
  // Open water with a band exactly one cell wide (3.6 m here) and 600 m long at x = 0:
  // a line-mapped breakwater as the rasteriser draws it.
  const bandGrid = (value) => {
    const col = Math.floor(toCell(at(0, 0).lat, at(0, 0).lng).gx);
    return {
      hasTile: () => true,
      cell(gx, gy) {
        const p = xy(fromCell(gx + 0.5, gy + 0.5));
        return gx === col && Math.abs(p.y) <= 300 ? value : 1;
      },
    };
  };

  test("landAlong: a HARD cell is never forgiven", () => {
    const g = bandGrid(HARD);
    const a = toCell(at(-50, 0).lat, at(-50, 0).lng), b = toCell(at(50, 0).lat, at(50, 0).lng);
    expect(landAlong(g, a.gx, a.gy, b.gx, b.gy, metresPerCell(41.88))).toBe(Infinity);
  });

  test("a chord across a thin breakwater is not straight; the same band as plain land still is", () => {
    expect(routeWater(at(-50, 0), at(50, 0), bandGrid(HARD)).status).not.toBe("straight");
    expect(routeWater(at(-50, 0), at(50, 0), bandGrid(0)).status).toBe("straight");
  });

  test("a tile store's window: HARD is land to the search, not water", () => {
    const c = toCell(41.88, -87.63);
    const tx = Math.floor(c.gx / CELLS_PER_TILE), ty = Math.floor(c.gy / CELLS_PER_TILE);
    const g = new Uint8Array(CELLS_PER_TILE * CELLS_PER_TILE).fill(1);
    for (let y = 100; y < 400; y++) g[y * CELLS_PER_TILE + 256] = HARD;   // one cell wide, 300 cells long
    const store = new TileStore({ storage: null, fetchImpl: () => { throw new Error("offline"); } });
    store.grids.set(`${tx}/${ty}`, g);
    const row = ty * CELLS_PER_TILE + 256.5;
    const a = fromCell(tx * CELLS_PER_TILE + 226.5, row), b = fromCell(tx * CELLS_PER_TILE + 286.5, row);
    const r = routeWater(a, b, store);
    expect(r.status).toBe("refused");
  });

  test("a diagonal line: too thin it can be squeezed through; as the rasteriser draws it, it cannot", () => {
    const S = 64;
    const water = () => new Uint8Array(S * S).fill(1);
    const line = [[{ x: 0, y: S }, { x: S, y: 0 }]];
    const crosses = (g) => {
      const mask = Uint8Array.from(g, (v) => (v === 1 ? 1 : 0));
      return astar(mask, new Float32Array(S * S).fill(1), S, S, 0, S * S - 1).reached;
    };
    const thin = water();
    strokeLines(thin, S, S, line, 0.63, HARD);           // 3 m at the equator
    expect(crosses(thin)).toBe(true);
    expect(MIN_LINE_RADIUS_CELLS).toBe(1);
    const drawn = rasteriseTile({ extent: S, water: [[[{ x: 0, y: 0 }, { x: S, y: 0 }, { x: S, y: S }, { x: 0, y: S }]]], structurePolygons: [], structureLines: line }, S, 0.63);
    expect(crosses(drawn)).toBe(false);
  });
});
