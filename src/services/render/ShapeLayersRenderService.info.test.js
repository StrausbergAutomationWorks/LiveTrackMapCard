import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// 06_MAP_CONTRACT_OVERLAYS.md D12 as amended for Live Track Weather item 310: a `polygons` item carrying `info`
// {title, text} is clickable and shows it; every other shape stays non-interactive.

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

import L from "leaflet";
import ShapeLayersService, {
  buildDrawList, infoOf, infoHtml, escapeHtml, INFO_POPUP, INFO_TITLE_MAX, INFO_TEXT_MAX, _resetShapeCache,
} from "./ShapeLayersRenderService.js";

const area = [[[0, 0], [1, 0], [1, 1], [0, 0]]];
const pub = (polygons) => ({
  state: "2",
  attributes: { zones: {}, styles: { w: { color: "#FFD500", priority: 3 }, s: { color: "#4F86B5", priority: 2 } }, polygons },
});

describe("D12 amended for item 310: clickable shapes", () => {
  beforeEach(() => { _resetShapeCache(); jest.clearAllMocks(); });

  it("info: plain text title and text, trimmed and cut; else none", () => {
    expect(infoOf({ title: " Gale ", text: "Southwest gale 8.\nDo not go out" })).toEqual({ title: "Gale", text: "Southwest gale 8.\nDo not go out" });
    expect(infoOf({ title: "only" })).toEqual({ title: "only", text: "" });
    expect(infoOf({ text: "only" })).toEqual({ title: "", text: "only" });
    for (const bad of [null, undefined, "x", [], {}, { title: " ", text: "" }, { title: 3, text: {} }]) expect(infoOf(bad)).toBeNull();
    const long = infoOf({ title: "t".repeat(500), text: "x".repeat(5000) });
    expect([long.title.length, long.text.length]).toEqual([INFO_TITLE_MAX, INFO_TEXT_MAX]);
    expect([INFO_TITLE_MAX, INFO_TEXT_MAX]).toEqual([200, 4000]);
  });

  it("the popup escapes everything the publisher sends and keeps its lines", () => {
    expect(escapeHtml(`<b onclick="x">&'`)).toBe("&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;");
    expect(infoHtml({ title: "E3 <script>", text: "line 1\nline 2" }))
      .toBe('<div class="ltmc-shape-info"><b>E3 &lt;script&gt;</b><br>line 1<br>line 2</div>');
    expect(infoHtml({ title: "", text: "a" })).toBe('<div class="ltmc-shape-info">a</div>');
    expect(infoHtml({ title: "T", text: "" })).toBe('<div class="ltmc-shape-info"><b>T</b></div>');
    expect(INFO_POPUP).toEqual({ maxWidth: 320, maxHeight: 320, autoPanPadding: [16, 16] });
  });

  it("buildDrawList carries the info", () => {
    const { items } = buildDrawList(pub([
      { event: "w", type: "Polygon", coordinates: area, info: { title: "Gale", text: "t" } },
      { event: "s", type: "Polygon", coordinates: area },
      { event: "s", type: "Polygon", coordinates: area, info: "not an object" },
    ]).attributes, null);
    // drawn largest priority first: the warning (3) beneath the forecasts (2)
    expect(items.map((i) => i.info ?? null)).toEqual([{ title: "Gale", text: "t" }, null, null]);
  });

  it("a shape with info is interactive and opens its popup; one without stays non-interactive", () => {
    const overlays = { addOverlay: jest.fn(), removeOverlay: jest.fn() };
    const svc = new ShapeLayersService({}, undefined, undefined, overlays, { fetch: jest.fn() });
    svc.render({ states: { "sensor.met": pub([
      { event: "w", type: "Polygon", coordinates: area, info: { title: "Gale", text: "Southwest gale 8." } },
      { event: "s", type: "Polygon", coordinates: area },
    ]) } });
    const layers = svc.publishers.get("sensor.met").group.layers;
    expect(layers).toHaveLength(2);
    const [withInfo, plain] = layers;
    expect(plain.opts.interactive).toBe(false);
    expect(plain.bindPopup).not.toHaveBeenCalled();
    expect(withInfo.opts.interactive).toBe(true);
    expect(withInfo.popup).toEqual({ html: '<div class="ltmc-shape-info"><b>Gale</b><br>Southwest gale 8.</div>', o: INFO_POPUP });
  });

  it("a cased line with info: the line is clickable, its casing is not", () => {
    const overlays = { addOverlay: jest.fn(), removeOverlay: jest.fn() };
    const svc = new ShapeLayersService({}, undefined, undefined, overlays, { fetch: jest.fn() });
    const s = pub([{ event: "w", type: "LineString", coordinates: [[0, 0], [1, 1]], info: { text: "track" } }]);
    s.attributes.styles.w.casing = "#FFFFFF";
    svc.render({ states: { "sensor.met": s } });
    const [casing, line] = svc.publishers.get("sensor.met").group.layers;
    expect(casing.opts.interactive).toBe(false);
    expect(casing.bindPopup).not.toHaveBeenCalled();
    expect(line.opts.interactive).toBe(true);
    expect(L.geoJSON).toHaveBeenCalledTimes(2);
  });
});
