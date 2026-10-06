import { describe, expect, it } from "@jest/globals";
import {
  SOURCES, defaultOrder, wrapX, tileBounds, tileInBox, chainFor, pickSource, nativeTile,
  mercatorBbox, wmsTileUrl, rainviewerTileUrl, jmaTileUrl, relayTilePath, tilePlan,
  tilesInView, sourcesForView, MERC_R, RAINVIEWER_MAX_ZOOM, JMA_MAX_ZOOM,
} from "./RadarSources.js";

// Backlog 280, 06_MAP_CONTRACT_OVERLAYS.md D13: the per-tile source choice.

/**
 * The tile containing a point.
 * @param {number} lat
 * @param {number} lon
 * @param {number} z
 * @returns {{x: number, y: number}}
 */
function txy(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return { x, y };
}
const byId = (id) => SOURCES.find((s) => s.id === id);
const all = () => true;
const ids = (list) => list.map((s) => s.id);

describe("the source table", () => {
  it("is in D13's trying order, RainViewer last", () => {
    expect(defaultOrder()).toEqual(["fmi", "dwd", "jma", "geomet", "nowcoast", "rainviewer"]);
  });
  it("caps RainViewer at z7 and JMA at z10, WMS at none", () => {
    expect(byId("rainviewer").maxNativeZoom).toBe(7);
    expect(RAINVIEWER_MAX_ZOOM).toBe(7);
    expect(byId("jma").maxNativeZoom).toBe(10);
    expect(JMA_MAX_ZOOM).toBe(10);
    for (const id of ["fmi", "dwd", "geomet", "nowcoast"]) expect(byId(id).maxNativeZoom).toBeNull();
  });
  it("carries GeoMet's box from its capabilities", () => {
    expect(byId("geomet").boxes).toEqual([{ w: -170.32, e: -50.0, s: 16.93, n: 67.19 }]);
  });
  it("credits RainViewer with a link (mandatory)", () => {
    expect(byId("rainviewer").credit).toContain('href="https://www.rainviewer.com/"');
  });
});

describe("tile geometry", () => {
  it("wraps x", () => {
    expect(wrapX(-1, 3)).toBe(7);
    expect(wrapX(8, 3)).toBe(0);
    expect(wrapX(3, 3)).toBe(3);
  });
  it("gives z0 the whole Mercator world", () => {
    const b = tileBounds(0, 0, 0);
    expect(b.w).toBe(-180);
    expect(b.e).toBe(180);
    expect(b.n).toBeCloseTo(85.0511, 3);
    expect(b.s).toBeCloseTo(-85.0511, 3);
  });
  it("box test is whole-tile: inside yes, straddling no", () => {
    const box = { w: 0, e: 10, s: 0, n: 10 };
    expect(tileInBox({ w: 1, e: 9, s: 1, n: 9 }, box)).toBe(true);
    expect(tileInBox({ w: 0, e: 10, s: 0, n: 10 }, box)).toBe(true);
    expect(tileInBox({ w: -1, e: 9, s: 1, n: 9 }, box)).toBe(false);
    expect(tileInBox({ w: 1, e: 11, s: 1, n: 9 }, box)).toBe(false);
    expect(tileInBox({ w: 1, e: 9, s: -1, n: 9 }, box)).toBe(false);
    expect(tileInBox({ w: 1, e: 9, s: 1, n: 11 }, box)).toBe(false);
  });
});

