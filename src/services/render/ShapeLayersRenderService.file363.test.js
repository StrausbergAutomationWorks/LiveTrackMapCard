import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// Backlog 363 (06_MAP_CONTRACT_OVERLAYS.md D12 and D19 as amended for Live Track Internet): a publisher may start
// its checkbox unticked (`layer_default: "off"`); a key's geometry in the file may be a line; the file may carry
// `info` beside `shapes`, making that key clickable. Each test names the change it pins.

jest.mock("leaflet", () => {
  const mk = (kind) => jest.fn((opts) => ({ kind, opts }));
  return {
    __esModule: true,
    default: {
      svg: mk("svg"),
      canvas: mk("canvas"),
      layerGroup: jest.fn((layers, opts) => {
        const g = {
          opts, layers: [...layers],
          clearLayers: jest.fn(() => { g.layers = []; return g; }),
          addLayer: jest.fn((l) => { g.layers.push(l); return g; }),
          remove: jest.fn(() => g),
          eachLayer: jest.fn((fn) => { g.layers.forEach(fn); return g; }),
          on: jest.fn(() => g),
        };
        return g;
      }),
      geoJSON: jest.fn((data, opts) => {
        const l = { data, opts, bringToFront: jest.fn(), popup: null };
        l.bindPopup = jest.fn((html, o) => { l.popup = { html, o }; return l; });
        return l;
      }),
    },
  };
});

import ShapeLayersService, {
  buildDrawList, infosOf, shapesOf, LINE_HIT_PX, INFO_POPUP, DEFAULT_SHAPE_STYLE, DEFAULT_FILE_LINE_STYLE,
  parseFileLineStyle, _resetShapeCache,
} from "./ShapeLayersRenderService.js";
import { layerShown, publisherShownByDefault, LAYER_DEFAULT_OFF } from "../../util/LayerDefault.js";

const LINE = { type: "LineString", coordinates: [[0, 0], [10, 1]] };
const MULTI = { type: "MultiLineString", coordinates: [[[170, 0], [180, 1]], [[-180, 1], [-170, 2]]] };
const AREA = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const FILE = {
  meta: {},
  shapes: { "cable/a": LINE, "cable/b": MULTI, "zone/c": AREA },
  info: { "cable/a": { title: "Cable A", text: "RFS: 2020\nOwners: X, Y" }, "cable/b": "not a mapping", "zone/c": { text: "Area C" } },
};
const STYLES = { cable: { color: "#5C6BC0", priority: 5 } };
const pub = (over = {}) => ({
  state: "713",
  attributes: { friendly_name: "All cables", shapes_url: "/live_track_internet/shapes/aaaaaaaaaaaa/cables.json", zones: { "cable/a": "cable", "cable/b": "cable", "zone/c": "cable" }, styles: STYLES, attribution: "Hotham (2026)", ...over },
});
const okFetch = (json = FILE) => jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) }));
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const overlays = () => ({ addOverlay: jest.fn(() => true), removeOverlay: jest.fn() });
const hassOf = (states) => ({ states });

