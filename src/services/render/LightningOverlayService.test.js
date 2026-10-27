import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// Live Track Weather item 304, 06_MAP_CONTRACT_OVERLAYS.md D14: the lightning overlay.

jest.mock("leaflet", () => {
  const evented = (o) => {
    const h = {};
    o.on = jest.fn((ev, f) => { (h[ev] ??= []).push(f); return o; });
    o.once = jest.fn((ev, f) => { const g = (...a) => { o.off(ev, g); f(...a); }; return o.on(ev, g); });
    o.off = jest.fn((ev, f) => { h[ev] = (h[ev] ?? []).filter((x) => x !== f); return o; });
    o.fire = (ev, ...a) => { for (const f of [...(h[ev] ?? [])]) f(...a); };
    return o;
  };
  const made = [];
  return {
    __esModule: true,
    default: {
      _evented: evented,
      _made: made,
      latLngBounds: jest.fn((sw, ne) => ({ sw, ne })),
      tileLayer: {
        wms: jest.fn((url, options) => {
          const l = evented({ url, options: { ...options } });
          l.setOpacity = jest.fn((v) => { l.options.opacity = v; return l; });
          made.push(l);
          return l;
        }),
      },
      layerGroup: jest.fn(() => {
        const g = evented({ layers: [], onMap: false });
        g.addLayer = jest.fn((l) => { g.layers.push(l); return g; });
        g.removeLayer = jest.fn((l) => { g.layers = g.layers.filter((x) => x !== l); return g; });
        g.remove = jest.fn(() => { if (g.onMap) { g.onMap = false; g.fire("remove"); } return g; });
        return g;
      }),
    },
  };
});

import L from "leaflet";
import LightningOverlayService, {
  parseLightningOption, parseLightningCaps, lightningFresh, viewCovered, placeLightningPane, lightningLayer,
  DEFAULT_LIGHTNING, LIGHTNING_NAME, LIGHTNING_PANE, LIGHTNING_CAPS, LIGHTNING_WMS, LIGHTNING_LAYER, LIGHTNING_BOUNDS,
  LIGHTNING_MAX_NATIVE_ZOOM, LIGHTNING_POLL_MS, LIGHTNING_STALE_MS, LIGHTNING_CREDIT, LIGHTNING_OUTLINE,
  TICK_MS, SWAP_TIMEOUT_MS, FETCH_TIMEOUT_MS,
} from "./LightningOverlayService.js";
import { RADAR_PANE } from "./RadarOverlayService.js";

const NOW = Date.UTC(2026, 9, 27, 6, 50);
/**
 * The shape of nowCOAST's answer, measured 2026-10-27 (bin\ltw304\caps.xml).
 * @param {string} t the newest frame
 * @returns {string}
 */
const caps = (t) => `<WMS_Capabilities><Capability><Layer><Name>other</Name>`
  + `<Dimension name="time" default="2020-01-01T00:00:00Z">x</Dimension></Layer>`
  + `<Layer queryable="1" opaque="0"><Name>${LIGHTNING_LAYER}</Name><Title>Lightning Strike Density Data</Title>`
  + `<Dimension name="time" default="${t}" units="ISO8601" nearestValue="1">2026-10-27T02:15:00.000Z,${t}</Dimension>`
  + `</Layer></Capability></WMS_Capabilities>`;

/**
 * @param {number} [south] the view's south edge
 * @param {number} [north]
 * @returns {object} a map stand-in with real DOM panes
 */
function makeMap(south = 30, north = 50) {
  const mapPane = document.createElement("div");
  const panes = {};
  for (const n of ["tilePane", "overlayPane", "shadowPane", "markerPane"]) {
    panes[n] = document.createElement("div");
    mapPane.appendChild(panes[n]);
  }
  const attr = { add: [], remove: [] };
  const map = L._evented({
    panes, mapPane, south, north,
    getPane: jest.fn((n) => panes[n]),
    createPane: jest.fn((n) => { panes[n] = document.createElement("div"); mapPane.appendChild(panes[n]); return panes[n]; }),
    getBounds: () => ({ getSouth: () => map.south, getNorth: () => map.north }),
    attributionControl: { addAttribution: jest.fn((s) => attr.add.push(s)), removeAttribution: jest.fn((s) => attr.remove.push(s)) },
  });
  map.attr = attr;
  return map;
}

