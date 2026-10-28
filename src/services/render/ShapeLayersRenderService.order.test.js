import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// 06_MAP_CONTRACT_OVERLAYS.md D12 as amended for D16: publishers stacked by
// `shape_order` (the SPC outlook beneath the US alerts), held across redraws
// and re-ticks.

const fronted = [];

jest.mock("leaflet", () => {
  const mk = (kind) => jest.fn((opts) => ({ kind, opts }));
  return {
    __esModule: true,
    default: {
      svg: mk("svg"),
      canvas: mk("canvas"),
      layerGroup: jest.fn((layers, opts) => {
        const g = {
          opts, layers: [...layers], handlers: {},
          clearLayers: jest.fn(() => { g.layers = []; return g; }),
          addLayer: jest.fn((l) => { l.owner = g; g.layers.push(l); return g; }),
          remove: jest.fn(() => g),
          eachLayer: jest.fn((fn) => { g.layers.forEach(fn); return g; }),
          on: jest.fn((ev, fn) => { g.handlers[ev] = fn; return g; }),
        };
        return g;
      }),
      geoJSON: jest.fn((data, opts) => {
        const l = { data, opts };
        l.bringToFront = jest.fn(() => { fronted.push(l); return l; });
        return l;
      }),
    },
  };
});

import ShapeLayersService, { shapeOrderOf, _resetShapeCache } from "./ShapeLayersRenderService.js";

const AREA = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

/**
 * @param {string} event
 * @param {number} n how many polygons
 * @param {object} [extra] more attributes
 * @returns {object} a publisher state with no shape file
 */
function pub(event, n, extra = {}) {
  return {
    state: "1",
    attributes: {
      zones: {},
      polygons: Array.from({ length: n }, () => ({ event, ...AREA })),
      styles: { [event]: { color: "#112233", priority: 1 } },
      ...extra,
    },
  };
}

/** @returns {object} an overlay control stand-in */
const overlays = () => ({ addOverlay: jest.fn(() => true), removeOverlay: jest.fn() });

/**
 * @param {object} svc
 * @param {string} id
 * @returns {object} the publisher's group
 */
const groupOf = (svc, id) => svc.publishers.get(id).group;

/**
 * @param {object} svc
 * @returns {string[]} for each fronted layer, the id of the publisher that owns it
 */
function frontedIds(svc) {
  const byGroup = new Map([...svc.publishers.entries()].map(([id, p]) => [p.group, id]));
  return fronted.map((l) => byGroup.get(l.owner));
}

describe("D12 amended for D16: shape_order", () => {
  beforeEach(() => { _resetShapeCache(); jest.clearAllMocks(); fronted.length = 0; });

  it("shape_order is an integer, else 0", () => {
    expect(shapeOrderOf({ shape_order: -10 })).toBe(-10);
    expect(shapeOrderOf({ shape_order: 3 })).toBe(3);
    for (const bad of [undefined, null, "-10", 1.5, NaN, Infinity, true]) expect(shapeOrderOf({ shape_order: bad })).toBe(0);
    expect(shapeOrderOf(undefined)).toBe(0);
  });

  it("a lower publisher drawn later puts the higher ones back on top, in their own order", () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: jest.fn() });
    const alerts = pub("Warn", 2);
    svc.render({ states: { "sensor.alerts": alerts } });
    expect(fronted).toHaveLength(0);
    svc.render({ states: { "sensor.alerts": alerts, "sensor.outlook": pub("Slight Risk", 3, { shape_order: -10 }) } });
    expect(frontedIds(svc)).toEqual(["sensor.alerts", "sensor.alerts"]);
    expect(fronted).toEqual(groupOf(svc, "sensor.alerts").layers);
  });

  it("the top publisher redrawn moves nothing", () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: jest.fn() });
    const outlook = pub("Slight Risk", 3, { shape_order: -10 });
    svc.render({ states: { "sensor.outlook": outlook, "sensor.alerts": pub("Warn", 2) } });
    fronted.length = 0;
    svc.render({ states: { "sensor.outlook": outlook, "sensor.alerts": pub("Warn", 4) } });
    expect(fronted).toHaveLength(0);
  });

  it("ties go by entity id, and every higher publisher is restacked lowest first", () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: jest.fn() });
    const b = pub("B", 1);
    const c = pub("C", 1, { shape_order: 5 });
    svc.render({ states: { "sensor.b": b, "sensor.c": c } });
    fronted.length = 0;
    svc.render({ states: { "sensor.a": pub("A", 1), "sensor.b": b, "sensor.c": c } });
    expect(frontedIds(svc)).toEqual(["sensor.b", "sensor.c"]);
  });

  it("a re-ticked box restores the order; the top one moves nothing", () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: jest.fn() });
    svc.render({ states: { "sensor.alerts": pub("Warn", 2), "sensor.outlook": pub("Slight Risk", 1, { shape_order: -10 }) } });
    fronted.length = 0;
    groupOf(svc, "sensor.outlook").handlers.add();
    expect(frontedIds(svc)).toEqual(["sensor.alerts", "sensor.alerts"]);
    fronted.length = 0;
    groupOf(svc, "sensor.alerts").handlers.add();
    expect(fronted).toHaveLength(0);
  });

  it("a publisher that changes its order is restacked by its new one", () => {
    const svc = new ShapeLayersService({}, undefined, undefined, overlays(), { fetch: jest.fn() });
    svc.render({ states: { "sensor.alerts": pub("Warn", 1), "sensor.outlook": pub("Slight Risk", 1, { shape_order: -10 }) } });
    fronted.length = 0;
    svc.render({ states: { "sensor.alerts": pub("Warn", 1), "sensor.outlook": pub("Slight Risk", 1, { shape_order: 10 }) } });
    expect(fronted).toHaveLength(0);
    expect(svc.publishers.get("sensor.outlook").order).toBe(10);
  });
});