beforeEach(() => {
  _resetShapeCache();
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("change 1: layer_default", () => {
  it("only \"off\" starts a box unticked; anything else, or nothing, is on", () => {
    expect(LAYER_DEFAULT_OFF).toBe("off");
    expect(publisherShownByDefault({ layer_default: "off" })).toBe(false);
    for (const v of [undefined, null, "on", "OFF", false, 0, "", {}]) expect(publisherShownByDefault({ layer_default: v })).toBe(true);
    expect(publisherShownByDefault(undefined)).toBe(true);
  });

  it("a dashboard's explicit show wins over the publisher; unset leaves it to the publisher", () => {
    expect(layerShown(true, { layer_default: "off" })).toBe(true);
    expect(layerShown(false, {})).toBe(false);
    expect(layerShown(null, { layer_default: "off" })).toBe(false);
    expect(layerShown(null, {})).toBe(true);
    expect(layerShown(undefined, { layer_default: "off" })).toBe(false);
  });

  it("auto: a publisher declaring off is handed to the layer control unticked; others ticked", () => {
    const ov = overlays();
    new ShapeLayersService({}, undefined, undefined, ov, { fetch: okFetch() })
      .render(hassOf({ "sensor.all": pub({ layer_default: "off" }), "sensor.us": pub({ friendly_name: "US alerts" }) }));
    const byName = Object.fromEntries(ov.addOverlay.mock.calls.map((c) => [c[1], c[2]]));
    expect(byName).toEqual({ "All cables": false, "US alerts": true });
  });

  it("a named list: show true overrides the publisher's off; no show follows it", () => {
    const ov = overlays();
    new ShapeLayersService({}, [{ entity: "sensor.all", show: true }, "sensor.b"], undefined, ov, { fetch: okFetch() })
      .render(hassOf({ "sensor.all": pub({ layer_default: "off" }), "sensor.b": pub({ friendly_name: "B", layer_default: "off" }) }));
    expect(ov.addOverlay.mock.calls.map((c) => [c[1], c[2]])).toEqual([["All cables", true], ["B", false]]);
  });

  it("the default is read once, at first sight: a later change does not re-tick or untick the box", () => {
    const ov = overlays();
    const svc = new ShapeLayersService({}, undefined, undefined, ov, { fetch: okFetch() });
    svc.render(hassOf({ "sensor.all": pub({ layer_default: "off" }) }));
    svc.render(hassOf({ "sensor.all": pub() }));
    expect(ov.addOverlay).toHaveBeenCalledTimes(1);
  });
});

describe("change 2: lines from the file", () => {
  it("a key whose geometry is a LineString or MultiLineString is drawn; it carries line: true", () => {
    const { items, missing } = buildDrawList(pub().attributes, FILE.shapes);
    expect(missing).toEqual([]);
    expect(items.map((i) => [i.key, i.kind, i.line ?? false])).toEqual([["cable/a", "zone", true], ["cable/b", "zone", true], ["zone/c", "zone", false]]);
  });

  it("anything else in the file is still missing, as before (rule 7)", () => {
    const shapes = { "cable/a": { type: "Point", coordinates: [0, 0] }, "cable/b": { type: "LineString" }, "zone/c": AREA };
    expect(buildDrawList(pub().attributes, shapes).missing).toEqual(["cable/a", "cable/b"]);
  });

  it("a file line is drawn as a line: its colour, the FILE-LINE weight and opacity, no fill; a casing beneath it", async () => {
    const styles = { cable: { color: "#5C6BC0", priority: 5, casing: "#FFFFFF" } };
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: okFetch({ meta: {}, shapes: { "cable/a": LINE } }) });
    svc.render(hassOf({ "sensor.all": pub({ zones: { "cable/a": "cable" }, styles }) }));
    await flush();
    const layers = svc.publishers.get("sensor.all").group.layers;
    expect(layers).toHaveLength(2);
    const [casing, line] = layers;
    expect(casing.opts.style()).toEqual({ color: "#FFFFFF", weight: DEFAULT_FILE_LINE_STYLE.weight + 2, opacity: DEFAULT_FILE_LINE_STYLE.opacity, fill: false });
    expect(line.opts.style()).toEqual({ color: "#5C6BC0", weight: DEFAULT_FILE_LINE_STYLE.weight, opacity: DEFAULT_FILE_LINE_STYLE.opacity, fill: false });
    expect(line.opts.interactive).toBe(false);
  });

  it("an area in the same file is still filled", async () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: okFetch({ meta: {}, shapes: { "zone/c": AREA } }) });
    svc.render(hassOf({ "sensor.all": pub({ zones: { "zone/c": "cable" } }) }));
    await flush();
    const [area] = svc.publishers.get("sensor.all").group.layers;
    expect(area.opts.style().fillOpacity).toBe(DEFAULT_SHAPE_STYLE.fillOpacity);
    expect(area.opts.style().fillColor).toBe("#5C6BC0");
  });
});