/**
 * A layer control stand-in that adds the group to the map when ticked.
 * @returns {object}
 */
function overlays() {
  return {
    addOverlay: jest.fn((group, name, show) => { if (show) { group.onMap = true; group.fire("add"); } return show; }),
    removeOverlay: jest.fn(),
  };
}

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

/**
 * @param {*} option lightning
 * @param {Function} answer (url) => body string, an Error, or a {status}
 * @param {object} [mapArgs]
 * @returns {object}
 */
function make(option, answer, mapArgs = []) {
  const map = makeMap(...mapArgs);
  const ov = overlays();
  const timers = { intervals: [], timeouts: [] };
  let now = NOW;
  const fetch = jest.fn((url) => {
    const b = answer(url);
    if (b instanceof Error) return Promise.reject(b);
    if (b && typeof b === "object") return Promise.resolve({ ok: false, status: b.status });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(b) });
  });
  const svc = new LightningOverlayService(map, option, ov, {
    fetch,
    now: () => now,
    setInterval: (f, ms) => { timers.intervals.push({ f, ms }); return timers.intervals.length; },
    clearInterval: jest.fn(),
    setTimeout: (f, ms) => { timers.timeouts.push({ f, ms }); return timers.timeouts.length; },
    clearTimeout: jest.fn(),
  });
  return { svc, map, ov, timers, fetch, advance: (ms) => { now += ms; }, tick: () => timers.intervals[0].f() };
}