describe("which source a tile tries", () => {
  it("Chicago z8: GeoMet, then nowCOAST CONUS, then RainViewer", () => {
    const { x, y } = txy(41.88, -87.63, 8);
    expect(ids(chainFor(8, x, y, SOURCES))).toEqual(["geomet", "nowcoast", "rainviewer"]);
    expect(pickSource(8, x, y, SOURCES, all).id).toBe("geomet");
  });
  it("southern Finland z8: FMI; Frankfurt z8: DWD; Tokyo z8: JMA; London z8: RainViewer only", () => {
    let t = txy(61.0, 25.0, 8);
    expect(pickSource(8, t.x, t.y, SOURCES, all).id).toBe("fmi");
    t = txy(50.1, 8.7, 8);
    expect(pickSource(8, t.x, t.y, SOURCES, all).id).toBe("dwd");
    t = txy(35.68, 139.69, 8);
    expect(pickSource(8, t.x, t.y, SOURCES, all).id).toBe("jma");
    t = txy(51.5, -0.12, 8);
    expect(ids(chainFor(8, t.x, t.y, SOURCES))).toEqual(["rainviewer"]);
  });
  it("Guam z7: nowCOAST, not GeoMet (east of the date line)", () => {
    const t = txy(13.45, 144.79, 7);
    expect(ids(chainFor(7, t.x, t.y, SOURCES))).toEqual(["nowcoast", "rainviewer"]);
  });
  it("Attu (far Aleutians, 173E) z7: RainViewer only; Unalaska (-166.5) z7: GeoMet", () => {
    let t = txy(52.9, 173.2, 7);
    expect(ids(chainFor(7, t.x, t.y, SOURCES))).toEqual(["rainviewer"]);
    t = txy(53.9, -166.5, 7);
    expect(pickSource(7, t.x, t.y, SOURCES, all).id).toBe("geomet");
  });
  it("a tile straddling a box edge falls through: z2 over North America is RainViewer, z3 fits GeoMet", () => {
    let t = txy(45, -95, 2);
    expect(ids(chainFor(2, t.x, t.y, SOURCES))).toEqual(["rainviewer"]);
    t = txy(45, -95, 3);
    expect(pickSource(3, t.x, t.y, SOURCES, all).id).toBe("geomet");
  });
  it("Germany at z5 is too wide for DWD's box, at z7 it fits", () => {
    let t = txy(51, 10, 5);
    expect(chainFor(5, t.x, t.y, SOURCES).map((s) => s.id)).not.toContain("dwd");
    t = txy(51, 10, 7);
    expect(pickSource(7, t.x, t.y, SOURCES, all).id).toBe("dwd");
  });
  it("an unusable source falls to the next; none usable: null", () => {
    const { x, y } = txy(41.88, -87.63, 8);
    expect(pickSource(8, x, y, SOURCES, (s) => s.id !== "geomet").id).toBe("nowcoast");
    expect(pickSource(8, x, y, SOURCES, (s) => s.id === "rainviewer").id).toBe("rainviewer");
    expect(pickSource(8, x, y, SOURCES, () => false)).toBeNull();
  });
  it("a wrapped x picks the same as the plain one", () => {
    const { x, y } = txy(41.88, -87.63, 8);
    expect(pickSource(8, x + 256, y, SOURCES, all).id).toBe("geomet");
    expect(pickSource(8, x - 256, y, SOURCES, all).id).toBe("geomet");
  });
});

describe("native zoom", () => {
  it("at or below the cap, the tile itself", () => {
    expect(nativeTile(7, 33, 47, 7)).toEqual({ z: 7, x: 33, y: 47, scale: 1, offX: 0, offY: 0 });
    expect(nativeTile(12, 1000, 1500, null)).toEqual({ z: 12, x: 1000, y: 1500, scale: 1, offX: 0, offY: 0 });
  });
  it("above the cap, the parent at the cap and the offset inside it", () => {
    expect(nativeTile(9, 133, 190, 7)).toEqual({ z: 7, x: 33, y: 47, scale: 4, offX: 1, offY: 2 });
    expect(nativeTile(8, 67, 95, 7)).toEqual({ z: 7, x: 33, y: 47, scale: 2, offX: 1, offY: 1 });
  });
  it("wraps before dividing", () => {
    expect(nativeTile(8, -1, 0, 7)).toEqual({ z: 7, x: 127, y: 0, scale: 2, offX: 1, offY: 0 });
  });
});

describe("URLs", () => {
  it("bbox is EPSG:3857 x,y order, z0 is the whole extent", () => {
    expect(mercatorBbox(0, 0, 0)).toBe([-MERC_R, -MERC_R, MERC_R, MERC_R].map((v) => v.toFixed(3)).join(","));
    expect(mercatorBbox(1, 1, 0)).toBe(["0.000", "0.000", MERC_R.toFixed(3), MERC_R.toFixed(3)].join(","));
  });
  it("WMS carries the layer, the CRS, 256 px and an explicit time", () => {
    const u = wmsTileUrl(byId("geomet"), 8, 65, 95, "2026-10-06T06:48:00Z");
    expect(u.startsWith("https://geo.weather.gc.ca/geomet?")).toBe(true);
    for (const p of ["service=WMS", "version=1.3.0", "request=GetMap", "layers=RADAR_1KM_RRAI", "styles=", "crs=EPSG:3857",
      "width=256", "height=256", "format=image/png", "transparent=true", "time=2026-10-06T06%3A48%3A00Z"]) {
      expect(u.split("?")[1].split("&")).toContain(p);
    }
    expect(u).toContain(`bbox=${mercatorBbox(8, 65, 95)}`);
  });
  it("WMS encodes a namespaced layer", () => {
    expect(wmsTileUrl(byId("fmi"), 5, 18, 8, "2026-10-06T07:00:00Z")).toContain("layers=Radar%3Asuomi_dbz_eureffin");
  });
  it("RainViewer: host + path + 256/z/x/y/scheme/1_1.png", () => {
    expect(rainviewerTileUrl({ host: "https://tilecache.rainviewer.com", path: "/v2/radar/abc" }, 7, 33, 47, 2))
      .toBe("https://tilecache.rainviewer.com/v2/radar/abc/256/7/33/47/2/1_1.png");
  });
  it("JMA: basetime/none/validtime/surf/hrpns/z/x/y.png", () => {
    expect(jmaTileUrl(byId("jma"), { basetime: "20261006072500", validtime: "20261006072500" }, 10, 909, 403))
      .toBe("https://www.jma.go.jp/bosai/jmatile/data/nowc/20261006072500/none/20261006072500/surf/hrpns/10/909/403.png");
  });
  it("relay template fills z, x, y", () => {
    expect(relayTilePath("/api/r/knmi/123/{z}/{x}/{y}.png", 9, 263, 168)).toBe("/api/r/knmi/123/9/263/168.png");
  });
});