describe("change 4: lines from the file draw at their own, lighter default (2026-11-24, from pictures)", () => {
  it("the default is lighter than the outline's, and the one picked", () => {
    expect(DEFAULT_FILE_LINE_STYLE).toEqual({ weight: 1, opacity: 0.5 });
    expect(DEFAULT_FILE_LINE_STYLE.weight).toBeLessThan(DEFAULT_SHAPE_STYLE.weight);
    expect(DEFAULT_FILE_LINE_STYLE.opacity).toBeLessThan(DEFAULT_SHAPE_STYLE.opacity);
  });

  it("parseFileLineStyle: file_line_weight and file_line_opacity override; bad values keep the default", () => {
    expect(parseFileLineStyle(undefined)).toEqual(DEFAULT_FILE_LINE_STYLE);
    expect(parseFileLineStyle({ weight: 5, opacity: 0.1 })).toEqual(DEFAULT_FILE_LINE_STYLE);
    expect(parseFileLineStyle({ file_line_weight: 1.5, file_line_opacity: 0.35 })).toEqual({ weight: 1.5, opacity: 0.35 });
    expect(parseFileLineStyle({ file_line_weight: 0, file_line_opacity: 0 })).toEqual({ weight: 0, opacity: 0 });
    expect(parseFileLineStyle({ file_line_opacity: 1 })).toEqual({ weight: 1, opacity: 1 });
    expect(parseFileLineStyle({ file_line_weight: -1, file_line_opacity: 1.5 })).toEqual(DEFAULT_FILE_LINE_STYLE);
    expect(parseFileLineStyle({ file_line_weight: "2", file_line_opacity: NaN })).toEqual(DEFAULT_FILE_LINE_STYLE);
    expect(parseFileLineStyle({ file_line_weight: Infinity })).toEqual(DEFAULT_FILE_LINE_STYLE);
    expect(parseFileLineStyle([1, 2])).toEqual(DEFAULT_FILE_LINE_STYLE);
  });

  it("the dashboard's file_line_* reach the drawn line, its casing and its band", async () => {
    const styles = { cable: { color: "#5C6BC0", priority: 5, casing: "#FFFFFF" } };
    const svc = new ShapeLayersService({}, undefined, { file_line_weight: 3, file_line_opacity: 0.4, weight: 7, opacity: 0.8 }, overlays(), { fetch: okFetch() });
    svc.render(hassOf({ "sensor.all": pub({ zones: { "cable/a": "cable" }, styles }) }));
    await flush();
    const [casing, line, band] = svc.publishers.get("sensor.all").group.layers;
    expect(casing.opts.style()).toEqual({ color: "#FFFFFF", weight: 5, opacity: 0.4, fill: false });
    expect(line.opts.style()).toEqual({ color: "#5C6BC0", weight: 3, opacity: 0.4, fill: false });
    expect(band.opts.style()).toEqual({ color: "#5C6BC0", weight: LINE_HIT_PX, opacity: 0, fill: false });
  });

  it("a polygons line keeps the outline's weight and opacity, file_line_* or not", async () => {
    const styles = { cable: { color: "#C62828", priority: 1, casing: "#FFFFFF" } };
    const svc = new ShapeLayersService({}, undefined, { file_line_weight: 1, file_line_opacity: 0.2 }, overlays(), { fetch: jest.fn(() => new Promise(() => {})) });
    svc.render(hassOf({ "sensor.trouble": pub({ polygons: [{ event: "cable", ...LINE, info: { title: "2Africa" } }], styles }) }));
    const [casing, line, band] = svc.publishers.get("sensor.trouble").group.layers;
    expect(casing.opts.style()).toEqual({ color: "#FFFFFF", weight: DEFAULT_SHAPE_STYLE.weight + 2, opacity: DEFAULT_SHAPE_STYLE.opacity, fill: false });
    expect(line.opts.style()).toEqual({ color: "#C62828", weight: DEFAULT_SHAPE_STYLE.weight, opacity: DEFAULT_SHAPE_STYLE.opacity, fill: false });
    expect(band.opts.style().weight).toBe(LINE_HIT_PX);
  });

  it("an area from the file keeps the outline's weight and opacity", async () => {
    const svc = new ShapeLayersService({}, undefined, { file_line_weight: 9, file_line_opacity: 0.1 }, overlays(), { fetch: okFetch({ meta: {}, shapes: { "zone/c": AREA } }) });
    svc.render(hassOf({ "sensor.all": pub({ zones: { "zone/c": "cable" } }) }));
    await flush();
    const [area] = svc.publishers.get("sensor.all").group.layers;
    expect(area.opts.style().weight).toBe(DEFAULT_SHAPE_STYLE.weight);
    expect(area.opts.style().opacity).toBe(DEFAULT_SHAPE_STYLE.opacity);
  });
});

