import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// Backlog 277, 06_MAP_CONTRACT.md D12: shapes on the map. Each test names the
// D12 rule it pins.

jest.mock("leaflet", () => {
  const mk = (kind) => jest.fn((opts) => ({ kind, opts }));
  return {
    __esModule: true,
    default: {
      svg: mk("svg"),
      canvas: mk("canvas"),
      layerGroup: jest.fn((layers, opts) => {
        const g = {
          opts, layers: [...layers], cleared: 0, removed: 0,
          clearLayers: jest.fn(() => { g.layers = []; g.cleared += 1; return g; }),
          addLayer: jest.fn((l) => { g.layers.push(l); return g; }),
          remove: jest.fn(() => { g.removed += 1; return g; }),
        };
        return g;
      }),
      geoJSON: jest.fn((data, opts) => ({ data, opts })),
    },
  };
});

import L from "leaflet";
import ShapeLayersService, {
  isPublisherState, discoverPublishers, parseShapeLayersOption, parseShapeStyle, styleFor,
  buildDrawList, fillOpacities, shapesOf, UNKNOWN_STYLE, RETRY_MS, DEFAULT_SHAPE_STYLE, _resetShapeCache,
} from "./ShapeLayersRenderService.js";

const SQ = (x) => ({ type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]] });
const FILE = { meta: {}, shapes: { "county/A": SQ(0), "county/B": SQ(2), "forecast/C": SQ(4) } };
const STYLES = { Warn: { color: "#FF0000", priority: 1 }, Watch: { color: "#00FF00", priority: 5 }, Advisory: { color: "#0000FF", priority: 9 } };

/**
 * @param {object} [over] attributes to replace
 * @returns {object} a publisher state object
 */
function pub(over = {}) {
  return {
    state: "3",
    attributes: {
      friendly_name: "US alerts",
      shapes_url: "/x/shapes/aaa/f.json",
      zones: { "county/B": "Watch", "county/A": "Advisory" },
      polygons: [{ event: "Warn", ...SQ(9) }],
      styles: STYLES,
      attribution: "NWS",
      ...over,
    },
  };
}

/**
 * @param {object} [json] what the response parses to
 * @returns {Function} a fetch stand-in
 */
function okFetch(json = FILE) {
  return jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) }));
}

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

/** @returns {object} an overlay control stand-in */
function overlays() {
  return { addOverlay: jest.fn(() => true), removeOverlay: jest.fn() };
}

