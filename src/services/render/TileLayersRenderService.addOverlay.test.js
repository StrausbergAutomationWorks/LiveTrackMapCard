import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// Backlog 277: a layer added after setup (shapes on the map, D12 rule 4) gets a
// checkbox in the same control, which is created if no tile layer was named.

jest.mock("leaflet", () => ({ __esModule: true, default: { Control: { Layers: jest.fn(function (base, overlays, opts) {
  this.overlays = { ...overlays }; this.opts = opts;
  this.addTo = jest.fn(() => this);
  this.addOverlay = jest.fn((layer, name) => { this.overlays[name] = layer; return this; });
  this.removeLayer = jest.fn((layer) => { for (const k of Object.keys(this.overlays)) if (this.overlays[k] === layer) delete this.overlays[k]; return this; });
}) } } }));
jest.mock("../../models/Layer", () => ({ __esModule: true, default: jest.fn(function (type, config) {
  this.render = jest.fn((show = true) => ({ config, shown: show }));
}) }));
jest.mock("../../models/LayerWithHistory", () => ({ __esModule: true, default: jest.fn(function () { this.render = jest.fn(); }) }));

import L from "leaflet";
import TileLayersService, { OVERLAY_STORAGE_PREFIX } from "./TileLayersRenderService.js";

/**
 * @param {object} [init] stored keys and values
 * @returns {Storage}
 */
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}
/** @returns {object} */
function makeMap() {
  const handlers = {};
  return { on: jest.fn((ev, fn) => { handlers[ev] = fn; }), handlers };
}
/** @returns {object} */
function makeLayer() {
  return { addTo: jest.fn() };
}

beforeEach(() => { L.Control.Layers.mockClear(); });

describe("addOverlay", () => {
  it("with no named tile layer, creates the control and adds the checkbox, shown", async () => {
    const map = makeMap();
    const svc = new TileLayersService(map, [], [], {}, {}, {}, memStorage());
    await svc.setup();
    expect(svc.control).toBeNull();
    const layer = makeLayer();
    expect(svc.addOverlay(layer, "US alerts")).toBe(true);
    expect(L.Control.Layers).toHaveBeenCalledTimes(1);
    expect(svc.control.opts).toEqual({ collapsed: false, position: "topright" });
    expect(svc.control.overlays).toEqual({ "US alerts": layer });
    expect(layer.addTo).toHaveBeenCalledWith(map);
  });

  it("joins the existing control when a tile layer is named", async () => {
    const svc = new TileLayersService(makeMap(), [{ url: "orm", name: "Rail lines" }], [], {}, {}, {}, memStorage());
    await svc.setup();
    svc.addOverlay(makeLayer(), "US alerts");
    expect(L.Control.Layers).toHaveBeenCalledTimes(1);
    expect(Object.keys(svc.control.overlays)).toEqual(["Rail lines", "US alerts"]);
  });

  it("show false, and the stored choice winning both ways", async () => {
    const svc = new TileLayersService(makeMap(), [], [], {}, {}, {}, memStorage({ [OVERLAY_STORAGE_PREFIX + "A"]: "0", [OVERLAY_STORAGE_PREFIX + "B"]: "1" }));
    const a = makeLayer(); const b = makeLayer(); const c = makeLayer();
    expect(svc.addOverlay(a, "A", true)).toBe(false);
    expect(svc.addOverlay(b, "B", false)).toBe(true);
    expect(svc.addOverlay(c, "C", false)).toBe(false);
    expect(a.addTo).not.toHaveBeenCalled();
    expect(b.addTo).toHaveBeenCalled();
    expect(c.addTo).not.toHaveBeenCalled();
    expect(Object.keys(svc.control.overlays)).toEqual(["A", "B", "C"]);
  });

  it("ticking an added overlay is remembered", async () => {
    const map = makeMap();
    const store = memStorage();
    const svc = new TileLayersService(map, [], [], {}, {}, {}, store);
    const layer = makeLayer();
    svc.addOverlay(layer, "US alerts");
    map.handlers.overlayremove({ layer });
    expect(store._m.get(OVERLAY_STORAGE_PREFIX + "US alerts")).toBe("0");
    map.handlers.overlayadd({ layer });
    expect(store._m.get(OVERLAY_STORAGE_PREFIX + "US alerts")).toBe("1");
  });

  it("removeOverlay drops the checkbox and stops remembering it; harmless with no control", async () => {
    const map = makeMap();
    const store = memStorage();
    const svc = new TileLayersService(map, [], [], {}, {}, {}, store);
    expect(() => svc.removeOverlay(makeLayer())).not.toThrow();
    const layer = makeLayer();
    svc.addOverlay(layer, "US alerts");
    svc.removeOverlay(layer);
    expect(svc.control.overlays).toEqual({});
    map.handlers.overlayremove({ layer });
    expect(store._m.size).toBe(0);
  });
});