describe("change 3: info from the file", () => {
  it("infosOf: a mapping beside shapes, else none; shapesOf is unchanged", () => {
    expect(infosOf(FILE)).toBe(FILE.info);
    for (const bad of [{ shapes: {} }, { shapes: {}, info: [] }, { shapes: {}, info: "x" }, null, []]) expect(infosOf(bad)).toBeNull();
    expect(shapesOf(FILE)).toBe(FILE.shapes);
  });

  it("buildDrawList takes each key's info, checked as polygons' info is; a bad entry is none", () => {
    const { items } = buildDrawList(pub().attributes, FILE.shapes, FILE.info);
    expect(items.map((i) => i.info ?? null)).toEqual([{ title: "Cable A", text: "RFS: 2020\nOwners: X, Y" }, null, { title: "", text: "Area C" }]);
    expect(buildDrawList(pub().attributes, FILE.shapes).items.every((i) => !("info" in i))).toBe(true);
  });

  it("a file line with info: drawn line non-interactive, a transparent band over it answers the click", async () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: okFetch() });
    svc.render(hassOf({ "sensor.all": pub({ zones: { "cable/a": "cable" } }) }));
    await flush();
    const [line, band] = svc.publishers.get("sensor.all").group.layers;
    expect(line.opts.interactive).toBe(false);
    expect(line.bindPopup).not.toHaveBeenCalled();
    expect(band.opts.interactive).toBe(true);
    expect(band.opts.style()).toEqual({ color: "#5C6BC0", weight: LINE_HIT_PX, opacity: 0, fill: false });
    expect(band.popup).toEqual({ html: '<div class="ltmc-shape-info"><b>Cable A</b><br>RFS: 2020<br>Owners: X, Y</div>', o: INFO_POPUP });
  });

  it("a file area with info is itself clickable, as a polygons area is; a key without info gets no band", async () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: okFetch() });
    svc.render(hassOf({ "sensor.all": pub() }));
    await flush();
    const layers = svc.publishers.get("sensor.all").group.layers;
    // cable/a: line + band; cable/b: line only (its info is not a mapping); zone/c: one clickable area
    expect(layers).toHaveLength(4);
    const area = layers[3];
    expect(area.opts.interactive).toBe(true);
    expect(area.popup.html).toBe('<div class="ltmc-shape-info">Area C</div>');
    expect(layers[2].opts.interactive).toBe(false);
    expect(layers[2].bindPopup).not.toHaveBeenCalled();
  });

  it("the band is never thinner than the drawn line", async () => {
    const svc = new ShapeLayersService({}, undefined, { file_line_weight: 20 }, overlays(), { fetch: okFetch() });
    svc.render(hassOf({ "sensor.all": pub({ zones: { "cable/a": "cable" } }) }));
    await flush();
    const [, band] = svc.publishers.get("sensor.all").group.layers;
    expect(band.opts.style().weight).toBe(20);
    expect(LINE_HIT_PX).toBe(12);
  });

  it("before the file arrives nothing from it is drawn; polygons still are, with their own info", () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: jest.fn(() => new Promise(() => {})) });
    svc.render(hassOf({ "sensor.trouble": pub({ friendly_name: "Cables in trouble", polygons: [{ event: "cable", ...MULTI, info: { title: "2Africa" } }] }) }));
    const layers = svc.publishers.get("sensor.trouble").group.layers;
    expect(layers).toHaveLength(2);
    expect(layers[1].popup.html).toBe('<div class="ltmc-shape-info"><b>2Africa</b></div>');
  });
});