let warn;
beforeEach(() => {
  L._made.length = 0;
  jest.clearAllMocks();
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("lightning option", () => {
  it("absent, true, auto: offered, ticked, D14 defaults", () => {
    for (const v of [undefined, null, true, "auto"]) expect(parseLightningOption(v)).toEqual({ ...DEFAULT_LIGHTNING });
    expect(DEFAULT_LIGHTNING).toEqual({ enabled: true, opacity: 0.85, show: true, outline: true });
  });
  it("false or off: disabled", () => {
    expect(parseLightningOption(false).enabled).toBe(false);
    expect(parseLightningOption("off").enabled).toBe(false);
  });
  it("a mapping overrides opacity, show, outline; bad values ignored", () => {
    expect(parseLightningOption({ opacity: 0.4, show: false, outline: false })).toEqual({ enabled: true, opacity: 0.4, show: false, outline: false });
    expect(parseLightningOption({ opacity: 1.5, show: "no", outline: 1 })).toEqual({ ...DEFAULT_LIGHTNING });
    expect(parseLightningOption({ opacity: -0.1 }).opacity).toBe(0.85);
    expect(parseLightningOption("weird")).toEqual({ ...DEFAULT_LIGHTNING });
  });
});

describe("the frame list", () => {
  it("reads the default time of the lightning layer's own Dimension, not another layer's", () => {
    expect(parseLightningCaps(caps("2026-10-27T06:30:00Z"))).toEqual({ key: "2026-10-27T06:30:00Z", time: Date.UTC(2026, 9, 27, 6, 30) });
  });
  it("null without the layer, without a time Dimension, without a default, or with a bad time", () => {
    expect(parseLightningCaps("<Layer><Name>other</Name><Dimension name=\"time\" default=\"2026-10-27T06:30:00Z\"/></Layer>")).toBeNull();
    expect(parseLightningCaps(`<Layer><Name>${LIGHTNING_LAYER}</Name></Layer><Layer><Dimension name="time" default="2026-10-27T06:30:00Z"/></Layer>`)).toBeNull();
    expect(parseLightningCaps(`<Layer><Name>${LIGHTNING_LAYER}</Name><Dimension name="time">x</Dimension></Layer>`)).toBeNull();
    expect(parseLightningCaps(`<Layer><Name>${LIGHTNING_LAYER}</Name><Dimension name="elevation" default="2026-10-27T06:30:00Z"/></Layer>`)).toBeNull();
    expect(parseLightningCaps(caps("yesterday"))).toBeNull();
    expect(parseLightningCaps(undefined)).toBeNull();
  });
  it("a frame is fresh for 45 minutes, not a moment longer", () => {
    const f = { time: NOW };
    expect(LIGHTNING_STALE_MS).toBe(45 * 60 * 1000);
    expect(lightningFresh(f, NOW + LIGHTNING_STALE_MS)).toBe(true);
    expect(lightningFresh(f, NOW + LIGHTNING_STALE_MS + 1)).toBe(false);
    expect(lightningFresh(null, NOW)).toBe(false);
    expect(lightningFresh({ time: NaN }, NOW)).toBe(false);
  });
});

describe("coverage", () => {
  it("is 25 S to 80 N, all longitudes; a view counts when it overlaps that band", () => {
    expect(LIGHTNING_BOUNDS).toEqual({ w: -180, e: 180, s: -25, n: 80 });
    const b = (s, n) => ({ getSouth: () => s, getNorth: () => n });
    expect(viewCovered(b(40, 45))).toBe(true);
    expect(viewCovered(b(-40, -20))).toBe(true);
    expect(viewCovered(b(-60, -25))).toBe(false);
    expect(viewCovered(b(80, 85))).toBe(false);
    expect(viewCovered(b(79, 85))).toBe(true);
    expect(viewCovered(null)).toBe(false);
  });
});

describe("the pane (D14 'Drawing')", () => {
  it("sits right after the radar pane, before the overlay and marker panes, with the outline", () => {
    const map = makeMap();
    const radar = map.createPane(RADAR_PANE);
    map.panes.tilePane.parentNode.insertBefore(radar, map.panes.tilePane.nextSibling);
    const pane = placeLightningPane(map, true);
    const order = [...map.mapPane.children];
    expect(order.indexOf(pane)).toBe(order.indexOf(radar) + 1);
    expect(order.indexOf(pane)).toBeLessThan(order.indexOf(map.panes.overlayPane));
    expect(order.indexOf(pane)).toBeLessThan(order.indexOf(map.panes.markerPane));
    expect(pane.style.pointerEvents).toBe("none");
    expect(pane.style.filter).toBe(LIGHTNING_OUTLINE);
  });
  it("right after the tile pane when there is no radar; no filter when outline is off", () => {
    const map = makeMap();
    const pane = placeLightningPane(map, false);
    const order = [...map.mapPane.children];
    expect(order.indexOf(pane)).toBe(order.indexOf(map.panes.tilePane) + 1);
    expect(pane.style.filter).toBe("");
  });
  it("reuses the pane on a second call", () => {
    const map = makeMap();
    const a = placeLightningPane(map);
    expect(placeLightningPane(map)).toBe(a);
    expect(map.createPane).toHaveBeenCalledTimes(1);
  });
});

describe("the layer", () => {
  it("nowCOAST's WMS, its one layer, the frame in every request, at most z8, only inside the band", () => {
    const l = lightningLayer("2026-10-27T06:30:00Z", 0.85);
    expect(l.url).toBe(LIGHTNING_WMS);
    expect(l.options).toMatchObject({
      layers: LIGHTNING_LAYER, styles: "", format: "image/png", transparent: true, version: "1.3.0",
      time: "2026-10-27T06:30:00Z", pane: LIGHTNING_PANE, opacity: 0.85, maxNativeZoom: 8,
    });
    expect(LIGHTNING_MAX_NATIVE_ZOOM).toBe(8);
    expect(L.latLngBounds).toHaveBeenCalledWith([-25, -180], [80, 180]);
  });
});

describe("the checkbox", () => {
  it("one, Lightning, ticked by default", () => {
    const { svc, ov } = make(undefined, () => caps("2026-10-27T06:30:00Z"));
    svc.setup();
    expect(ov.addOverlay).toHaveBeenCalledTimes(1);
    expect(ov.addOverlay.mock.calls[0][1]).toBe(LIGHTNING_NAME);
    expect(ov.addOverlay.mock.calls[0][2]).toBe(true);
  });
  it("lightning: false - no checkbox, no fetch, no pane", () => {
    const { svc, ov, fetch, map } = make(false, () => caps("2026-10-27T06:30:00Z"));
    svc.setup();
    expect(ov.addOverlay).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(map.createPane).not.toHaveBeenCalled();
  });
  it("show: false - the checkbox unticked, nothing fetched until it is ticked", async () => {
    const { svc, ov, fetch } = make({ show: false }, () => caps("2026-10-27T06:30:00Z"));
    svc.setup();
    expect(ov.addOverlay.mock.calls[0][2]).toBe(false);
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    const group = ov.addOverlay.mock.calls[0][0];
    group.fire("add");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("frames", () => {
  it("reads the capabilities without the browser cache, then draws the newest frame at the configured opacity", async () => {
    const { svc, fetch } = make({ opacity: 0.7 }, () => caps("2026-10-27T06:30:00Z"));
    svc.setup();
    await flush();
    expect(fetch).toHaveBeenCalledWith(LIGHTNING_CAPS, expect.objectContaining({ cache: "no-cache", credentials: "omit" }));
    expect(L._made).toHaveLength(1);
    expect(L._made[0].options.time).toBe("2026-10-27T06:30:00Z");
    expect(L._made[0].options.opacity).toBe(0.7);
    expect(svc.group.layers).toEqual([L._made[0]]);
  });
  it("reads the list again only after five minutes", async () => {
    const { svc, fetch, advance, tick } = make(undefined, () => caps("2026-10-27T06:30:00Z"));
    svc.setup();
    await flush();
    advance(LIGHTNING_POLL_MS - TICK_MS); tick(); await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(TICK_MS); tick(); await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("a new frame loads unseen and replaces the old one on load: never a blank", async () => {
    let t = "2026-10-27T06:30:00Z";
    const { svc, advance, tick } = make(undefined, () => caps(t));
    svc.setup();
    await flush();
    const old = L._made[0];
    t = "2026-10-27T06:45:00Z";
    advance(LIGHTNING_POLL_MS); tick(); await flush();
    expect(L._made).toHaveLength(2);
    const next = L._made[1];
    expect(next.options.time).toBe(t);
    expect(next.options.opacity).toBe(0);
    expect(svc.group.layers).toEqual([old, next]);
    next.fire("load");
    expect(next.options.opacity).toBe(0.85);
    expect(svc.group.layers).toEqual([next]);
    expect(svc.layer).toBe(next);
  });
  it("a new frame whose tiles never load is shown after the swap timeout", async () => {
    let t = "2026-10-27T06:30:00Z";
    const { svc, timers, advance, tick } = make(undefined, () => caps(t));
    svc.setup();
    await flush();
    t = "2026-10-27T06:45:00Z";
    advance(LIGHTNING_POLL_MS); tick(); await flush();
    const swap = timers.timeouts.find((x) => x.ms === SWAP_TIMEOUT_MS);
    expect(swap).toBeDefined();
    swap.f();
    expect(svc.layer).toBe(L._made[1]);
    expect(svc.group.layers).toEqual([L._made[1]]);
  });
  it("the same frame again builds nothing", async () => {
    const { svc, advance, tick } = make(undefined, () => caps("2026-10-27T06:30:00Z"));
    svc.setup();
    await flush();
    advance(LIGHTNING_POLL_MS); tick(); await flush();
    expect(L._made).toHaveLength(1);
  });
  it("an older answer never replaces a newer frame", async () => {
    let t = "2026-10-27T06:45:00Z";
    const { svc, advance, tick } = make(undefined, () => caps(t));
    svc.setup();
    await flush();
    t = "2026-10-27T06:30:00Z";
    advance(LIGHTNING_POLL_MS); tick(); await flush();
    expect(svc.frame.key).toBe("2026-10-27T06:45:00Z");
    expect(L._made).toHaveLength(1);
  });
  it("a failed read keeps the frame drawn and warns once", async () => {
    let fail = false;
    const { svc, advance, tick } = make(undefined, () => (fail ? { status: 503 } : caps("2026-10-27T06:30:00Z")));
    svc.setup();
    await flush();
    fail = true;
    advance(LIGHTNING_POLL_MS); tick(); await flush();
    advance(LIGHTNING_POLL_MS); tick(); await flush();
    expect(svc.layer).toBe(L._made[0]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).toContain("frame list not read");
  });
  it("a list that never answers is given up on after the fetch timeout", async () => {
    const { svc, timers } = make(undefined, () => caps("2026-10-27T06:30:00Z"));
    svc.fetch = jest.fn(() => new Promise(() => {}));
    svc.setup();
    expect(timers.timeouts.some((x) => x.ms === FETCH_TIMEOUT_MS)).toBe(true);
  });
  it("stale after 45 minutes with no newer frame: nothing drawn, one warning", async () => {
    const { svc, advance, tick } = make(undefined, () => caps("2026-10-27T06:30:00Z"));
    svc.setup();
    await flush();
    expect(svc.layer).not.toBeNull();
    advance(LIGHTNING_STALE_MS - 20 * 60 * 1000 + 1); tick(); await flush();
    expect(svc.layer).toBeNull();
    expect(svc.group.layers).toEqual([]);
    advance(LIGHTNING_POLL_MS); tick(); await flush();
    expect(warn.mock.calls.filter((c) => String(c).includes("over 45 minutes")).length).toBe(1);
  });
  it("an already stale answer never draws", async () => {
    const { svc } = make(undefined, () => caps("2026-10-27T05:30:00Z"));
    svc.setup();
    await flush();
    expect(L._made).toHaveLength(0);
    expect(svc.layer).toBeNull();
  });
});

describe("credit (D14 'Credit')", () => {
  it("in the attribution line while drawn over the band; gone when unticked", async () => {
    const { svc, map } = make(undefined, () => caps("2026-10-27T06:30:00Z"));
    svc.setup();
    await flush();
    expect(map.attr.add).toEqual([LIGHTNING_CREDIT]);
    svc.group.remove();
    expect(map.attr.remove).toEqual([LIGHTNING_CREDIT]);
    expect(svc.layer).toBeNull();
  });
  it("not while the view lies wholly outside the band; added when the view moves into it", async () => {
    const { svc, map } = make(undefined, () => caps("2026-10-27T06:30:00Z"), [-60, -40]);
    svc.setup();
    await flush();
    expect(map.attr.add).toEqual([]);
    map.south = -30; map.north = -10;
    map.fire("moveend");
    expect(map.attr.add).toEqual([LIGHTNING_CREDIT]);
  });
  it("not before a frame is drawn", async () => {
    const { svc, map } = make(undefined, () => ({ status: 500 }));
    svc.setup();
    await flush();
    expect(map.attr.add).toEqual([]);
  });
});

describe("cleanup", () => {
  it("removes the checkbox, the layer, the pane and the listener; idempotent", async () => {
    const { svc, map, ov } = make(undefined, () => caps("2026-10-27T06:30:00Z"));
    svc.setup();
    await flush();
    const pane = map.panes[LIGHTNING_PANE];
    svc.cleanup();
    svc.cleanup();
    expect(ov.removeOverlay).toHaveBeenCalledTimes(1);
    expect(map.off).toHaveBeenCalledWith("moveend", expect.any(Function));
    expect(pane.parentNode).toBeNull();
    expect(svc.layer).toBeNull();
    svc.setup();
    expect(ov.addOverlay).toHaveBeenCalledTimes(1);
  });
});
