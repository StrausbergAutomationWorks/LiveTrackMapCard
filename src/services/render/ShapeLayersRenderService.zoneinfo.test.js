import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// 06_MAP_CONTRACT_OVERLAYS.md D12 as amended 2026-11-25: a publisher may send `zone_info`, live click text per key
// in `zones`. A valid entry makes that zone clickable and REPLACES the file's `info` for the key, whole; an entry
// that is not valid leaves the file's in force; keys not in `zones` are ignored. Each test names the rule it pins.

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
        const l = { data, opts, bringToFront: jest.fn(), popup: null, handlers: {} };
        l.bindPopup = jest.fn((html, o) => { l.popup = { html, o }; return l; });
        l.on = jest.fn((ev, fn) => { l.handlers[ev] = fn; return l; });
        return l;
      }),
    },
  };
});

import ShapeLayersService, { buildDrawList, INFO_POPUP, INFO_TITLE_MAX, INFO_TEXT_MAX, _resetShapeCache } from "./ShapeLayersRenderService.js";

const AREA = (x) => ({ type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]] });
const LINE = { type: "LineString", coordinates: [[0, 0], [10, 1]] };
const FILE = {
  meta: {},
  shapes: { "area/a": AREA(0), "area/b": AREA(2), "area/c": AREA(4), "line/d": LINE },
  info: { "area/a": { title: "File A", text: "From the file" }, "area/b": { title: "File B" } },
};
const STYLES = { Red: { color: "#C62828", priority: 5 } };
const pub = (over = {}) => ({
  state: "3",
  attributes: {
    friendly_name: "Areas", shapes_url: "/x/shapes/aaaaaaaaaaaa/areas.json",
    zones: { "area/a": "Red", "area/b": "Red", "area/c": "Red" }, styles: STYLES, ...over,
  },
});
const okFetch = (json = FILE) => jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) }));
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const overlays = () => ({ addOverlay: jest.fn(() => true), removeOverlay: jest.fn() });
const hassOf = (states) => ({ states });
const infoByKey = (items) => Object.fromEntries(items.map((i) => [i.key, i.info ?? null]));

