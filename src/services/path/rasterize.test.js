/**
 * @jest-environment node
 */
import { fillPolygon, strokeLines, rasteriseTile, encodeRuns, decodeRuns, HARD } from "./rasterize.js";
import { shortbreadGeometry, openMapTilesGeometry } from "./adapters.js";
import { decodeWaterTile } from "./TileStore.js";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { SHORTBREAD_B64, OPENMAPTILES_B64, bytes } from "./fixtures.testhelper.js";

const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const at = (g, size, c, r) => g[r * size + c];

describe("rasterize", () => {
  test("a square fills the cells whose centres it holds", () => {
    const g = new Uint8Array(10 * 10);
    fillPolygon(g, 10, 10, [sq(2, 3, 5, 7)], 1);
    expect(at(g, 10, 2, 3)).toBe(1);
    expect(at(g, 10, 4, 6)).toBe(1);
    expect(at(g, 10, 5, 3)).toBe(0);
    expect(at(g, 10, 2, 7)).toBe(0);
    expect(g.reduce((s, v) => s + v, 0)).toBe(12);
  });

  test("a hole inside a feature stays empty (even-odd)", () => {
    const g = new Uint8Array(10 * 10);
    fillPolygon(g, 10, 10, [sq(0, 0, 10, 10), sq(4, 4, 6, 6)], 1);
    expect(at(g, 10, 4, 4)).toBe(0);
    expect(at(g, 10, 1, 1)).toBe(1);
  });

  test("two overlapping features do not cancel", () => {
    const g = new Uint8Array(10 * 10);
    fillPolygon(g, 10, 10, [sq(0, 0, 6, 6)], 1);
    fillPolygon(g, 10, 10, [sq(3, 3, 9, 9)], 1);
    expect(at(g, 10, 4, 4)).toBe(1);
  });

  test("a line clears a band as wide as its radius, and no wider", () => {
    const g = new Uint8Array(10 * 10).fill(1);
    strokeLines(g, 10, 10, [[{ x: 0, y: 5 }, { x: 10, y: 5 }]], 0.6, 0);
    expect(at(g, 10, 3, 4)).toBe(0);
    expect(at(g, 10, 3, 5)).toBe(0);
    expect(at(g, 10, 3, 3)).toBe(1);
    expect(at(g, 10, 3, 6)).toBe(1);
  });

  test("a tile's overlapping water features stay water (each filled on its own)", () => {
    const g = rasteriseTile({ extent: 10, water: [[sq(0, 0, 6, 6)], [sq(3, 3, 9, 9)]], structurePolygons: [], structureLines: [] }, 10, 1);
    expect(at(g, 10, 4, 4)).toBe(1);
    expect(at(g, 10, 1, 1)).toBe(1);
    expect(at(g, 10, 8, 8)).toBe(1);
  });

  test("structures, polygons and lines, are painted HARD in the water", () => {
    expect(HARD).toBe(2);
    const g = rasteriseTile({ extent: 10, water: [[sq(0, 0, 10, 10)]], structurePolygons: [[sq(2, 2, 4, 4)]], structureLines: [[{ x: 0, y: 8.5 }, { x: 10, y: 8.5 }]] }, 10, 0.6);
    expect(at(g, 10, 3, 3)).toBe(HARD);
    expect(at(g, 10, 5, 8)).toBe(HARD);
    expect(at(g, 10, 6, 6)).toBe(1);
  });

  test("runs encode and decode to the same grid; a wrong length is refused", () => {
    const g = new Uint8Array(1000);
    g.fill(1, 10, 400); g.fill(1, 700, 1000);
    const runs = encodeRuns(g);
    expect(Array.from(runs)).toEqual([0, 10, 1, 390, 0, 300, 1, 300]);
    expect(decodeRuns(runs, 1000)).toEqual(g);
    expect(decodeRuns(runs, 999)).toBeNull();
    expect(decodeRuns([0, 5], 1000)).toBeNull();
    expect(decodeRuns([0, 500, 1], 1000)).toBeNull();     // unpaired
    expect(decodeRuns([3, 1000], 1000)).toBeNull();       // not 0, 1 or HARD
  });

  test("HARD cells survive the store", () => {
    const g = new Uint8Array(100).fill(1);
    g.fill(HARD, 40, 43); g.fill(0, 90, 100);
    const back = decodeRuns(encodeRuns(g), 100);
    expect(back).toEqual(g);
    expect(back[41]).toBe(HARD);
  });
});

describe("adapters on real vector tile bytes", () => {
  const sb = new VectorTile(new PbfReader(new Uint8Array(bytes(SHORTBREAD_B64))));
  const omt = new VectorTile(new PbfReader(new Uint8Array(bytes(OPENMAPTILES_B64))));

  test("Shortbread: the river kept, the pool dropped, the pier polygon and line taken", () => {
    const g = shortbreadGeometry(sb);
    expect(g.water).toHaveLength(1);
    expect(g.structurePolygons).toHaveLength(1);
    expect(g.structureLines).toHaveLength(1);
  });

  test("OpenMapTiles: the same, and the road ignored", () => {
    const g = openMapTilesGeometry(omt);
    expect(g.water).toHaveLength(1);
    expect(g.structurePolygons).toHaveLength(1);
    expect(g.structureLines).toHaveLength(1);
  });

  test("an adapter given a tile without its layers returns nothing, not an error", () => {
    expect(shortbreadGeometry({ layers: {} }).water).toEqual([]);
    expect(openMapTilesGeometry(sb).water).toEqual([]);
  });

  test.each([["shortbread", SHORTBREAD_B64], ["openmaptiles", OPENMAPTILES_B64]])("%s decodes to the same water grid", (schema, b64) => {
    const g = decodeWaterTile(bytes(b64), schema, 4202, 6088);
    expect(g).toHaveLength(512 * 512);
    expect(at(g, 512, 50, 50)).toBe(1);     // river
    expect(at(g, 512, 400, 50)).toBe(0);    // east half is land
    expect(at(g, 512, 390, 390)).toBe(0);   // the pool is not water
    expect(at(g, 512, 112, 150)).toBe(HARD);   // pier polygon
    expect(at(g, 512, 112, 375)).toBe(HARD);   // pier line
    expect(at(g, 512, 112, 380)).toBe(1);   // just off the line
  });

  test("an unknown schema and a broken tile both throw, for the store to fail over on", () => {
    expect(() => decodeWaterTile(bytes(SHORTBREAD_B64), "nope", 0, 0)).toThrow();
    expect(() => decodeWaterTile(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]).buffer, "shortbread", 0, 0)).toThrow();
  });
});
