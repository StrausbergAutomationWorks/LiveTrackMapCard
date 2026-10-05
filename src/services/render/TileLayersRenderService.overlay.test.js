import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// Lee, 2026-10-05: the rail overlay on/off on the card. A named tile_layers
// entry gets a checkbox in a Leaflet layer control; `show: false` starts it
// off; the viewer's choice is kept in their own browser.

jest.mock("leaflet", () => ({ __esModule: true, default: { Control: { Layers: jest.fn(function (base, overlays, opts) {
  this.base = base; this.overlays = overlays; this.opts = opts; this.addTo = jest.fn(() => this);
}) } } }));
const mockRendered = [];
jest.mock("../../models/Layer", () => ({
  __esModule: true,
  default: jest.fn(function (type, config) {
    this.render = jest.fn((show = true) => { const l = { config, shown: show }; mockRendered.push(l); return l; });
  }),
}));
jest.mock("../../models/LayerWithHistory", () => ({ __esModule: true, default: jest.fn(function () { this.render = jest.fn(); }) }));

import L from "leaflet";
import TileLayersService, { storedOverlayChoice, storeOverlayChoice, OVERLAY_STORAGE_PREFIX } from "./TileLayersRenderService.js";

/**
 * @param {object} [init] stored keys and values
 * @returns {Storage} a Map-backed stand-in
 */
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}
const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

/** @returns {object} a map stand-in that keeps its event handlers */
function makeMap() {
  const handlers = {};
  return { on: jest.fn((ev, fn) => { handlers[ev] = fn; }), handlers };
}

const mockLayers = L.Control.Layers;

beforeEach(() => { mockRendered.length = 0; mockLayers.mockClear(); });

describe("named overlays", () => {
  it("no named overlay: no control, every layer shown as before", async () => {
    const map = makeMap();
    const svc = new TileLayersService(map, [{ url: "a" }, { url: "b", name: null }], [], {}, {}, {}, memStorage());
    await svc.setup();
    expect(mockLayers).not.toHaveBeenCalled();
    expect(svc.control).toBeNull();
    expect(mockRendered.map((l) => l.shown)).toEqual([true, true]);
  });

  it("a named overlay gets a checkbox, always open, top right", async () => {
    const map = makeMap();
    const svc = new TileLayersService(map, [{ url: "orm", name: "Rail lines", show: true }], [], {}, {}, {}, memStorage());
    await svc.setup();
    expect(mockLayers).toHaveBeenCalledTimes(1);
    const c = mockLayers.mock.instances[0];
    expect(c.base).toBeNull();
    expect(Object.keys(c.overlays)).toEqual(["Rail lines"]);
    expect(c.opts).toEqual({ collapsed: false, position: "topright" });
    expect(c.addTo).toHaveBeenCalledWith(map);
    expect(mockRendered[0].shown).toBe(true);
  });

  it("show: false starts it off, but it is still in the control", async () => {
    const svc = new TileLayersService(makeMap(), [{ url: "orm", name: "Rail lines", show: false }], [], {}, {}, {}, memStorage());
    await svc.setup();
    expect(mockRendered[0].shown).toBe(false);
    expect(Object.keys(mockLayers.mock.instances[0].overlays)).toEqual(["Rail lines"]);
  });

  it("the viewer's stored choice wins over the dashboard's show, both ways", async () => {
    await new TileLayersService(makeMap(), [{ url: "x", name: "Rail lines", show: true }], [], {}, {}, {},
      memStorage({ [OVERLAY_STORAGE_PREFIX + "Rail lines"]: "0" })).setup();
    await new TileLayersService(makeMap(), [{ url: "x", name: "Rail lines", show: false }], [], {}, {}, {},
      memStorage({ [OVERLAY_STORAGE_PREFIX + "Rail lines"]: "1" })).setup();
    expect(mockRendered.map((l) => l.shown)).toEqual([false, true]);
  });

  it("ticking and unticking is remembered, only for named overlays", async () => {
    const map = makeMap();
    const store = memStorage();
    await new TileLayersService(map, [{ url: "x", name: "Rail lines" }], [], {}, {}, {}, store).setup();
    map.handlers.overlayremove({ layer: mockRendered[0] });
    expect(store._m.get(OVERLAY_STORAGE_PREFIX + "Rail lines")).toBe("0");
    map.handlers.overlayadd({ layer: mockRendered[0] });
    expect(store._m.get(OVERLAY_STORAGE_PREFIX + "Rail lines")).toBe("1");
    map.handlers.overlayadd({ layer: { someone: "else" } });
    expect([...store._m.keys()]).toEqual([OVERLAY_STORAGE_PREFIX + "Rail lines"]);
  });

  it("blocked storage: the dashboard's show applies, and nothing throws", async () => {
    const map = makeMap();
    await new TileLayersService(map, [{ url: "x", name: "Rail lines", show: false }], [], {}, {}, {}, throwing).setup();
    expect(mockRendered[0].shown).toBe(false);
    expect(() => map.handlers.overlayadd({ layer: mockRendered[0] })).not.toThrow();
  });
});

describe("storedOverlayChoice", () => {
  it.each([["1", true], ["0", false], [null, null], ["yes", null], ["true", null]])("%p reads as %p", (v, want) => {
    const s = memStorage(v === null ? {} : { [OVERLAY_STORAGE_PREFIX + "R"]: v });
    expect(storedOverlayChoice("R", s)).toBe(want);
  });

  it("no storage at all: null", () => {
    expect(storedOverlayChoice("R", undefined)).toBeNull();
    expect(() => storeOverlayChoice("R", true, undefined)).not.toThrow();
  });
});
