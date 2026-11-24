import { describe, expect, it } from "@jest/globals";

// 06_MAP_CONTRACT_OVERLAYS.md D19: points on the map. Each test names the rule it pins.

import {
  pointsUrlOf, isPointPublisherState, discoverPointPublishers, parsePointLayersOption, pointOrderOf, pointStyleFor,
  pointsOf, mercator, visiblePoints, hitTest, pointPopupHtml, UNKNOWN_POINT_STYLE, HIT_SLOP_PX, POPUP_LINES_MAX,
} from "./PointLayers.js";

const STYLES = { fire: { color: "#FF3D00", label: "Fire detected", radius: 3, outline: "#7A1A00" } };
const pub = (over = {}) => ({ state: "12", attributes: { points_url: "/api/live_track_weather/points/fires/abcdef123456", point_styles: STYLES, ...over } });

describe("rule 1: a publisher by attribute shape", () => {
  it("needs a path under /api/ and a styles mapping", () => {
    expect(isPointPublisherState(pub())).toBe(true);
    expect(isPointPublisherState(pub({ points_url: "/local/x.json" }))).toBe(false);
    expect(isPointPublisherState(pub({ points_url: "/api/a//b" }))).toBe(false);
    expect(isPointPublisherState(pub({ points_url: "https://x/api/a" }))).toBe(false);
    expect(isPointPublisherState(pub({ point_styles: [] }))).toBe(false);
    expect(isPointPublisherState(pub({ point_styles: undefined }))).toBe(false);
    expect(pointsUrlOf({ points_url: "/api/a/b-c_1" })).toBe("/api/a/b-c_1");
  });

  it("rule 8: unavailable or unknown is not drawn", () => {
    expect(isPointPublisherState({ ...pub(), state: "unavailable" })).toBe(false);
    expect(isPointPublisherState({ ...pub(), state: "unknown" })).toBe(false);
    expect(isPointPublisherState(undefined)).toBe(false);
  });

  it("discovers every publisher, sorted", () => {
    expect(discoverPointPublishers({ "sensor.b": pub(), "sensor.a": pub(), "sensor.c": { state: "1", attributes: {} } })).toEqual(["sensor.a", "sensor.b"]);
    expect(discoverPointPublishers(undefined)).toEqual([]);
  });

  it("point_layers: auto, off, or a list", () => {
    expect(parsePointLayersOption(undefined)).toEqual({ mode: "auto" });
    expect(parsePointLayersOption("auto")).toEqual({ mode: "auto" });
    expect(parsePointLayersOption(false)).toEqual({ mode: "off" });
    expect(parsePointLayersOption("off")).toEqual({ mode: "off" });
    expect(parsePointLayersOption(["sensor.a", { entity: " sensor.b ", name: "Fires", show: false }, { entity: "sensor.a" }, { name: "x" }]))
      .toEqual({ mode: "list", items: [{ entity: "sensor.a", name: null, show: null }, { entity: "sensor.b", name: "Fires", show: false }] });
  });

  it("point_order: an integer, else 0", () => {
    expect(pointOrderOf({ point_order: 2 })).toBe(2);
    expect(pointOrderOf({ point_order: 1.5 })).toBe(0);
    expect(pointOrderOf({})).toBe(0);
  });
});