describe("tilePlan", () => {
  const rv = { key: "/v2/radar/abc", host: "https://h", path: "/v2/radar/abc", time: 0 };
  const geo = { key: "2026-10-06T06:48:00Z", time: 0 };
  it("Chicago z8 with GeoMet: one WMS tile, unscaled", () => {
    const { x, y } = txy(41.88, -87.63, 8);
    const p = tilePlan(8, x, y, SOURCES, new Map([["geomet", geo], ["rainviewer", rv]]), { scheme: 2 });
    expect(p.source.id).toBe("geomet");
    expect(p.url).toContain("time=2026-10-06T06%3A48%3A00Z");
    expect(p.scale).toBe(1);
    expect(p.relay).toBe(false);
  });
  it("London z9 with RainViewer: the z7 parent, scaled by 4, never z8+", () => {
    const { x, y } = txy(51.5, -0.12, 9);
    const p = tilePlan(9, x, y, SOURCES, new Map([["rainviewer", rv]]), { scheme: 2 });
    expect(p.source.id).toBe("rainviewer");
    expect(p.url).toMatch(/\/256\/7\/\d+\/\d+\/2\/1_1\.png$/);
    expect(p.scale).toBe(4);
    expect(p.offX).toBe(x % 4);
    expect(p.offY).toBe(y % 4);
  });
  it("the scheme option reaches the RainViewer URL", () => {
    const { x, y } = txy(51.5, -0.12, 5);
    expect(tilePlan(5, x, y, SOURCES, new Map([["rainviewer", rv]]), { scheme: 4 }).url).toMatch(/\/4\/1_1\.png$/);
  });
  it("Tokyo z12 with JMA: the z10 parent", () => {
    const { x, y } = txy(35.68, 139.69, 12);
    const p = tilePlan(12, x, y, SOURCES, new Map([["jma", { key: "b", basetime: "b", validtime: "b", time: 0 }]]), { scheme: 2 });
    expect(p.url).toContain("/surf/hrpns/10/");
    expect(p.scale).toBe(4);
  });
  it("no usable frame: null (blank)", () => {
    const { x, y } = txy(41.88, -87.63, 8);
    expect(tilePlan(8, x, y, SOURCES, new Map(), { scheme: 2 })).toBeNull();
  });
  it("a relay comes first and is marked for signing", () => {
    const relay = { id: "relay:knmi", kind: "relay", tiles: "/api/k/{z}/{x}/{y}.png", boxes: [{ w: 3, e: 8, s: 50, n: 54 }], maxNativeZoom: 10 };
    const { x, y } = txy(52.1, 5.1, 8);
    const p = tilePlan(8, x, y, [relay, ...SOURCES], new Map([["relay:knmi", { key: "t", time: 0 }], ["rainviewer", rv]]), { scheme: 2 });
    expect(p.source.id).toBe("relay:knmi");
    expect(p.relay).toBe(true);
    expect(p.url).toBe(`/api/k/8/${x}/${y}.png`);
  });
});

describe("the view", () => {
  it("lists the tiles under the pixel bounds, wrapped, without duplicates", () => {
    expect(tilesInView(2, { minX: 0, minY: 0, maxX: 512, maxY: 256 })).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    expect(tilesInView(1, { minX: -256, minY: 0, maxX: 512, maxY: 256 })).toEqual([{ x: 1, y: 0 }, { x: 0, y: 0 }]);
    expect(tilesInView(1, { minX: 0, minY: -500, maxX: 256, maxY: 9999 })).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
  });
  it("stops at the cap", () => {
    expect(tilesInView(10, { minX: 0, minY: 0, maxX: 256 * 40, maxY: 256 * 40 }, 25)).toHaveLength(25);
  });
  it("drawing = the sources that draw; wanted = each tile's chain up to its first usable source", () => {
    const chi = txy(41.88, -87.63, 8);
    const lon = txy(51.5, -0.12, 8);
    const tiles = [chi, lon];
    let r = sourcesForView(8, tiles, SOURCES, (s) => s.id === "geomet" || s.id === "rainviewer");
    expect([...r.drawing].sort()).toEqual(["geomet", "rainviewer"]);
    expect([...r.wanted].sort()).toEqual(["geomet", "rainviewer"]);
    r = sourcesForView(8, [chi], SOURCES, () => false);
    expect([...r.drawing]).toEqual([]);
    expect([...r.wanted]).toEqual(["geomet", "nowcoast", "rainviewer"]);
    r = sourcesForView(8, [chi], SOURCES, (s) => s.id === "nowcoast");
    expect([...r.drawing]).toEqual(["nowcoast"]);
    expect([...r.wanted]).toEqual(["geomet", "nowcoast"]);
  });
});
