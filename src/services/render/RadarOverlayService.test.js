import { describe, expect, it, jest, beforeEach } from "@jest/globals";

// Backlog 280, 06_MAP_CONTRACT_OVERLAYS.md D13: the weather radar overlay.

jest.mock("leaflet", () => {
  // A minimal evented object.
  const evented = (o) => {
    const h = {};
    o.on = jest.fn((ev, f) => { (h[ev] ??= []).push(f); return o; });
    o.once = jest.fn((ev, f) => { const g = (...a) => { o.off(ev, g); f(...a); }; return o.on(ev, g); });
    o.off = jest.fn((ev, f) => { h[ev] = (h[ev] ?? []).filter((x) => x !== f); return o; });
    o.fire = (ev, ...a) => { for (const f of [...(h[ev] ?? [])]) f(...a); };
    return o;
  };
  class Grid {
    constructor(options) {
      this.options = { ...options };
      evented(this);
      Grid.made.push(this);
    }
    setOpacity(v) { this.options.opacity = v; return this; }
  }
  Grid.made = [];
  return {
    __esModule: true,
    default: {
      _evented: evented,
      _Grid: Grid,
      GridLayer: { extend: jest.fn((proto) => { class G extends Grid {} Object.assign(G.prototype, proto); return G; }) },
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
import RadarOverlayService, {
  parseRadarOption, parseRelay, discoverRelays, orderSources, placeRadarPane, radarGridClass,
  DEFAULT_RADAR, RADAR_NAME, RADAR_PANE, TICK_MS, SWAP_TIMEOUT_MS, FETCH_TIMEOUT_MS,
} from "./RadarOverlayService.js";
import { SOURCES } from "../radar/RadarSources.js";

const NOW = Date.UTC(2026, 9, 6, 7, 30);
const RVJSON = { host: "https://tilecache.rainviewer.com", radar: { past: [{ time: NOW / 1000 - 300, path: "/v2/radar/aaa" }] } };
const GEOCAPS = `<Dimension name="time" default="2026-10-06T07:24:00Z">x</Dimension>`;
const NCCAPS = `<Layer><Name>conus_base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-06T07:26:00Z">x</Dimension></Layer>`;

/**
 * Chicago at z8, as the map would report it.
 * @returns {object} a map stand-in with real DOM panes
 */
function chicagoMap() {
  const z = 8;
  const x = (( -87.63 + 180) / 360) * 256 * 2 ** z;
  const y = ((1 - Math.asinh(Math.tan((41.88 * Math.PI) / 180)) / Math.PI) / 2) * 256 * 2 ** z;
  const mapPane = document.createElement("div");
  const panes = {};
  for (const n of ["tilePane", "overlayPane", "shadowPane", "markerPane"]) {
    panes[n] = document.createElement("div");
    mapPane.appendChild(panes[n]);
  }
  const attr = { add: [], remove: [] };
  const map = L._evented({
    panes, mapPane, zoom: z,
    getPane: jest.fn((n) => panes[n]),
    createPane: jest.fn((n) => { panes[n] = document.createElement("div"); mapPane.appendChild(panes[n]); return panes[n]; }),
    getZoom: () => map.zoom,
    getPixelBounds: () => ({ min: { x: x - 100, y: y - 100 }, max: { x: x + 100, y: y + 100 } }),
    getZoomScale: () => 1,
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

/**
 * A fetch answering by URL.
 * @param {object} [answers] body by URL substring; an Error rejects
 * @returns {Function}
 */
function fetcher(answers = {}) {
  return jest.fn((url) => {
    const key = Object.keys(answers).find((k) => url.includes(k));
    if (!key) return Promise.resolve({ ok: false, status: 404 });
    const body = answers[key];
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(body) });
  });
}

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

/**
 * A service on a Chicago map with fake timers handed in.
 * @param {*} option weather_radar
 * @param {object} answers for fetcher
 * @param {object} [extra] deps to replace
 * @returns {object}
 */
function make(option, answers, extra = {}) {
  const map = chicagoMap();
  const ov = overlays();
  const timers = { intervals: [], timeouts: [] };
  let now = NOW;
  const svc = new RadarOverlayService(map, option, ov, {
    fetch: fetcher(answers),
    now: () => now,
    setInterval: (f, ms) => { timers.intervals.push({ f, ms }); return timers.intervals.length; },
    clearInterval: jest.fn(),
    setTimeout: (f, ms) => { timers.timeouts.push({ f, ms }); return timers.timeouts.length; },
    clearTimeout: jest.fn(),
    ...extra,
  });
  return { svc, map, ov, timers, advance: (ms) => { now += ms; } };
}

const ALL = { "rainviewer.com": RVJSON, "geo.weather.gc.ca": GEOCAPS, "nowcoast.noaa.gov": NCCAPS };

// D13's US order (backlog 285) puts RainViewer first at Chicago. The swap and
// fetch mechanics below are tested through GeoMet, so they give the table's
// own order explicitly, which is also how a config turns the US order off.
const TABLE = { sources: ["fmi", "dwd", "jma", "geomet", "nowcoast", "rainviewer"] };

let warn;
beforeEach(() => {
  L._Grid.made.length = 0;
  jest.clearAllMocks();
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("weather_radar option", () => {
  it("absent, true, auto: on, ticked, D13 defaults", () => {
    for (const v of [undefined, null, true, "auto"]) expect(parseRadarOption(v)).toEqual({ ...DEFAULT_RADAR });
    expect(DEFAULT_RADAR.show).toBe(true);
    expect("scheme" in DEFAULT_RADAR).toBe(false);
    expect(DEFAULT_RADAR.opacity).toBe(0.5); // Lee, 2026-10-06, from pictures
  });
  it("false or off: disabled", () => {
    expect(parseRadarOption(false).enabled).toBe(false);
    expect(parseRadarOption("off").enabled).toBe(false);
  });
  it("a mapping overrides opacity, show, sources; rainviewer_scheme is no longer read (backlog 285); bad values ignored", () => {
    expect(parseRadarOption({ opacity: 0.3, show: false, rainviewer_scheme: 4, sources: ["rainviewer", " geomet ", "rainviewer", 3] }))
      .toEqual({ enabled: true, opacity: 0.3, show: false, order: ["rainviewer", "geomet"] });
    expect(parseRadarOption({ opacity: 2, show: "no", rainviewer_scheme: 9 })).toEqual({ ...DEFAULT_RADAR });
    expect(parseRadarOption("weird")).toEqual({ ...DEFAULT_RADAR });
  });
});

describe("relays (D13 'Relays')", () => {
  const good = (over = {}) => ({
    state: "ok",
    attributes: { radar_relay: { id: "knmi", tiles: "/api/x/{z}/{x}/{y}.png", time: "2026-10-06T07:25:00Z", bounds: [3, 50, 8, 54], max_native_zoom: 10, attribution: "KNMI <b>", ...over } },
  });
  it("parses a good relay into a source with its frame, credit escaped", () => {
    const r = parseRelay(good());
    expect(r).toMatchObject({ id: "relay:knmi", kind: "relay", boxes: [{ w: 3, e: 8, s: 50, n: 54 }], maxNativeZoom: 10, credit: "KNMI &lt;b&gt;" });
    expect(r.relayFrame).toEqual({ key: "2026-10-06T07:25:00Z", time: Date.UTC(2026, 9, 6, 7, 25) });
  });
  it("refuses a malformed relay field by field", () => {
    for (const over of [
      { id: "Bad Id" }, { tiles: "https://x/{z}/{x}/{y}" }, { tiles: "//x/{z}/{x}/{y}" }, { tiles: "/x/{z}/{x}" },
      { time: "yesterday" }, { time: undefined }, { bounds: [3, 50, 8] }, { bounds: [8, 50, 3, 54] }, { bounds: [3, 54, 8, 50] },
      { bounds: [3, 50, 3, 54] }, { bounds: [3, 50, 8, 50] },
      { bounds: [-200, 50, 8, 54] }, { max_native_zoom: 3.5 }, { max_native_zoom: 30 },
    ]) expect(parseRelay(good(over))).toBeNull();
    expect(parseRelay({ state: "unavailable", attributes: good().attributes })).toBeNull();
    expect(parseRelay({ state: "ok", attributes: { radar_relay: [] } })).toBeNull();
  });
  it("discovers by attribute shape, reports malformed, ignores unavailable, one per id", () => {
    const states = {
      "sensor.a": good(),
      "sensor.b": good({ id: "knmi" }),
      "sensor.c": good({ id: "BAD" }),
      "sensor.d": { state: "unavailable", attributes: good().attributes },
      "sensor.e": { state: "1", attributes: {} },
    };
    const { relays, malformed } = discoverRelays(states);
    expect(relays.map((r) => r.id)).toEqual(["relay:knmi"]);
    expect(malformed).toEqual(["sensor.c"]);
  });
  it("orders relays before every built-in; a sources list filters and reorders both", () => {
    const relay = parseRelay(good());
    expect(orderSources([relay], null).map((s) => s.id)).toEqual(["relay:knmi", ...SOURCES.map((s) => s.id)]);
    expect(orderSources([relay], ["rainviewer", "knmi", "nope"]).map((s) => s.id)).toEqual(["rainviewer", "relay:knmi"]);
  });
  it("in a sources list, nowcoast means its five regional layers; one named alone is just that one", () => {
    expect(orderSources([], ["nowcoast", "rainviewer"]).map((s) => s.id))
      .toEqual(["nowcoast_conus", "nowcoast_alaska", "nowcoast_hawaii", "nowcoast_caribbean", "nowcoast_guam", "rainviewer"]);
    expect(orderSources([], ["nowcoast_guam", "nowcoast"]).map((s) => s.id)[0]).toBe("nowcoast_guam");
    expect(orderSources([], ["nowcoast_guam", "nowcoast"]).map((s) => s.id)).toHaveLength(5);
  });
});

describe("the pane (D13 'Drawing' 1)", () => {
  it("sits right after the tile pane, before the overlay and marker panes, ignoring pointer events", () => {
    const map = chicagoMap();
    const pane = placeRadarPane(map);
    const order = [...map.mapPane.children];
    expect(order.indexOf(pane)).toBe(order.indexOf(map.panes.tilePane) + 1);
    expect(order.indexOf(pane)).toBeLessThan(order.indexOf(map.panes.overlayPane));
    expect(order.indexOf(pane)).toBeLessThan(order.indexOf(map.panes.markerPane));
    expect(pane.style.pointerEvents).toBe("none");
    expect(map.panes.tilePane.contains(pane)).toBe(false);
  });
  it("reuses the pane on a second call", () => {
    const map = chicagoMap();
    const a = placeRadarPane(map);
    expect(placeRadarPane(map)).toBe(a);
    expect(map.createPane).toHaveBeenCalledTimes(1);
  });
});

describe("the checkbox", () => {
  it("one overlay named Weather radar, ticked by default", () => {
    const { svc, ov } = make(undefined, ALL);
    svc.setup();
    expect(ov.addOverlay).toHaveBeenCalledTimes(1);
    expect(ov.addOverlay.mock.calls[0][1]).toBe(RADAR_NAME);
    expect(ov.addOverlay.mock.calls[0][2]).toBe(true);
  });
  it("weather_radar: false - no checkbox, no fetch, no pane", () => {
    const { svc, ov, map } = make(false, ALL);
    svc.setup();
    svc.render({ states: {} });
    expect(ov.addOverlay).not.toHaveBeenCalled();
    expect(svc.fetch).not.toHaveBeenCalled();
    expect(map.createPane).not.toHaveBeenCalled();
  });
  it("show: false - checkbox unticked, nothing fetched until ticked", async () => {
    const { svc, ov } = make({ show: false }, ALL);
    svc.setup();
    expect(ov.addOverlay.mock.calls[0][2]).toBe(false);
    await flush();
    expect(svc.fetch).not.toHaveBeenCalled();
    const group = ov.addOverlay.mock.calls[0][0];
    group.onMap = true;
    group.fire("add");
    await flush();
    expect(svc.fetch).toHaveBeenCalled();
  });
});

describe("frames (D13 'Frames')", () => {
  it("fetches only the lists the view needs: Chicago wants GeoMet, nowCOAST, RainViewer; never FMI/DWD/JMA", async () => {
    const { svc } = make(undefined, ALL);
    svc.setup();
    await flush();
    const urls = svc.fetch.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes("geo.weather.gc.ca"))).toBe(true);
    expect(urls.some((u) => u.includes("rainviewer.com"))).toBe(true);
    expect(urls.some((u) => u.includes("jma.go.jp") || u.includes("fmi.fi") || u.includes("dwd.de"))).toBe(false);
  });
  it("nowCOAST's five regions are read from ONE capabilities fetch, each region keeping its own frame", async () => {
    const two = `${NCCAPS}<Layer><Name>alaska_base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-06T07:27:00Z">x</Dimension></Layer>`;
    const { svc } = make(undefined, { ...ALL, "nowcoast.noaa.gov": two });
    svc.setup();
    await flush();
    expect(svc.fetch.mock.calls.filter((c) => c[0].includes("nowcoast.noaa.gov"))).toHaveLength(1);
    expect(svc.frames.get("nowcoast_conus").key).toBe("2026-10-06T07:26:00Z");
    expect(svc.frames.get("nowcoast_alaska").key).toBe("2026-10-06T07:27:00Z");
    expect(svc.frames.has("nowcoast_guam")).toBe(false);
  });
  it("US by default: Chicago draws RainViewer, with GeoMet then nowCOAST CONUS as tile backups (D13)", async () => {
    const { svc, map } = make(undefined, ALL);
    svc.setup();
    await flush();
    const p = svc.layer.options.plan({ z: 8, x: 65, y: 95 });
    expect(p.source.id).toBe("rainviewer");
    expect(p.fallbacks.map((f) => f.source.id)).toEqual(["geomet", "nowcoast_conus"]);
    expect(map.attributionControl.addAttribution).toHaveBeenCalledWith(SOURCES.find((s) => s.id === "rainviewer").credit);
    expect(map.attributionControl.addAttribution).not.toHaveBeenCalledWith(SOURCES.find((s) => s.id === "geomet").credit);
  });
  it("a nowCOAST answer with no regional layer is a failed list: warned once, its tiles fall through", async () => {
    const { svc } = make(TABLE, { ...ALL, "nowcoast.noaa.gov": `<Dimension name="time" default="2026-10-06T07:26:00Z">x</Dimension>`, "geo.weather.gc.ca": new Error("x") });
    svc.setup();
    await flush();
    expect(warn.mock.calls.filter((c) => String(c.join(" ")).includes("nowcoast frame list not read (no regional frame in the answer)")).length).toBe(1);
    expect(svc.layer.options.plan({ z: 8, x: 65, y: 95 }).source.id).toBe("rainviewer");
  });
  it("US: RainViewer's list failing hands every tile to GeoMet (backups take over)", async () => {
    const { svc } = make(undefined, { ...ALL, "rainviewer.com": new Error("down") });
    svc.setup();
    await flush();
    expect(svc.layer.options.plan({ z: 8, x: 65, y: 95 }).source.id).toBe("geomet");
    expect(warn.mock.calls.filter((c) => String(c.join(" ")).includes("rainviewer frame list not read")).length).toBe(1);
  });
  it("US: a tile that fell to a backup credits that backup while its layer shows", async () => {
    const { svc, map } = make(undefined, ALL);
    svc.setup();
    await flush();
    const geo = SOURCES.find((s) => s.id === "geomet").credit;
    svc.layer.options.onFallback("geomet");
    expect(map.attributionControl.addAttribution).toHaveBeenCalledWith(geo);
    expect(svc.fellTo.has("geomet")).toBe(true);
    svc.layer.options.onFallback("geomet");
    expect(map.attributionControl.addAttribution.mock.calls.filter((c) => c[0] === geo)).toHaveLength(1);
  });
  it("once GeoMet is usable, a later tick fetches neither nowCOAST nor RainViewer again", async () => {
    const { svc, timers, advance } = make(TABLE, ALL);
    svc.setup();
    await flush();
    const before = svc.fetch.mock.calls.length;
    advance(7 * 60 * 1000);
    timers.intervals[0].f();
    await flush();
    const later = svc.fetch.mock.calls.slice(before).map((c) => c[0]);
    expect(later.every((u) => u.includes("geo.weather.gc.ca"))).toBe(true);
    expect(later).toHaveLength(1);
  });
  it("does not refetch before the source's interval", async () => {
    const { svc, timers, advance } = make(undefined, ALL);
    svc.setup();
    await flush();
    const before = svc.fetch.mock.calls.length;
    advance(TICK_MS);
    timers.intervals[0].f();
    await flush();
    expect(svc.fetch.mock.calls.length).toBe(before);
    expect(timers.intervals[0].ms).toBe(TICK_MS);
  });
  it("a failed list warns once and never throws; tiles fall to the next source", async () => {
    const { svc, timers, advance } = make(TABLE, { "rainviewer.com": RVJSON, "nowcoast.noaa.gov": NCCAPS, "geo.weather.gc.ca": new Error("boom") });
    svc.setup();
    await flush();
    advance(7 * 60 * 1000);
    timers.intervals[0].f();
    await flush();
    expect(warn.mock.calls.filter((c) => String(c.join(" ")).includes("geomet frame list")).length).toBe(1);
    // The newest layer (pending until its tiles load) carries the newest frames.
    const layer = L._Grid.made[L._Grid.made.length - 1];
    expect(layer.options.plan({ z: 8, x: 65, y: 95 }).source.id).toBe("nowcoast_conus");
    expect(svc.fetch.mock.calls.filter((c) => c[0].includes("geo.weather.gc.ca")).length).toBe(2);
  });
});

/**
 * Setup, first frames in, then a NEW GeoMet frame on the next turn: one swap pending.
 * @param {*} [option] weather_radar
 * @returns {Promise<object>}
 */
async function toSwap(option) {
  const answers = { ...ALL };
  const m = make({ ...TABLE, ...(option ?? {}) }, answers);
  m.svc.setup();
  await flush();
  const first = m.svc.layer;
  answers["geo.weather.gc.ca"] = `<Dimension name="time" default="2026-10-06T07:30:00Z">x</Dimension>`;
  m.advance(7 * 60 * 1000);
  m.timers.intervals[0].f();
  await flush();
  return { ...m, first, next: L._Grid.made[L._Grid.made.length - 1] };
}

describe("the frame swap (D13: never a blank)", () => {
  it("no layer while a frame list is on its way; the first goes straight on when they settle", async () => {
    const { svc } = make({ ...TABLE, opacity: 0.5 }, ALL);
    svc.setup();
    expect(L._Grid.made).toHaveLength(0);
    await flush();
    expect(L._Grid.made).toHaveLength(1);
    expect(svc.layer.options.opacity).toBe(0.5);
    expect(svc.layer.options.pane).toBe(RADAR_PANE);
    expect(svc.layer.options.plan({ z: 8, x: 65, y: 95 }).source.id).toBe("geomet");
  });
  it("a list that never answers is given up on after the timeout, warned once, and the layer follows", async () => {
    const hang = (url, init) => (url.includes("nowcoast")
      ? new Promise((res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))
      : fetcher(ALL)(url));
    const { svc, timers } = make(undefined, ALL, { fetch: jest.fn(hang) });
    svc.setup();
    await flush();
    expect(L._Grid.made).toHaveLength(0);
    for (const t of timers.timeouts.filter((x) => x.ms === FETCH_TIMEOUT_MS)) t.f();
    await flush();
    expect(L._Grid.made).toHaveLength(1);
    expect(warn.mock.calls.filter((c) => String(c.join(" ")).includes("nowcoast frame list not read (no answer in 20 s)")).length).toBe(1);
  });
  it("a new frame loads underneath at 0, shows on load, then the old layer goes", async () => {
    const { svc, first, next } = await toSwap({ opacity: 0.65 });
    expect(next).not.toBe(first);
    expect(next.options.opacity).toBe(0);
    expect(svc.group.layers).toContain(first);
    expect(svc.group.layers).toContain(next);
    next.fire("load");
    expect(next.options.opacity).toBe(0.65);
    expect(svc.layer).toBe(next);
    expect(svc.group.layers).not.toContain(first);
  });
  it("a frame that never finishes loading is shown after the timeout", async () => {
    const { svc, timers, next } = await toSwap();
    const swaps = timers.timeouts.filter((x) => x.ms === SWAP_TIMEOUT_MS);
    expect(swaps).toHaveLength(1);
    swaps[0].f();
    expect(svc.layer).toBe(next);
    expect(next.options.opacity).toBe(DEFAULT_RADAR.opacity);
  });
  it("a swap superseded by a newer one never shows", async () => {
    const answers = { ...ALL };
    const { svc, timers, advance } = make(TABLE, answers);
    svc.setup();
    await flush();
    const first = svc.layer;
    answers["geo.weather.gc.ca"] = `<Dimension name="time" default="2026-10-06T07:30:00Z">x</Dimension>`;
    advance(7 * 60 * 1000);
    timers.intervals[0].f();
    await flush();
    const a = L._Grid.made[L._Grid.made.length - 1];
    answers["geo.weather.gc.ca"] = `<Dimension name="time" default="2026-10-06T07:36:00Z">x</Dimension>`;
    advance(7 * 60 * 1000);
    timers.intervals[0].f();
    await flush();
    const b = L._Grid.made[L._Grid.made.length - 1];
    expect(b).not.toBe(a);
    expect(svc.group.layers).not.toContain(a);
    a.fire("load");
    expect(svc.layer).toBe(first);
    const swaps = timers.timeouts.filter((x) => x.ms === SWAP_TIMEOUT_MS);
    swaps[0].f();
    expect(svc.layer).toBe(first);
    b.fire("load");
    expect(svc.layer).toBe(b);
  });
  it("an off-screen source's new frame does not rebuild (FMI/DWD roll every 5 min; Chicago draws neither)", async () => {
    const { svc, timers, advance } = make(undefined, ALL);
    svc.setup();
    await flush();
    const n = L._Grid.made.length;
    expect(svc.snap.frames.get("fmi").key).toBe("2026-10-06T07:25:00Z");
    advance(5 * 60 * 1000);
    timers.intervals[0].f();
    await flush();
    expect(svc._usableFrames().get("fmi").key).toBe("2026-10-06T07:30:00Z");
    expect(L._Grid.made.length).toBe(n);
  });
  it("no swap when nothing drawn changed", async () => {
    const { svc, timers, advance } = make(undefined, ALL);
    svc.setup();
    await flush();
    L._Grid.made[L._Grid.made.length - 1].fire("load");
    const n = L._Grid.made.length;
    advance(TICK_MS);
    timers.intervals[0].f();
    await flush();
    expect(L._Grid.made.length).toBe(n);
  });
  it("a frame over 30 minutes old drops out: the next layer has no GeoMet", async () => {
    const { svc, timers, advance } = make(undefined, ALL);
    svc.setup();
    await flush();
    L._Grid.made[L._Grid.made.length - 1].fire("load");
    svc.fetch.mockImplementation(() => Promise.reject(new Error("down")));
    advance(31 * 60 * 1000);
    timers.intervals[0].f();
    await flush();
    const latest = L._Grid.made[L._Grid.made.length - 1];
    expect(latest.options.plan({ z: 8, x: 65, y: 95 })).toBeNull();
  });
});

describe("credits (D13 table)", () => {
  it("the credit of every drawing source, and none after the box is unticked", async () => {
    const { svc, map, ov } = make(TABLE, ALL);
    svc.setup();
    await flush();
    const geo = SOURCES.find((s) => s.id === "geomet").credit;
    expect(map.attributionControl.addAttribution).toHaveBeenCalledWith(geo);
    const rv = SOURCES.find((s) => s.id === "rainviewer").credit;
    expect(map.attributionControl.addAttribution).not.toHaveBeenCalledWith(rv);
    ov.addOverlay.mock.calls[0][0].remove();
    expect(map.attributionControl.removeAttribution).toHaveBeenCalledWith(geo);
    expect(svc.on).toBe(false);
  });
  it("RainViewer's credit appears where it draws", async () => {
    const { svc, map } = make({ sources: ["rainviewer"] }, ALL);
    svc.setup();
    await flush();
    expect(map.attributionControl.addAttribution).toHaveBeenCalledWith(SOURCES.find((s) => s.id === "rainviewer").credit);
  });
});

describe("relay tiles are signed (D13)", () => {
  it("asks auth/sign_path once per path and reuses it", async () => {
    const { svc } = make(undefined, {});
    const callWS = jest.fn(() => Promise.resolve({ path: "/api/x/1/2/3.png?authSig=abc" }));
    svc.hass = { callWS };
    expect(await svc._sign("/api/x/1/2/3.png")).toBe("/api/x/1/2/3.png?authSig=abc");
    expect(await svc._sign("/api/x/1/2/3.png")).toBe("/api/x/1/2/3.png?authSig=abc");
    expect(callWS).toHaveBeenCalledTimes(1);
    expect(callWS.mock.calls[0][0]).toMatchObject({ type: "auth/sign_path", path: "/api/x/1/2/3.png" });
  });
  it("no hass: null (the tile stays blank)", async () => {
    const { svc } = make(undefined, {});
    expect(await svc._sign("/p")).toBeNull();
  });
  it("a relay appearing in hass rebuilds the layer with it first", async () => {
    const { svc } = make(undefined, ALL);
    svc.setup();
    await flush();
    const n = L._Grid.made.length;
    svc.render({ states: { "sensor.k": { state: "ok", attributes: { radar_relay: { id: "knmi", tiles: "/api/k/{z}/{x}/{y}.png", time: new Date(NOW - 60000).toISOString(), bounds: [3, 50, 8, 54], max_native_zoom: 10, attribution: "KNMI" } } } } });
    expect(L._Grid.made.length).toBe(n + 1);
    const plan = L._Grid.made[n].options.plan({ z: 8, x: 131, y: 84 });
    expect(plan.relay).toBe(true);
  });
});

describe("tiles (the grid class)", () => {
  const Grid = radarGridClass();
  it("no plan: an empty tile, done once", async () => {
    const g = new Grid({ plan: () => null });
    const done = jest.fn();
    const t = g.createTile({ z: 1, x: 0, y: 0 }, done);
    await flush();
    expect(t.children).toHaveLength(0);
    expect(done).toHaveBeenCalledWith(null, t);
  });
  it("a scaled parent: the image is 4x the tile and offset, no crossOrigin", () => {
    const g = new Grid({ plan: () => ({ url: "https://h/7/1/2.png", relay: false, scale: 4, offX: 1, offY: 2 }) });
    const t = g.createTile({ z: 9, x: 5, y: 10 }, jest.fn());
    const img = t.querySelector("img");
    expect(img.getAttribute("src")).toBe("https://h/7/1/2.png");
    expect(img.style.width).toBe("1024px");
    expect(img.style.left).toBe("-256px");
    expect(img.style.top).toBe("-512px");
    expect(img.hasAttribute("crossorigin")).toBe(false);
    expect(t.style.overflow).toBe("hidden");
  });
  it("US backups: a failed RainViewer image tries GeoMet, then nowCOAST, each placed at its own scale, then blank", () => {
    const onFallback = jest.fn();
    const plan = {
      url: "https://rv/7/1/2.png", relay: false, scale: 2, offX: 1, offY: 0, source: { id: "rainviewer" },
      fallbacks: [
        { url: "https://geo/x", relay: false, scale: 1, offX: 0, offY: 0, source: { id: "geomet" } },
        { url: "https://nc/x", relay: false, scale: 1, offX: 0, offY: 0, source: { id: "nowcoast_conus" } },
      ],
    };
    const g = new Grid({ plan: () => plan, onFallback });
    const done = jest.fn();
    const t = g.createTile({ z: 8, x: 3, y: 4 }, done);
    const img = t.querySelector("img");
    expect(img.style.width).toBe("512px");
    img.onerror();
    expect(img.getAttribute("src")).toBe("https://geo/x");
    expect(img.style.width).toBe("256px");
    expect(img.style.left).toBe("0px");
    expect(onFallback).toHaveBeenLastCalledWith("geomet");
    img.onerror();
    expect(img.getAttribute("src")).toBe("https://nc/x");
    expect(onFallback).toHaveBeenLastCalledWith("nowcoast_conus");
    expect(done).not.toHaveBeenCalled();
    img.onerror();
    expect(t.querySelector("img")).toBeNull();
    expect(done).toHaveBeenCalledTimes(1);
    expect(plan.fallbacks).toHaveLength(2);
  });
  it("a backup that loads finishes the tile once", () => {
    const g = new Grid({ plan: () => ({ url: "https://rv", relay: false, scale: 1, offX: 0, offY: 0, source: { id: "rainviewer" },
      fallbacks: [{ url: "https://geo", relay: false, scale: 1, offX: 0, offY: 0, source: { id: "geomet" } }] }) });
    const done = jest.fn();
    const t = g.createTile({ z: 8, x: 3, y: 4 }, done);
    const img = t.querySelector("img");
    img.onerror();
    img.onload();
    img.onload();
    expect(t.querySelector("img")).not.toBeNull();
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("an image that fails (or is XML) is removed; done once", () => {
    const g = new Grid({ plan: () => ({ url: "https://h/x", relay: false, scale: 1, offX: 0, offY: 0 }) });
    const done = jest.fn();
    const t = g.createTile({ z: 1, x: 0, y: 0 }, done);
    const img = t.querySelector("img");
    img.onerror();
    img.onerror();
    expect(t.querySelector("img")).toBeNull();
    expect(done).toHaveBeenCalledTimes(1);
  });
  it("a relay tile waits for its signed URL; unsigned is blank", async () => {
    const g = new Grid({ plan: () => ({ url: "/api/k/1/2/3.png", relay: true, scale: 1, offX: 0, offY: 0 }), sign: () => Promise.resolve("/api/k/1/2/3.png?authSig=z") });
    const t = g.createTile({ z: 1, x: 0, y: 0 }, jest.fn());
    await flush();
    expect(t.querySelector("img").getAttribute("src")).toBe("/api/k/1/2/3.png?authSig=z");
    const g2 = new Grid({ plan: () => ({ url: "/p", relay: true, scale: 1, offX: 0, offY: 0 }), sign: () => Promise.resolve(null) });
    const done = jest.fn();
    const t2 = g2.createTile({ z: 1, x: 0, y: 0 }, done);
    await flush();
    expect(t2.querySelector("img")).toBeNull();
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("cleanup", () => {
  it("stops the timer, drops the checkbox and the pane", async () => {
    const { svc, ov, map } = make(undefined, ALL);
    svc.setup();
    await flush();
    svc.cleanup();
    expect(svc.clearInterval).toHaveBeenCalled();
    expect(ov.removeOverlay).toHaveBeenCalledWith(svc.group);
    expect(map.mapPane.contains(map.panes[RADAR_PANE])).toBe(false);
    expect(map.off).toHaveBeenCalledWith("moveend", expect.any(Function));
    svc.render({ states: {} });
    expect(svc.disposed).toBe(true);
  });
});
