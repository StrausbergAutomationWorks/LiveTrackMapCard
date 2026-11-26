import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// 06_MAP_CONTRACT_OVERLAYS.md D19: the service and its canvas layer. Each test names the rule it pins.

jest.mock("leaflet", () => {
  const popups = [];
  const Layer = {
    extend(proto) {
      /** @param {object} opts the layer's options */
      function C(opts) { this.options = {}; this._handlers = {}; this.initialize(opts); }
      Object.assign(C.prototype, proto, {
        on(ev, fn) { (this._handlers[ev] ??= []).push(fn); return this; },
        fire(ev) { (this._handlers[ev] ?? []).forEach((f) => f()); return this; },
        addTo(map) { this._map = map; this.onAdd(map); this.fire("add"); return this; },
        remove() { if (this._map) this.onRemove(this._map); this._map = null; return this; },
      });
      return C;
    },
  };
  return {
    __esModule: true,
    default: {
      Layer,
      setOptions: (obj, o) => Object.assign(obj.options, o),
      DomUtil: { setPosition: jest.fn((el, p) => { el._pos = p; }) },
      point: (x, y) => ({ x, y }),
      popup: jest.fn((opts) => {
        const p = { opts, setLatLng: jest.fn(() => p), setContent: jest.fn(() => p), openOn: jest.fn(() => p) };
        popups.push(p);
        return p;
      }),
      _popups: popups,
    },
  };
});

import L from "leaflet";
import PointLayersService, { PointCanvasLayer, pointsPane, POINTS_PANE, POINT_RETRY_MS, PAD, dotSprite } from "./PointLayersRenderService.js";

const URL1 = "/api/live_track_weather/points/fires/aaaaaaaaaaaa";
const URL2 = "/api/live_track_weather/points/fires/bbbbbbbbbbbb";
const STYLES = { fire: { color: "#FF3D00", label: "Fire detected", radius: 3 } };
const FILE = { meta: {}, columns: [{ key: "t", label: "Detected" }], points: [[0, 0, "fire", "t0"], [1, 1, "fire", "t1"]] };
const pub = (over = {}) => ({ state: "2", attributes: { friendly_name: "Fire detections", points_url: URL1, point_styles: STYLES, attribution: "NASA FIRMS", ...over } });
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

/**
 * A map stand-in: 200 x 100 px, centred on (0, 0) at a zoom where the world is 1000 px.
 * @returns {object}
 */
function fakeMap() {
  const panes = {};
  const handlers = {};
  const container = document.createElement("div");
  const mapPane = document.createElement("div");
  for (const n of ["tilePane", "overlayPane", "shadowPane", "markerPane", "tooltipPane", "popupPane"]) {
    panes[n] = document.createElement("div");
    mapPane.appendChild(panes[n]);
  }
  return {
    panes,
    handlers,
    container,
    getPane: (n) => panes[n],
    createPane: jest.fn((n) => { panes[n] = document.createElement("div"); mapPane.appendChild(panes[n]); return panes[n]; }),
    mapPane,
    on: jest.fn((ev, fn, ctx) => { for (const e of ev.split(" ")) (handlers[e] ??= []).push([fn, ctx]); }),
    off: jest.fn((ev, fn) => { for (const e of ev.split(" ")) handlers[e] = (handlers[e] ?? []).filter(([f]) => f !== fn); }),
    fire(ev, arg) { (handlers[ev] ?? []).forEach(([f, c]) => f.call(c, arg)); },
    getSize: () => ({ x: 200, y: 100 }),
    containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
    getPixelOrigin: () => ({ x: 400, y: 450 }),
    getZoom: () => 2,
    options: { crs: { scale: () => 1000 } },
    getContainer: () => container,
  };
}

/**
 * A 2D context stand-in that records drawImage calls.
 * @returns {object}
 */
function stubCanvas() {
  const ctx = { drawImage: jest.fn(), setTransform: jest.fn(), scale: jest.fn(), beginPath: jest.fn(), arc: jest.fn(), fill: jest.fn(), stroke: jest.fn() };
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ctx);
  return ctx;
}

/** @returns {object} a layer control stand-in that adds a ticked layer to the map */
function overlays() {
  return {
    addOverlay: jest.fn((layer, name, show) => { if (show) layer.addTo(map); return show; }),
    removeOverlay: jest.fn(),
  };
}