let warn;
let error;
beforeEach(() => {
  _resetShapeCache();
  jest.clearAllMocks();
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  error = jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("rule 1: finding publishers by attribute shape", () => {
  it("a string shapes_url and a mapping zones make a publisher; nothing else does", () => {
    expect(isPublisherState(pub())).toBe(true);
    expect(isPublisherState(pub({ zones: {} }))).toBe(true);
    expect(isPublisherState(pub({ shapes_url: 7 }))).toBe(false);
    expect(isPublisherState(pub({ shapes_url: "" }))).toBe(false);
    expect(isPublisherState(pub({ zones: ["a"] }))).toBe(false);
    expect(isPublisherState(pub({ zones: null }))).toBe(false);
    expect(isPublisherState({ state: "1", attributes: { shapes_url: "/u" } })).toBe(false);
    expect(isPublisherState(undefined)).toBe(false);
    expect(isPublisherState({ state: "1" })).toBe(false);
  });

  it("unavailable and unknown are not drawable (rule 9)", () => {
    expect(isPublisherState({ ...pub(), state: "unavailable" })).toBe(false);
    expect(isPublisherState({ ...pub(), state: "unknown" })).toBe(false);
  });

  it("discovery assumes no entity id or domain", () => {
    const states = { "sensor.zz": pub(), "light.x": { state: "on", attributes: {} }, "switch.renamed": pub(), "sensor.n": { state: "1", attributes: { zones: {} } } };
    expect(discoverPublishers(states)).toEqual(["sensor.zz", "switch.renamed"]);
    expect(discoverPublishers(undefined)).toEqual([]);
  });
});

describe("shape_layers option", () => {
  it.each([[undefined], [null], [true], ["auto"]])("%p discovers", (v) => {
    expect(parseShapeLayersOption(v)).toEqual({ mode: "auto" });
  });
  it.each([[false], ["off"]])("%p turns it off", (v) => {
    expect(parseShapeLayersOption(v)).toEqual({ mode: "off" });
  });
  it("a list names publishers; strings, names, show, duplicates and junk", () => {
    expect(parseShapeLayersOption([
      "sensor.a", { entity: " sensor.b ", name: " Warnings ", show: false }, { entity: "sensor.a", name: "dup" }, { name: "no entity" }, 7,
    ])).toEqual({ mode: "list", items: [
      { entity: "sensor.a", name: null, show: true },
      { entity: "sensor.b", name: "Warnings", show: false },
    ] });
    expect(parseShapeLayersOption({ entity: "sensor.c" })).toEqual({ mode: "list", items: [{ entity: "sensor.c", name: null, show: true }] });
  });
});

describe("shape_style option", () => {
  it("defaults", () => {
    expect(parseShapeStyle(undefined)).toEqual(DEFAULT_SHAPE_STYLE);
    expect(DEFAULT_SHAPE_STYLE).toEqual({ fillOpacity: 0.25, weight: 2, opacity: 0.9, renderer: "svg", byPriority: false });
  });
  it("snake_case keys override; out-of-range values are ignored", () => {
    expect(parseShapeStyle({ fill_opacity: 0.15, opacity: 0.5, weight: 2, renderer: "canvas", by_priority: true }))
      .toEqual({ fillOpacity: 0.15, opacity: 0.5, weight: 2, renderer: "canvas", byPriority: true });
    expect(parseShapeStyle({ fill_opacity: 1.5, opacity: -1, weight: -2, renderer: "webgl", by_priority: "yes", fillOpacity: 0.9 }))
      .toEqual(DEFAULT_SHAPE_STYLE);
  });
});

describe("rule 8: styles", () => {
  it("a styled event, and the grey 999 for anything else", () => {
    expect(styleFor("Warn", STYLES)).toEqual({ color: "#FF0000", priority: 1 });
    expect(styleFor("Nope", STYLES)).toEqual({ color: "#808080", priority: 999 });
    expect(UNKNOWN_STYLE).toEqual({ color: "#808080", priority: 999 });
    expect(styleFor("X", { X: { color: "red", priority: 3 } })).toEqual(UNKNOWN_STYLE);
    expect(styleFor("X", { X: { color: "#123456", priority: 2.5 } })).toEqual(UNKNOWN_STYLE);
    expect(styleFor("X", undefined)).toEqual(UNKNOWN_STYLE);
  });
});

describe("rule 3: drawing order", () => {
  it("largest priority first, 1 last; zones before polygons at a tie; zones by key; polygons as sent", () => {
    const attrs = {
      zones: { "forecast/C": "Watch", "county/B": "Watch", "county/A": "Warn" },
      polygons: [{ event: "Watch", ...SQ(20) }, { event: "Advisory", ...SQ(30) }, { event: "Watch", ...SQ(40) }],
      styles: STYLES,
    };
    const { items } = buildDrawList(attrs, FILE.shapes);
    expect(items.map((i) => `${i.priority}:${i.kind}:${i.key ?? i.geometry.coordinates[0][0][0]}`)).toEqual([
      "9:polygon:30", "5:zone:county/B", "5:zone:forecast/C", "5:polygon:20", "5:polygon:40", "1:zone:county/A",
    ]);
  });

  it("an unstyled event draws first (999), in grey", () => {
    const { items } = buildDrawList({ zones: { "county/A": "Mystery", "county/B": "Warn" }, styles: STYLES }, FILE.shapes);
    expect(items.map((i) => [i.key, i.color, i.priority])).toEqual([["county/A", "#808080", 999], ["county/B", "#FF0000", 1]]);
  });
});

describe("rules 5 and 7: before the file, and keys it lacks", () => {
  it("no file yet: polygons only", () => {
    const { items, missing } = buildDrawList(pub().attributes, null);
    expect(items.map((i) => i.kind)).toEqual(["polygon"]);
    expect(missing).toEqual([]);
  });
  it("a key missing from the file is skipped and reported; a non-area shape counts as missing", () => {
    const shapes = { ...FILE.shapes, "county/B": { type: "Point", coordinates: [0, 0] } };
    const { items, missing } = buildDrawList({ zones: { "county/A": "Warn", "county/B": "Warn", "county/Z": "Warn" }, styles: STYLES }, shapes);
    expect(items.map((i) => i.key)).toEqual(["county/A"]);
    expect(missing).toEqual(["county/B", "county/Z"]);
  });
  it("junk polygons and non-string zone events are skipped", () => {
    const { items } = buildDrawList({
      zones: { "county/A": 5 },
      polygons: [null, { event: 3, ...SQ(1) }, { event: "Warn", type: "LineString", coordinates: [[0, 0], [1, 1]] }, { event: "Warn", type: "Polygon" }, { event: "Warn", ...SQ(2) }],
      styles: STYLES,
    }, FILE.shapes);
    expect(items.length).toBe(1);
    expect(items[0].geometry).toEqual(SQ(2));
    const multi = buildDrawList({ polygons: [{ event: "Warn", type: "MultiPolygon", coordinates: [SQ(0).coordinates] }] }, null);
    expect(multi.items[0].geometry.type).toBe("MultiPolygon");
  });
});

describe("fill opacity", () => {
  const items = [{ priority: 9 }, { priority: 5 }, { priority: 1 }, { priority: 1 }];
  it("one value for all by default", () => {
    expect(fillOpacities(items, { ...DEFAULT_SHAPE_STYLE })).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
  it("by priority: the most important third strongest", () => {
    const out = fillOpacities(items, { ...DEFAULT_SHAPE_STYLE, byPriority: true });
    expect(out.map((v) => Math.round(v * 100))).toEqual([15, 25, 35, 35]);
    expect(fillOpacities([{ priority: 4 }], { ...DEFAULT_SHAPE_STYLE, byPriority: true }).map((v) => Math.round(v * 100))).toEqual([35]);
  });
});

describe("shapesOf (rule 6)", () => {
  it("needs a shapes mapping", () => {
    expect(shapesOf(FILE)).toBe(FILE.shapes);
    expect(shapesOf({ shapes: [] })).toBeNull();
    expect(shapesOf({})).toBeNull();
    expect(shapesOf("x")).toBeNull();
  });
});

describe("the service", () => {
  const hassOf = (states) => ({ states });

  it("rule 10: no publisher, no checkbox, no fetch", () => {
    const ov = overlays();
    const fetch = okFetch();
    new ShapeLayersService({}, undefined, undefined, ov, { fetch }).render(hassOf({ "light.x": { state: "on", attributes: {} } }));
    expect(ov.addOverlay).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shape_layers: false draws nothing even with a publisher", () => {
    const ov = overlays();
    const fetch = okFetch();
    new ShapeLayersService({}, false, undefined, ov, { fetch }).render(hassOf({ "sensor.w": pub() }));
    expect(ov.addOverlay).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rules 2, 4, 5: one checkbox named by friendly_name, on by default, one fetch, polygons until the file lands", async () => {
    const ov = overlays();
    const fetch = okFetch();
    const svc = new ShapeLayersService({}, undefined, undefined, ov, { fetch });
    const s = pub();
    svc.render(hassOf({ "sensor.w": s }));
    expect(ov.addOverlay).toHaveBeenCalledTimes(1);
    const [group, name, show] = ov.addOverlay.mock.calls[0];
    expect(name).toBe("US alerts");
    expect(show).toBe(true);
    expect(group.opts).toEqual({ attribution: "NWS" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/x/shapes/aaa/f.json");
    expect(fetch.mock.calls[0][1].credentials).toBe("same-origin");
    expect(group.layers.length).toBe(1);
    await flush();
    expect(group.layers.length).toBe(3);
    svc.render(hassOf({ "sensor.w": s }));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rule 2: a second card on the page reuses the parsed file", async () => {
    const fetch = okFetch();
    new ShapeLayersService({}, undefined, undefined, overlays(), { fetch }).render(hassOf({ "sensor.w": pub() }));
    await flush();
    const ov2 = overlays();
    new ShapeLayersService({}, undefined, undefined, ov2, { fetch }).render(hassOf({ "sensor.w": pub() }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ov2.addOverlay.mock.calls[0][0].layers.length).toBe(3);
  });

  it("redraws only when the state object changes, never on every render", async () => {
    const ov = overlays();
    const svc = new ShapeLayersService({}, undefined, undefined, ov, { fetch: okFetch() });
    const s = pub();
    svc.render(hassOf({ "sensor.w": s }));
    await flush();
    const group = ov.addOverlay.mock.calls[0][0];
    const before = group.cleared;
    for (let i = 0; i < 5; i++) svc.render(hassOf({ "sensor.w": s, "sensor.other": { state: String(i), attributes: {} } }));
    expect(group.cleared).toBe(before);
    svc.render(hassOf({ "sensor.w": pub({ zones: { "county/A": "Warn" } }) }));
    expect(group.cleared).toBe(before + 1);
    expect(group.layers.length).toBe(2);
  });

  it("styles each shape: event colour fill and outline, not interactive, overlayPane renderer", async () => {
    const ov = overlays();
    const svc = new ShapeLayersService({}, undefined, { fill_opacity: 0.35, weight: 2, opacity: 0.6 }, ov, { fetch: okFetch() });
    svc.render(hassOf({ "sensor.w": pub() }));
    await flush();
    const group = ov.addOverlay.mock.calls[0][0];
    const first = group.layers[0];
    expect(first.data.geometry).toEqual(FILE.shapes["county/A"]);
    expect(first.opts.interactive).toBe(false);
    expect(first.opts.style()).toEqual({ color: "#0000FF", fillColor: "#0000FF", weight: 2, opacity: 0.6, fillOpacity: 0.35 });
    expect(first.opts.renderer.kind).toBe("svg");
    expect(L.svg).toHaveBeenCalledWith({ pane: "overlayPane" });
    expect(L.svg).toHaveBeenCalledTimes(1);
    expect(group.layers.map((l) => l.opts.style().color)).toEqual(["#0000FF", "#00FF00", "#FF0000"]);
  });

  it("canvas renderer when asked", () => {
    new ShapeLayersService({}, undefined, { renderer: "canvas" }, overlays(), { fetch: okFetch() }).render(hassOf({ "sensor.w": pub() }));
    expect(L.canvas).toHaveBeenCalledWith({ pane: "overlayPane" });
    expect(L.svg).not.toHaveBeenCalled();
  });

  it("a new URL fetches again and drops the old file", async () => {
    const fetch = okFetch();
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch });
    svc.render(hassOf({ "sensor.w": pub() }));
    await flush();
    svc.render(hassOf({ "sensor.w": pub({ shapes_url: "/x/shapes/bbb/f.json" }) }));
    await flush();
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["/x/shapes/aaa/f.json", "/x/shapes/bbb/f.json"]);
    const fetch2 = okFetch();
    new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: fetch2 }).render(hassOf({ "sensor.w": pub() }));
    expect(fetch2).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["non-200", () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(FILE) })],
    ["bad JSON", () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("bad")) })],
    ["no shapes mapping", () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ meta: {} }) })],
    ["network error", () => Promise.reject(new TypeError("offline"))],
  ])("rule 6, %s: one warning, polygons still drawn, retried after 10 minutes, never in a loop", async (_, impl) => {
    let t = 1000;
    const fetch = jest.fn(impl);
    const ov = overlays();
    const svc = new ShapeLayersService({}, undefined, undefined, ov, { fetch, now: () => t });
    svc.render(hassOf({ "sensor.w": pub() }));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ov.addOverlay.mock.calls[0][0].layers.length).toBe(1);
    for (let i = 0; i < 4; i++) svc.render(hassOf({ "sensor.w": pub() }));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    t += RETRY_MS - 1;
    svc.render(hassOf({ "sensor.w": pub() }));
    expect(fetch).toHaveBeenCalledTimes(1);
    t += 1;
    svc.render(hassOf({ "sensor.w": pub() }));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rule 7: a missing key warns once for the life of the page", async () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: okFetch() });
    svc.render(hassOf({ "sensor.w": pub({ zones: { "county/Q": "Warn", "county/A": "Warn" } }) }));
    await flush();
    svc.render(hassOf({ "sensor.w": pub({ zones: { "county/Q": "Watch" } }) }));
    new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: okFetch() }).render(hassOf({ "sensor.w": pub({ zones: { "county/Q": "Warn" } }) }));
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("county/Q")).length).toBe(1);
  });

  it("rule 9, auto: the publisher going unavailable or away removes what it drew and its checkbox", async () => {
    const ov = overlays();
    const svc = new ShapeLayersService({}, undefined, undefined, ov, { fetch: okFetch() });
    svc.render(hassOf({ "sensor.w": pub() }));
    await flush();
    const group = ov.addOverlay.mock.calls[0][0];
    svc.render(hassOf({ "sensor.w": { state: "unavailable", attributes: { friendly_name: "US alerts" } } }));
    expect(group.layers.length).toBe(0);
    expect(ov.removeOverlay).toHaveBeenCalledWith(group);
    expect(group.remove).toHaveBeenCalled();
  });

  it("rule 9, named: unavailable or malformed clears the drawing and keeps the checkbox; back again redraws", async () => {
    const ov = overlays();
    const svc = new ShapeLayersService({}, [{ entity: "sensor.w", name: "Warnings", show: false }], undefined, ov, { fetch: okFetch() });
    svc.render(hassOf({ "sensor.w": pub() }));
    await flush();
    expect(ov.addOverlay.mock.calls[0].slice(1)).toEqual(["Warnings", false]);
    const group = ov.addOverlay.mock.calls[0][0];
    expect(group.layers.length).toBe(3);
    svc.render(hassOf({ "sensor.w": { state: "unknown", attributes: {} } }));
    expect(group.layers.length).toBe(0);
    svc.render(hassOf({ "sensor.w": pub({ zones: "broken" }) }));
    expect(group.layers.length).toBe(0);
    expect(ov.removeOverlay).not.toHaveBeenCalled();
    svc.render(hassOf({ "sensor.w": pub() }));
    expect(group.layers.length).toBe(3);
    svc.render(hassOf({}));
    expect(ov.removeOverlay).toHaveBeenCalledWith(group);
    expect(ov.addOverlay).toHaveBeenCalledTimes(1);
  });

  it("named: an entity not in the states gets no checkbox", () => {
    const ov = overlays();
    new ShapeLayersService({}, ["sensor.absent"], undefined, ov, { fetch: okFetch() }).render(hassOf({ "sensor.w": pub() }));
    expect(ov.addOverlay).not.toHaveBeenCalled();
  });

  it("no friendly_name: the checkbox carries the entity id", () => {
    const ov = overlays();
    new ShapeLayersService({}, undefined, undefined, ov, { fetch: okFetch() }).render(hassOf({ "sensor.w": pub({ friendly_name: undefined, attribution: 3 }) }));
    expect(ov.addOverlay.mock.calls[0][1]).toBe("sensor.w");
    expect(ov.addOverlay.mock.calls[0][0].opts).toEqual({});
  });

  it("an error inside never escapes: the map keeps its markers", () => {
    const ov = { addOverlay: jest.fn(() => { throw new Error("boom"); }), removeOverlay: jest.fn() };
    const svc = new ShapeLayersService({}, undefined, undefined, ov, { fetch: okFetch() });
    expect(() => svc.render(hassOf({ "sensor.w": pub() }))).not.toThrow();
    expect(error).toHaveBeenCalled();
  });

  it("cleanup aborts an open fetch, removes every layer, and renders nothing after", async () => {
    let signal;
    const fetch = jest.fn((url, opts) => { signal = opts.signal; return new Promise(() => {}); });
    const ov = overlays();
    const svc = new ShapeLayersService({}, undefined, undefined, ov, { fetch });
    svc.render(hassOf({ "sensor.w": pub() }));
    const group = ov.addOverlay.mock.calls[0][0];
    svc.cleanup();
    expect(signal.aborted).toBe(true);
    expect(ov.removeOverlay).toHaveBeenCalledWith(group);
    svc.render(hassOf({ "sensor.w": pub() }));
    expect(ov.addOverlay).toHaveBeenCalledTimes(1);
  });

  it("a card torn down mid-fetch does not abort a file another card waits on; that card draws when it lands", async () => {
    let resolve;
    let signal;
    const fetch = jest.fn((url, opts) => { signal = opts.signal; return new Promise((r) => { resolve = r; }); });
    const a = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch });
    a.render(hassOf({ "sensor.w": pub() }));
    const ovB = overlays();
    const b = new ShapeLayersService({}, undefined, undefined, ovB, { fetch });
    b.render(hassOf({ "sensor.w": pub() }));
    a.cleanup();
    expect(signal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve({ ok: true, status: 200, json: () => Promise.resolve(FILE) });
    await flush();
    expect(ovB.addOverlay.mock.calls[0][0].layers.length).toBe(3);
    b.cleanup();
  });

  it("an aborted fetch is not cached as a failure: the next card fetches", async () => {
    const fetch = jest.fn((url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    }));
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch });
    svc.render(hassOf({ "sensor.w": pub() }));
    svc.cleanup();
    await flush();
    expect(warn).not.toHaveBeenCalled();
    const fetch2 = okFetch();
    new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: fetch2 }).render(hassOf({ "sensor.w": pub() }));
    expect(fetch2).toHaveBeenCalledTimes(1);
  });
});
