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

// 06_MAP_CONTRACT_OVERLAYS.md D12 as amended for D15: a publisher with no shape
// file, and lines.

import L from "leaflet";
import ShapeLayersService, { isPublisherState, buildDrawList, isLine, _resetShapeCache } from "./ShapeLayersRenderService.js";

const storms = (extra = {}) => ({
  state: "2",
  attributes: {
    zones: {},
    styles: { "Forecast track": { color: "#000000", priority: 1 }, "Forecast cone": { color: "#FFFFFF", priority: 6 } },
    polygons: [
      { event: "Forecast track", type: "LineString", coordinates: [[0, 0], [1, 1]] },
      { event: "Forecast cone", type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    ],
    ...extra,
  },
});

describe("D12 amended for D15", () => {
  beforeEach(() => { _resetShapeCache(); jest.clearAllMocks(); });

  it("a publisher with polygons and no shape file", () => {
    expect(isPublisherState(storms())).toBe(true);
    expect(isPublisherState({ state: "1", attributes: { zones: {} } })).toBe(false);
    expect(isPublisherState({ state: "1", attributes: { polygons: [] } })).toBe(false);
    expect(isPublisherState({ state: "unavailable", attributes: storms().attributes })).toBe(false);
  });

  it("lines are kept, drawn after areas of the same priority", () => {
    expect(isLine({ type: "MultiLineString", coordinates: [] })).toBe(true);
    expect(isLine({ type: "Point", coordinates: [0, 0] })).toBe(false);
    const { items } = buildDrawList(storms().attributes, null);
    expect(items.map((i) => [i.kind, i.event])).toEqual([["polygon", "Forecast cone"], ["line", "Forecast track"]]);
    const same = buildDrawList({ styles: { e: { color: "#111111", priority: 1 } }, polygons: [
      { event: "e", type: "LineString", coordinates: [[0, 0], [1, 1]] },
      { event: "e", type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    ] }, null).items;
    expect(same.map((i) => i.kind)).toEqual(["polygon", "line"]);
  });

  it("no fetch without a shape file, and a line has no fill", () => {
    const fetch = jest.fn();
    const overlays = { addOverlay: jest.fn(), removeOverlay: jest.fn() };
    const svc = new ShapeLayersService({}, undefined, undefined, overlays, { fetch });
    svc.render({ states: { "sensor.storms": storms() } });
    expect(fetch).not.toHaveBeenCalled();
    expect(overlays.addOverlay).toHaveBeenCalledTimes(1);
    const calls = L.geoJSON.mock.calls;
    expect(calls).toHaveLength(2);
    const line = calls.find(([d]) => d.geometry.type === "LineString")[1].style();
    expect(line).toEqual({ color: "#000000", weight: 2, opacity: 0.9, fill: false });
    const area = calls.find(([d]) => d.geometry.type === "Polygon")[1].style();
    expect(area.fillOpacity).toBe(0.25);
    expect(area.fillColor).toBe("#FFFFFF");
  });

  it("a shape file publisher still fetches", () => {
    const fetch = jest.fn(() => new Promise(() => {}));
    const overlays = { addOverlay: jest.fn(), removeOverlay: jest.fn() };
    const svc = new ShapeLayersService({}, undefined, undefined, overlays, { fetch });
    svc.render({ states: { "sensor.alerts": { state: "1", attributes: { shapes_url: "/x.json", zones: {} } } } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