let map;
let warn;
beforeEach(() => {
  jest.restoreAllMocks();
  map = fakeMap();
  L._popups.length = 0;
  L.popup.mockClear();
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

/**
 * @param {object} states
 * @param {Function} [callApi]
 * @returns {object} a hass stand-in
 */
function hassWith(states, callApi = jest.fn(() => Promise.resolve(FILE))) {
  return { states, callApi };
}

describe("rule 10 and the pane", () => {
  it("no publisher: no pane, no checkbox, no fetch, no listener", () => {
    const ov = overlays();
    const svc = new PointLayersService(map, undefined, ov);
    const h = hassWith({ "sensor.x": { state: "1", attributes: {} } });
    svc.render(h);
    expect(ov.addOverlay).not.toHaveBeenCalled();
    expect(map.createPane).not.toHaveBeenCalled();
    expect(h.callApi).not.toHaveBeenCalled();
    expect(map.on).not.toHaveBeenCalled();
  });

  it("the pane: right after the overlay pane, so under markers and popups by DOM order; no pointer events; made once", () => {
    const p = pointsPane(map);
    const order = [...map.mapPane.children];
    expect(order.indexOf(p)).toBe(order.indexOf(map.panes.overlayPane) + 1);
    expect(order.indexOf(p)).toBeLessThan(order.indexOf(map.panes.markerPane));
    expect(order.indexOf(p)).toBeLessThan(order.indexOf(map.panes.popupPane));
    expect(p.style.pointerEvents).toBe("none");
    pointsPane(map);
    expect(map.createPane).toHaveBeenCalledTimes(1);
    expect(map.createPane).toHaveBeenCalledWith(POINTS_PANE);
  });
});

describe("rules 1, 2, 5: discovery, fetch, checkbox", () => {
  it("one checkbox named by friendly_name, on by default; fetched once with the viewer's sign-in", async () => {
    const ctx = stubCanvas();
    const ov = overlays();
    const svc = new PointLayersService(map, undefined, ov);
    const h = hassWith({ "sensor.f": pub() });
    svc.render(h);
    svc.render(h);
    expect(ov.addOverlay).toHaveBeenCalledTimes(1);
    const [layer, name, show] = ov.addOverlay.mock.calls[0];
    expect(name).toBe("Fire detections");
    expect(show).toBe(true);
    expect(layer.options.attribution).toBe("NASA FIRMS");
    expect(h.callApi).toHaveBeenCalledTimes(1);
    expect(h.callApi).toHaveBeenCalledWith("GET", "live_track_weather/points/fires/aaaaaaaaaaaa");
    await flush();
    expect(layer.drawnCount()).toBe(2);
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it("the checkbox leaves the publisher's device name off, and passes the former label (Lee, 2026-11-19)", () => {
    stubCanvas();
    const ov = overlays();
    const h = hassWith({ "sensor.f": pub({ friendly_name: "Live Track Weather Fire detections" }) });
    h.entities = { "sensor.f": { entity_id: "sensor.f", device_id: "d1" } };
    h.devices = { d1: { id: "d1", name: "Live Track Weather" } };
    new PointLayersService(map, undefined, ov).render(h);
    const [, name, show, former] = ov.addOverlay.mock.calls[0];
    expect(name).toBe("Fire detections");
    expect(show).toBe(true);
    expect(former).toBe("Live Track Weather Fire detections");
  });

  it("a new URL fetches again; the same state does not", async () => {
    stubCanvas();
    const svc = new PointLayersService(map, undefined, overlays());
    const h = hassWith({ "sensor.f": pub() });
    svc.render(h);
    await flush();
    svc.render(hassWith({ "sensor.f": h.states["sensor.f"] }, h.callApi));
    expect(h.callApi).toHaveBeenCalledTimes(1);
    svc.render(hassWith({ "sensor.f": pub({ points_url: URL2 }) }, h.callApi));
    expect(h.callApi).toHaveBeenCalledTimes(2);
    expect(h.callApi.mock.calls[1][1]).toBe("live_track_weather/points/fires/bbbbbbbbbbbb");
  });

  it("a named list overrides discovery; show false leaves it unticked; false turns it off", () => {
    stubCanvas();
    const ov = overlays();
    new PointLayersService(map, [{ entity: "sensor.f", name: "Fires", show: false }], ov).render(hassWith({ "sensor.f": pub(), "sensor.g": pub() }));
    expect(ov.addOverlay).toHaveBeenCalledTimes(1);
    expect(ov.addOverlay.mock.calls[0].slice(1)).toEqual(["Fires", false]);
    const ov2 = overlays();
    new PointLayersService(map, false, ov2).render(hassWith({ "sensor.f": pub() }));
    expect(ov2.addOverlay).not.toHaveBeenCalled();
  });

  it("backlog 363: layer_default \"off\" starts the box unticked; a dashboard's show true overrides it", () => {
    stubCanvas();
    const ov = overlays();
    new PointLayersService(map, undefined, ov).render(hassWith({ "sensor.f": pub({ layer_default: "off" }), "sensor.g": pub({ friendly_name: "Sites" }) }));
    expect(Object.fromEntries(ov.addOverlay.mock.calls.map((c) => [c[1], c[2]]))).toEqual({ "Fire detections": false, Sites: true });
    const ov2 = overlays();
    new PointLayersService(map, [{ entity: "sensor.f", show: true }, "sensor.g"], ov2)
      .render(hassWith({ "sensor.f": pub({ layer_default: "off" }), "sensor.g": pub({ friendly_name: "Sites", layer_default: "off" }) }));
    expect(ov2.addOverlay.mock.calls.map((c) => [c[1], c[2]])).toEqual([["Fire detections", true], ["Sites", false]]);
  });

  it("a styles change redraws without a fetch", async () => {
    stubCanvas();
    const ov = overlays();
    const svc = new PointLayersService(map, undefined, ov);
    const h = hassWith({ "sensor.f": pub() });
    svc.render(h);
    await flush();
    const layer = ov.addOverlay.mock.calls[0][0];
    const spy = jest.spyOn(layer, "setData");
    svc.render(hassWith({ "sensor.f": pub({ point_styles: { fire: { color: "#000000", label: "x" } } }) }, h.callApi));
    expect(h.callApi).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1].fire.color).toBe("#000000");
  });
});

describe("one fetch, one draw", () => {
  it("a second render while the file loads does not fetch again", async () => {
    stubCanvas();
    const svc = new PointLayersService(map, undefined, overlays());
    const h = hassWith({ "sensor.f": pub() });
    svc.render(h);
    svc.render(hassWith({ "sensor.f": pub() }, h.callApi));
    svc.render(hassWith({ "sensor.f": pub({ friendly_name: "x" }) }, h.callApi));
    expect(h.callApi).toHaveBeenCalledTimes(1);
    await flush();
    expect(svc.publishers.get("sensor.f").layer.drawnCount()).toBe(2);
  });

  it("a render with the same state object neither fetches nor redraws", async () => {
    stubCanvas();
    const ov = overlays();
    const svc = new PointLayersService(map, undefined, ov);
    const st = pub();
    svc.render(hassWith({ "sensor.f": st }));
    await flush();
    const spy = jest.spyOn(ov.addOverlay.mock.calls[0][0], "setData");
    svc.render(hassWith({ "sensor.f": st }));
    svc.render(hassWith({ "sensor.f": st }));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("rule 6: a failed fetch", () => {
  it("warns once, draws nothing, retries after 10 minutes or on a new URL", async () => {
    stubCanvas();
    let t = 1000;
    const ov = overlays();
    const svc = new PointLayersService(map, undefined, ov, { now: () => t });
    const bad = jest.fn(() => Promise.resolve({ nope: 1 }));
    const st = pub();
    svc.render(hassWith({ "sensor.f": st }, bad));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(ov.addOverlay.mock.calls[0][0].drawnCount()).toBe(0);
    svc.render(hassWith({ "sensor.f": { ...st } }, bad));
    expect(bad).toHaveBeenCalledTimes(1);
    t += POINT_RETRY_MS;
    svc.render(hassWith({ "sensor.f": { ...st } }, bad));
    expect(bad).toHaveBeenCalledTimes(2);
    await flush();
    svc.render(hassWith({ "sensor.f": pub({ points_url: URL2 }) }, bad));
    expect(bad).toHaveBeenCalledTimes(3);
  });

  it("a rejected callApi is a failure, not a throw", async () => {
    stubCanvas();
    const svc = new PointLayersService(map, undefined, overlays());
    svc.render(hassWith({ "sensor.f": pub() }, jest.fn(() => Promise.reject(new Error("401")))));
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("rule 8: unavailable or gone", () => {
  it("discovered: unavailable is no longer a publisher, so its checkbox and layer go, as when it is gone", async () => {
    stubCanvas();
    const ov = overlays();
    const svc = new PointLayersService(map, undefined, ov);
    const h = hassWith({ "sensor.f": pub() });
    svc.render(h);
    await flush();
    const layer = ov.addOverlay.mock.calls[0][0];
    expect(layer.drawnCount()).toBe(2);
    svc.render(hassWith({ "sensor.f": { ...pub(), state: "unavailable" } }, h.callApi));
    expect(layer.drawnCount()).toBe(0);
    svc.render(hassWith({}, h.callApi));
    expect(ov.removeOverlay).toHaveBeenCalledWith(layer);
    expect(layer._canvas).toBeNull();
    expect(map.off).toHaveBeenCalledWith("click", expect.any(Function));
  });

  it("a NAMED publisher gone unavailable keeps its checkbox and clears its dots; back, it fetches again", async () => {
    stubCanvas();
    const ov = overlays();
    const svc = new PointLayersService(map, ["sensor.f"], ov);
    const h = hassWith({ "sensor.f": pub() });
    svc.render(h);
    await flush();
    const layer = ov.addOverlay.mock.calls[0][0];
    expect(layer.drawnCount()).toBe(2);
    svc.render(hassWith({ "sensor.f": { ...pub(), state: "unavailable" } }, h.callApi));
    expect(ov.removeOverlay).not.toHaveBeenCalled();
    expect(layer.drawnCount()).toBe(0);
    svc.render(hassWith({ "sensor.f": pub() }, h.callApi));
    expect(h.callApi).toHaveBeenCalledTimes(2);
    await flush();
    expect(layer.drawnCount()).toBe(2);
  });
});

describe("rule 3: the canvas", () => {
  it("covers the view plus PAD each side and sits at the layer origin", () => {
    stubCanvas();
    const layer = new PointCanvasLayer({});
    layer.addTo(map);
    const cv = layer._canvas;
    expect(cv.parentNode).toBe(map.panes[POINTS_PANE]);
    expect(cv.style.width).toBe(`${200 + 2 * Math.round(200 * PAD)}px`);
    expect(cv._pos).toEqual({ x: -Math.round(200 * PAD), y: -Math.round(100 * PAD) });
  });

  it("hidden while a zoom animates, shown again by the redraw", () => {
    stubCanvas();
    const layer = new PointCanvasLayer({});
    layer.addTo(map);
    map.fire("zoomstart");
    expect(layer._canvas.style.visibility).toBe("hidden");
    map.fire("moveend");
    expect(layer._canvas.style.visibility).toBe("");
  });

  it("draws the points in view, at their container positions", async () => {
    const ctx = stubCanvas();
    const layer = new PointCanvasLayer({});
    layer.addTo(map);
    const { pointsOf } = await import("../../util/PointLayers.js");
    // world 1000 px, origin (400, 450): (0, 0) is container (100, 50); lon 36 is 100 px east; lon 90 is off
    layer.setData(pointsOf({ points: [[0, 0, "fire"], [36, 0, "fire"], [90, 0, "fire"]] }), STYLES);
    expect(layer.drawnCount()).toBe(2);
    const xs = ctx.drawImage.mock.calls.map((c) => c[1] + c[3] / 2 - Math.round(200 * PAD));
    expect(xs[0]).toBeCloseTo(100, 6);
    expect(xs[1]).toBeCloseTo(200, 6);
  });

  it("follows the map pane's offset after a pan (container = layer point - containerPointToLayerPoint(0, 0))", async () => {
    const ctx = stubCanvas();
    map.containerPointToLayerPoint = () => ({ x: -30, y: -20 });
    const layer = new PointCanvasLayer({});
    layer.addTo(map);
    const { pointsOf } = await import("../../util/PointLayers.js");
    layer.setData(pointsOf({ points: [[0, 0, "fire"]] }), STYLES);
    const c = ctx.drawImage.mock.calls[0];
    expect(c[1] + c[3] / 2 - Math.round(200 * PAD)).toBeCloseTo(130, 6);
    expect(c[2] + c[4] / 2 - Math.round(100 * PAD)).toBeCloseTo(70, 6);
    expect(layer._canvas._pos).toEqual({ x: -30 - Math.round(200 * PAD), y: -20 - Math.round(100 * PAD) });
  });
});

describe("rule 4: click and hover", () => {
  it("a click on a dot opens its popup; elsewhere nothing", async () => {
    stubCanvas();
    const svc = new PointLayersService(map, undefined, overlays());
    svc.render(hassWith({ "sensor.f": pub() }));
    await flush();
    map.fire("click", { containerPoint: { x: 160, y: 50 } });
    expect(L.popup).not.toHaveBeenCalled();
    map.fire("click", { containerPoint: { x: 101, y: 51 } });
    expect(L.popup).toHaveBeenCalledTimes(1);
    const p = L._popups[0];
    expect(p.setLatLng).toHaveBeenCalledWith([0, 0]);
    expect(p.setContent.mock.calls[0][0]).toContain("<b>Fire detected</b><br>Detected: t0");
    expect(p.openOn).toHaveBeenCalledWith(map);
  });

  it("openAt: a dot under the point opens its popup and says so; elsewhere, or disposed, false", async () => {
    stubCanvas();
    const svc = new PointLayersService(map, undefined, overlays());
    svc.render(hassWith({ "sensor.f": pub() }));
    await flush();
    expect(svc.openAt({ x: 160, y: 50 })).toBe(false);
    expect(svc.openAt(undefined)).toBe(false);
    expect(L.popup).not.toHaveBeenCalled();
    expect(svc.openAt({ x: 101, y: 51 })).toBe(true);
    expect(L._popups[0].openOn).toHaveBeenCalledWith(map);
    svc.disposed = true;
    expect(svc.openAt({ x: 101, y: 51 })).toBe(false);
    expect(L.popup).toHaveBeenCalledTimes(1);
  });

  it("the topmost publisher answers first (point_order)", async () => {
    stubCanvas();
    const svc = new PointLayersService(map, undefined, overlays());
    const top = { ...FILE, columns: [{ key: "t", label: "Top" }] };
    const callApi = jest.fn((m, path) => Promise.resolve(path.endsWith("cccccccccccc") ? top : FILE));
    svc.render(hassWith({
      "sensor.a": pub({ point_order: 5, points_url: "/api/x/cccccccccccc" }),
      "sensor.b": pub(),
    }, callApi));
    await flush();
    map.fire("click", { containerPoint: { x: 100, y: 50 } });
    expect(L._popups[0].setContent.mock.calls[0][0]).toContain("Top: t0");
    const kids = [...map.panes[POINTS_PANE].children];
    expect(kids[kids.length - 1]).toBe(svc.publishers.get("sensor.a").layer._canvas);
  });

  it("the pointer is a hand over a dot", async () => {
    stubCanvas();
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (f) => f();
    try {
      const svc = new PointLayersService(map, undefined, overlays());
      svc.render(hassWith({ "sensor.f": pub() }));
      await flush();
      map.fire("mousemove", { containerPoint: { x: 100, y: 50 } });
      expect(map.container.style.cursor).toBe("pointer");
      map.fire("mousemove", { containerPoint: { x: 150, y: 90 } });
      expect(map.container.style.cursor).toBe("");
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});

describe("rule 9: weather_area", () => {
  it("only points inside the circle", async () => {
    stubCanvas();
    const ov = overlays();
    const svc = new PointLayersService(map, undefined, ov, { area: { lat: 0, lon: 0, km: 50 } });
    svc.render(hassWith({ "sensor.f": pub() }));
    await flush();
    expect(ov.addOverlay.mock.calls[0][0].drawnCount()).toBe(1);
  });
});

describe("cleanup and sprites", () => {
  it("cleanup removes every layer and the listeners; render after it does nothing", async () => {
    stubCanvas();
    const ov = overlays();
    const svc = new PointLayersService(map, undefined, ov);
    const h = hassWith({ "sensor.f": pub() });
    svc.render(h);
    await flush();
    svc.cleanup();
    expect(ov.removeOverlay).toHaveBeenCalledTimes(1);
    expect(map.off).toHaveBeenCalledWith("mousemove", expect.any(Function));
    svc.render(h);
    expect(h.callApi).toHaveBeenCalledTimes(1);
  });

  it("a sprite: the radius, an outline only when styled; null without a 2D context", () => {
    const ctx = stubCanvas();
    const s = dotSprite({ color: "#FF0000", radius: 3, outline: null }, 2);
    expect(s.width).toBe(16);
    expect(ctx.arc).toHaveBeenCalledWith(4, 4, 3, 0, 2 * Math.PI);
    expect(ctx.stroke).not.toHaveBeenCalled();
    const o = dotSprite({ color: "#FF0000", radius: 3, outline: "#000000" }, 1);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(o.width).toBe(10);
    expect(ctx.arc).toHaveBeenLastCalledWith(5, 5, 3, 0, 2 * Math.PI);
    HTMLCanvasElement.prototype.getContext = () => null;
    expect(dotSprite({ color: "#FF0000", radius: 3, outline: null }, 1)).toBeNull();
  });
});
describe("LiveTrackMapCard#1 finding 2: a point publisher's attribution", () => {
  it("reaches the attribution control escaped", () => {
    stubCanvas();
    const ov = overlays();
    const svc = new PointLayersService(fakeMap(), undefined, ov);
    svc.render(hassWith({ "sensor.f": pub({ attribution: "<img src=x onerror=alert(1)> & 'FIRMS'" }) }));
    const [layer] = ov.addOverlay.mock.calls[0];
    expect(layer.options.attribution).toBe("&lt;img src=x onerror=alert(1)&gt; &amp; &#39;FIRMS&#39;");
  });
});