describe("styles (D19 table, rule 7)", () => {
  it("colour, label, radius, outline", () => {
    expect(pointStyleFor("fire", STYLES)).toEqual({ color: "#FF3D00", label: "Fire detected", radius: 3, outline: "#7A1A00" });
  });

  it("unknown or bad colour is grey", () => {
    expect(pointStyleFor("x", STYLES)).toEqual(UNKNOWN_POINT_STYLE);
    expect(pointStyleFor("x", { x: { color: "red" } })).toEqual(UNKNOWN_POINT_STYLE);
    expect(pointStyleFor("x", null)).toEqual(UNKNOWN_POINT_STYLE);
  });

  it("radius 2-10, default 4; a bad outline is none; an empty label is Point", () => {
    expect(pointStyleFor("x", { x: { color: "#000000", radius: 11 } }).radius).toBe(4);
    expect(pointStyleFor("x", { x: { color: "#000000", radius: 1 } }).radius).toBe(4);
    expect(pointStyleFor("x", { x: { color: "#000000", radius: 2 } }).radius).toBe(2);
    expect(pointStyleFor("x", { x: { color: "#000000", radius: 10 } }).radius).toBe(10);
    expect(pointStyleFor("x", { x: { color: "#000000", outline: "#12" } }).outline).toBeNull();
    expect(pointStyleFor("x", { x: { color: "#000000", label: "  " } }).label).toBe("Point");
  });
});

describe("the file (rules 6, 7, 9)", () => {
  const FILE = {
    meta: {},
    columns: [{ key: "time", label: "Detected (UTC)" }, { key: "frp", label: "FRP" }],
    points: [[-87.1, 41.6, "fire", "2026-11-17 07:05", 3.1], "x", [200, 0, "fire"], [0, 95, "fire"], [1, 1, 5], [NaN, 1, "fire"], [10, 20, "fire", null, null]],
  };

  it("keeps well-formed points only, with Mercator positions", () => {
    const d = pointsOf(FILE);
    expect(d.points).toHaveLength(2);
    expect(d.columns).toEqual(FILE.columns);
    expect(d.mx[0]).toBeCloseTo(0.5 + -87.1 / 360, 12);
    expect(d.my.length).toBe(2);
  });

  it("not a D19 file is null", () => {
    expect(pointsOf({ points: {} })).toBeNull();
    expect(pointsOf(null)).toBeNull();
    expect(pointsOf([])).toBeNull();
    expect(pointsOf({ points: [] }).points).toEqual([]);
  });

  it("columns without labels use their key", () => {
    expect(pointsOf({ points: [], columns: [{ key: "a" }] }).columns).toEqual([{ key: "a", label: "a" }]);
  });

  it("rule 9: keep() filters by place", () => {
    const d = pointsOf(FILE, (lon) => lon > 0);
    expect(d.points.map((p) => p[0])).toEqual([10]);
  });
});

describe("Mercator", () => {
  it("matches Leaflet's EPSG:3857 at scale 1", () => {
    expect(mercator(0, 0)).toEqual([0.5, 0.5]);
    expect(mercator(-180, 0)[0]).toBe(0);
    expect(mercator(180, 0)[0]).toBe(1);
    expect(mercator(0, 85.0511287798)[1]).toBeCloseTo(0, 9);
    expect(mercator(0, -89)[1]).toBeCloseTo(1, 9);
    expect(mercator(0, 41.6)[1]).toBeCloseTo(0.5 - Math.log(Math.tan(Math.PI / 4 + (41.6 * Math.PI) / 360)) / (2 * Math.PI), 12);
  });
});