beforeEach(() => {
  _resetShapeCache();
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("buildDrawList: zone_info", () => {
  it("a key with a live entry carries it; a key with neither live nor file text carries none", () => {
    const attrs = pub({ zone_info: { "area/c": { title: "Alert", text: "Since 01:12\nAlso: other" } } }).attributes;
    const { items } = buildDrawList(attrs, FILE.shapes, null);
    expect(infoByKey(items)).toEqual({ "area/a": null, "area/b": null, "area/c": { title: "Alert", text: "Since 01:12\nAlso: other" } });
  });

  it("the live entry REPLACES the file's whole: no file title survives beside live text", () => {
    const attrs = pub({ zone_info: { "area/a": { text: "Live only" } } }).attributes;
    const { items } = buildDrawList(attrs, FILE.shapes, FILE.info);
    expect(infoByKey(items)["area/a"]).toEqual({ title: "", text: "Live only" });
    expect(infoByKey(items)["area/b"]).toEqual({ title: "File B", text: "" });
  });

  it("an entry that is not valid leaves the file's in force", () => {
    for (const bad of ["text", 7, null, [], {}, { title: "  ", text: "" }, { title: 3 }]) {
      const { items } = buildDrawList(pub({ zone_info: { "area/a": bad } }).attributes, FILE.shapes, FILE.info);
      expect(infoByKey(items)["area/a"]).toEqual({ title: "File A", text: "From the file" });
    }
  });

  it("zone_info that is not a mapping is none; keys not in zones add nothing", () => {
    for (const bad of [[], "x", 1, null, undefined]) {
      const { items } = buildDrawList(pub({ zone_info: bad }).attributes, FILE.shapes, FILE.info);
      expect(infoByKey(items)).toEqual({ "area/a": { title: "File A", text: "From the file" }, "area/b": { title: "File B", text: "" }, "area/c": null });
    }
    const { items } = buildDrawList(pub({ zone_info: { "area/z": { title: "Not drawn" }, "line/d": { title: "Not in zones" } } }).attributes, FILE.shapes);
    expect(items.map((i) => i.key)).toEqual(["area/a", "area/b", "area/c"]);
    expect(items.every((i) => !("info" in i))).toBe(true);
  });

  it("checked as info is: title and text cut at their limits, trimmed", () => {
    const attrs = pub({ zone_info: { "area/c": { title: ` ${"t".repeat(INFO_TITLE_MAX + 50)} `, text: "x".repeat(INFO_TEXT_MAX + 9) } } }).attributes;
    const info = infoByKey(buildDrawList(attrs, FILE.shapes).items)["area/c"];
    expect(info.title).toHaveLength(INFO_TITLE_MAX);
    expect(info.text).toHaveLength(INFO_TEXT_MAX);
  });

  it("drawing order is unchanged by zone_info (rule 3: within a priority, by key)", () => {
    const plain = buildDrawList(pub().attributes, FILE.shapes).items.map((i) => i.key);
    const withInfo = buildDrawList(pub({ zone_info: { "area/a": { title: "A" } } }).attributes, FILE.shapes).items.map((i) => i.key);
    expect(withInfo).toEqual(plain);
  });
});

describe("drawn: a zone with live text is clickable", () => {
  it("its area is interactive with the live popup; zones without text stay non-interactive", async () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: okFetch({ meta: {}, shapes: FILE.shapes }) });
    svc.render(hassOf({ "sensor.areas": pub({ zone_info: { "area/b": { title: "Air <b>", text: "Since 01:12\nSecond line" } } }) }));
    await flush();
    const [a, b, c] = svc.publishers.get("sensor.areas").group.layers;
    expect(b.opts.interactive).toBe(true);
    expect(b.popup).toEqual({ html: '<div class="ltmc-shape-info"><b>Air &lt;b&gt;</b><br>Since 01:12<br>Second line</div>', o: INFO_POPUP });
    for (const l of [a, c]) {
      expect(l.opts.interactive).toBe(false);
      expect(l.bindPopup).not.toHaveBeenCalled();
    }
  });

  it("a live entry over a file entry shows the live text", async () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: okFetch() });
    svc.render(hassOf({ "sensor.areas": pub({ zone_info: { "area/a": { title: "Live A" } } }) }));
    await flush();
    const [a] = svc.publishers.get("sensor.areas").group.layers;
    expect(a.popup.html).toBe('<div class="ltmc-shape-info"><b>Live A</b></div>');
  });

  it("a new state with new text redraws with the new popup; text removed falls back to the file's", async () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: okFetch() });
    svc.render(hassOf({ "sensor.areas": pub({ zone_info: { "area/a": { title: "First" } } }) }));
    await flush();
    svc.render(hassOf({ "sensor.areas": pub({ zone_info: { "area/a": { title: "Second" } } }) }));
    expect(svc.publishers.get("sensor.areas").group.layers[0].popup.html).toBe('<div class="ltmc-shape-info"><b>Second</b></div>');
    svc.render(hassOf({ "sensor.areas": pub() }));
    expect(svc.publishers.get("sensor.areas").group.layers[0].popup.html).toBe('<div class="ltmc-shape-info"><b>File A</b><br>From the file</div>');
  });

  it("a clickable zone asks the points first, as every clickable shape does (D19 rule 4)", async () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: okFetch({ meta: {}, shapes: FILE.shapes }) });
    svc.pointsFirst = jest.fn(() => false);
    svc.render(hassOf({ "sensor.areas": pub({ zone_info: { "area/c": { title: "C" } } }) }));
    await flush();
    const c = svc.publishers.get("sensor.areas").group.layers[2];
    c.handlers.click({ containerPoint: { x: 7, y: 8 } });
    expect(svc.pointsFirst).toHaveBeenCalledWith({ x: 7, y: 8 });
  });

  it("before the file arrives no zone is drawn, live text or not", () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: jest.fn(() => new Promise(() => {})) });
    svc.render(hassOf({ "sensor.areas": pub({ zone_info: { "area/a": { title: "A" } } }) }));
    expect(svc.publishers.get("sensor.areas").group.layers).toHaveLength(0);
  });
});