describe("rule 3: only on screen, one dot per cell", () => {
  const data = (pts) => pointsOf({ points: pts.map(([x, y]) => [x, y, "fire"]) });
  // A view where container x = mx * 1000 - 500, y = my * 1000 - 500: (0,0) at the centre of a 1000 px world.
  const VIEW = { scale: 1000, ox: 500, oy: 500 };
  const BOX = { left: -10, top: -10, width: 120, height: 120 };

  it("drops points off the canvas", () => {
    const d = data([[0, 0], [-90, 0], [3.6, 0]]);
    const v = visiblePoints(d, VIEW, BOX, 3);
    expect(Array.from(v.i.slice(0, v.n))).toEqual([0, 2]);
    expect(v.x[1]).toBeCloseTo(10, 9);
    expect(v.y[0]).toBeCloseTo(0, 9);
  });

  it("the edges: left and top in, right and bottom out", () => {
    const d = data([[-3.6, 0], [7.92, 0], [0, 0]]);
    const v = visiblePoints(d, VIEW, { left: -10, top: -10, width: 32, height: 32 }, 1);
    // x = -10 is the box's left edge (in); x = 22 is left + width (out)
    expect(Array.from(v.i.slice(0, v.n))).toEqual([0, 2]);
  });

  it("two points within one cell: the first only", () => {
    const d = data([[0, 0], [0.18, 0], [0.72, 0]]);
    const v = visiblePoints(d, VIEW, BOX, 3);
    expect(v.n).toBe(2);
    expect(Array.from(v.i.slice(0, v.n))).toEqual([0, 2]);
  });

  it("never more dots than cells", () => {
    const pts = [];
    for (let k = 0; k < 5000; k++) pts.push([(k % 100) / 100, Math.floor(k / 100) / 100]);
    const v = visiblePoints(data(pts), VIEW, { left: 0, top: -10, width: 10, height: 10 }, 5);
    expect(v.n).toBeLessThanOrEqual(9);
    expect(v.n).toBeGreaterThan(0);
  });

  it("a cell below 1 px counts as 1", () => {
    const v = visiblePoints(data([[0, 0], [0.01, 0]]), VIEW, BOX, 0);
    expect(v.n).toBe(1);
  });
});

describe("rule 4: a click within radius + slop", () => {
  const drawn = { i: Int32Array.from([7, 9]), x: Float64Array.from([10, 30]), y: Float64Array.from([10, 10]), n: 2 };
  const r3 = () => 3;

  it("nearest within reach", () => {
    expect(hitTest(drawn, 10, 10, r3)).toBe(7);
    expect(hitTest(drawn, 10 + 3 + HIT_SLOP_PX, 10, r3)).toBe(7);
    expect(hitTest(drawn, 10 + 3 + HIT_SLOP_PX + 0.5, 10, r3)).toBe(-1);
    expect(hitTest(drawn, 28, 10, r3)).toBe(9);
  });

  it("the nearer of two in reach", () => {
    const close = { i: Int32Array.from([1, 2]), x: Float64Array.from([10, 13]), y: Float64Array.from([10, 10]), n: 2 };
    expect(hitTest(close, 12, 10, r3)).toBe(2);
    expect(hitTest(close, 11, 10, r3)).toBe(1);
  });

  it("only the first n count", () => {
    expect(hitTest({ ...drawn, n: 1 }, 30, 10, r3)).toBe(-1);
  });
});

describe("rule 4: the popup", () => {
  const cols = [{ key: "a", label: "Detected" }, { key: "b", label: "FRP" }, { key: "c", label: "Note" }];

  it("label in bold, then label: value for values only, escaped", () => {
    const html = pointPopupHtml([0, 0, "fire", "2026-11-17 07:05", null, "<b>x</b>"], cols, { label: "Fire & smoke" });
    expect(html).toBe('<div class="ltmc-shape-info"><b>Fire &amp; smoke</b><br>Detected: 2026-11-17 07:05<br>Note: &lt;b&gt;x&lt;/b&gt;</div>');
  });

  it("numbers shown, zero included; objects and NaN not", () => {
    const html = pointPopupHtml([0, 0, "s", 0, NaN, { a: 1 }], cols, { label: "P" });
    expect(html).toBe('<div class="ltmc-shape-info"><b>P</b><br>Detected: 0</div>');
  });

  it("no values: the label alone", () => {
    expect(pointPopupHtml([0, 0, "s"], cols, { label: "P" })).toBe('<div class="ltmc-shape-info"><b>P</b></div>');
  });

  it("at most POPUP_LINES_MAX lines", () => {
    const many = Array.from({ length: 20 }, (_, k) => ({ key: `k${k}`, label: `L${k}` }));
    const html = pointPopupHtml([0, 0, "s", ...many.map((_, k) => k + 1)], many, { label: "P" });
    expect(html.split("<br>").length - 1).toBe(POPUP_LINES_MAX);
  });
});
