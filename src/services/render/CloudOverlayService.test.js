import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";

// Live Track Weather item 307, 06_MAP_CONTRACT_OVERLAYS.md D17: the cloud overlay.

jest.mock("leaflet", () => {
  const evented = (o) => {
    const h = {};
    o.on = jest.fn((ev, f) => { (h[ev] ??= []).push(f); return o; });
    o.once = jest.fn((ev, f) => { const g = (...a) => { o.off(ev, g); f(...a); }; return o.on(ev, g); });
    o.off = jest.fn((ev, f) => { h[ev] = (h[ev] ?? []).filter((x) => x !== f); return o; });
    o.fire = (ev, ...a) => { for (const f of [...(h[ev] ?? [])]) f(...a); };
    return o;
  };
  return {
    __esModule: true,
    default: {
      _evented: evented,
      latLngBounds: jest.fn((sw, ne) => ({ sw, ne })),
      GridLayer: {
        extend: jest.fn((proto) => {
          /**
           * A grid layer stand-in that keeps its options.
           * @param {object} options
           */
          function Grid(options) { this.options = options; }
          Object.assign(Grid.prototype, proto);
          return Grid;
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
import CloudOverlayService, {
  parseCloudsOption, layerFrame, parseCloudCaps, freshFrames, tileBounds, tileSource, tileUrl, recolour, viewCovered,
  placeCloudPane, cloudLayer, pairKey, DEFAULT_CLOUDS, CLOUD_NAME, CLOUD_PANE, CLOUD_CAPS, CLOUD_WMS, GOES_LAYER,
  GLOBAL_LAYER, GOES_BOUNDS, GLOBAL_BOUNDS, CLOUD_MAX_NATIVE_ZOOM, CLOUD_POLL_MS, GOES_STALE_MS, GLOBAL_STALE_MS,
  TICK_MS, SWAP_TIMEOUT_MS, FETCH_TIMEOUT_MS, CLOUD_CREDIT, CLEAR, CLOUDY, MAX_ALPHA, CLOUD_COLOURS,
} from "./CloudOverlayService.js";
import { RADAR_PANE } from "./RadarOverlayService.js";

const NOW = Date.UTC(2026, 9, 28, 19, 32);
const T_GOES = "2026-10-28T19:28:00Z";
const T_GLOBAL = "2026-10-28T18:00:00Z";
/**
 * The shape of nowCOAST's answer, measured 2026-10-28 (bin\ltw307\caps_nowcoast.xml).
 * @param {?string} goes
 * @param {?string} global
 * @returns {string}
 */
const caps = (goes = T_GOES, global = T_GLOBAL) => `<WMS_Capabilities><Capability><Layer><Name>goes_visible_imagery</Name>`
  + `<Dimension name="time" default="2020-01-01T00:00:00Z">x</Dimension></Layer>`
  + (global ? `<Layer queryable="1"><Name>${GLOBAL_LAYER}</Name><Dimension name="time" default="${global}" units="ISO8601">2026-10-28T13:00:00.000Z,${global}</Dimension></Layer>` : "")
  + (goes ? `<Layer queryable="1"><Name>${GOES_LAYER}</Name><Style><Name>goes-lir</Name></Style><Dimension name="time" default="${goes}" units="ISO8601">2026-10-28T12:03:00.000Z,${goes}</Dimension></Layer>` : "")
  + `</Capability></WMS_Capabilities>`;

const frame = (t) => ({ key: t, time: Date.parse(t) });

describe("options and frames", () => {
  it("defaults: offered, unticked, full strength", () => {
    expect(DEFAULT_CLOUDS).toEqual({ enabled: true, opacity: 1, show: false });
    expect(parseCloudsOption(undefined)).toEqual(DEFAULT_CLOUDS);
    expect(parseCloudsOption(true)).toEqual(DEFAULT_CLOUDS);
    expect(parseCloudsOption(false).enabled).toBe(false);
    expect(parseCloudsOption({ opacity: 0.5, show: true })).toEqual({ enabled: true, opacity: 0.5, show: true });
    expect(parseCloudsOption({ opacity: 2, show: "yes" })).toEqual(DEFAULT_CLOUDS);
    expect(parseCloudsOption("nonsense")).toEqual(DEFAULT_CLOUDS);
    expect(CLOUD_NAME).toBe("Clouds");
  });

  it("each layer's own newest frame", () => {
    expect(parseCloudCaps(caps())).toEqual({ goes: frame(T_GOES), global: frame(T_GLOBAL) });
    expect(parseCloudCaps(caps(null, T_GLOBAL))).toEqual({ goes: null, global: frame(T_GLOBAL) });
    expect(layerFrame("<Name>goes_longwave_imagery</Name>", GOES_LAYER)).toBeNull();
    expect(layerFrame(`<Name>${GOES_LAYER}</Name><Dimension name="time" default="nope">`, GOES_LAYER)).toBeNull();
    expect(layerFrame(undefined, GOES_LAYER)).toBeNull();
    expect(CLOUD_CAPS).toBe(`${CLOUD_WMS}?service=WMS&version=1.3.0&request=GetCapabilities`);
  });

  it("GOES stale after 30 minutes, the global mosaic after 3 hours", () => {
    expect(GOES_STALE_MS).toBe(30 * 60 * 1000);
    expect(GLOBAL_STALE_MS).toBe(3 * 3600 * 1000);
    const f = { goes: frame(T_GOES), global: frame(T_GLOBAL) };
    expect(freshFrames(f, NOW)).toEqual(f);
    const g = Date.parse(T_GOES);
    expect(freshFrames(f, g + GOES_STALE_MS).goes).not.toBeNull();
    expect(freshFrames(f, g + GOES_STALE_MS + 1).goes).toBeNull();
    const h = Date.parse(T_GLOBAL);
    expect(freshFrames(f, h + GLOBAL_STALE_MS).global).not.toBeNull();
    expect(freshFrames(f, h + GLOBAL_STALE_MS + 1).global).toBeNull();
    expect(freshFrames(undefined, NOW)).toEqual({ goes: null, global: null });
    expect(pairKey(f)).toBe(`${T_GOES}|${T_GLOBAL}`);
    expect(pairKey({ goes: null, global: f.global })).toBe(`-|${T_GLOBAL}`);
  });
});

describe("tiles", () => {
  it("a tile's box", () => {
    const b = tileBounds({ x: 0, y: 0, z: 0 });
    expect([b.w, b.e]).toEqual([-180, 180]);
    expect(b.n).toBeCloseTo(85.0511, 3);
    expect(b.s).toBeCloseTo(-85.0511, 3);
    const c = tileBounds({ x: 1, y: 1, z: 1 });
    expect([c.w, c.e, c.n]).toEqual([0, 180, 0]);
  });

  it("GOES inside its box, the global mosaic elsewhere and on GOES's edge", () => {
    const fresh = { goes: frame(T_GOES), global: frame(T_GLOBAL) };
    // z6 tile at about 36-40 N, 90-84 W: wholly inside GOES
    expect(tileSource({ z: 6, x: 16, y: 24 }, fresh)).toEqual({ layer: GOES_LAYER, key: T_GOES });
    // z3 tile 0-41 N, 90-45 W: crosses GOES's south and east edges
    expect(tileSource({ z: 3, x: 2, y: 3 }, fresh)).toEqual({ layer: GLOBAL_LAYER, key: T_GLOBAL });
    // Europe
    expect(tileSource({ z: 5, x: 16, y: 10 }, fresh)).toEqual({ layer: GLOBAL_LAYER, key: T_GLOBAL });
    // the edge tile with no fresh global: GOES draws what it has
    expect(tileSource({ z: 3, x: 2, y: 3 }, { goes: fresh.goes, global: null })).toEqual({ layer: GOES_LAYER, key: T_GOES });
    // GOES stale: the global mosaic draws the US too
    expect(tileSource({ z: 6, x: 16, y: 24 }, { goes: null, global: fresh.global })).toEqual({ layer: GLOBAL_LAYER, key: T_GLOBAL });
    // the Arctic, north of both
    expect(tileSource({ z: 4, x: 3, y: 0 }, fresh)).toBeNull();
    expect(tileSource({ z: 6, x: 16, y: 24 }, { goes: null, global: null })).toBeNull();
    expect(GOES_BOUNDS).toEqual({ w: -179.5, e: -50.76, s: 10.92, n: 50.55 });
    expect(GLOBAL_BOUNDS).toEqual({ w: -180, e: 180, s: -72.74, n: 72.74 });
  });

  it("the GetMap for a tile, in Web Mercator, with its frame", () => {
    const u = new URL(tileUrl({ z: 1, x: 0, y: 0 }, { layer: GOES_LAYER, key: T_GOES }));
    expect(`${u.origin}${u.pathname}`).toBe(CLOUD_WMS);
    const p = Object.fromEntries(u.searchParams);
    expect(p).toEqual({ service: "WMS", request: "GetMap", version: "1.3.0", layers: GOES_LAYER, styles: "", crs: "EPSG:3857",
      bbox: "-20037508.342789244,0,0,20037508.342789244", width: "256", height: "256", format: "image/png",
      transparent: "true", time: T_GOES });
    const q = Object.fromEntries(new URL(tileUrl({ z: 2, x: 3, y: 2 }, { layer: GLOBAL_LAYER, key: T_GLOBAL })).searchParams);
    const H = 20037508.342789244;
    q.bbox.split(",").map(Number).forEach((v, i) => expect(v).toBeCloseTo([H / 2, -H / 2, H, 0][i], 4));
  });

  it("recolour: clear sky transparent, cloud by brightness, in the theme's colour", () => {
    // Lee 2026-10-28: lighter and more transparent (it read #5F6B7A and 0.85).
    expect([CLEAR, CLOUDY, MAX_ALPHA]).toEqual([0.36, 0.72, 0.65]);
    expect(CLOUD_COLOURS).toEqual({ light: [0x8a, 0x94, 0xa1], dark: [255, 255, 255] });
    const v = (x) => Math.round(x * 255);
    const d = [
      v(0.3), v(0.3), v(0.3), 255, // clear
      v(0.36), v(0.36), v(0.36), 255, // at the threshold
      v(0.54), v(0.54), v(0.54), 255, // halfway
      255, 255, 255, 255, // cold top
      255, 255, 255, 0, // no data
    ];
    recolour(d, [1, 2, 3]);
    const a = [3, 7, 11, 15, 19].map((i) => d[i]);
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(0);
    expect(a[2]).toBeGreaterThanOrEqual(82);
    expect(a[2]).toBeLessThanOrEqual(85);
    expect(a[3]).toBe(Math.round(255 * 0.65));
    expect(a[4]).toBe(0);
    expect([d[0], d[1], d[2], d[12], d[13], d[14]]).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it("zoom 6 is the native zoom", () => {
    expect(CLOUD_MAX_NATIVE_ZOOM).toBe(6);
  });
});

/**
 * @returns {object} a map stand-in with real DOM panes
 */
function makeMap() {
  const mapPane = document.createElement("div");
  const panes = {};
  for (const n of ["tilePane", "overlayPane", "shadowPane", "markerPane"]) {
    panes[n] = document.createElement("div");
    mapPane.appendChild(panes[n]);
  }
  const attr = { add: [], remove: [] };
  const map = L._evented({
    panes, mapPane, south: 30, north: 50,
    getPane: jest.fn((n) => panes[n]),
    createPane: jest.fn((n) => { panes[n] = document.createElement("div"); mapPane.appendChild(panes[n]); return panes[n]; }),
    getBounds: () => ({ getSouth: () => map.south, getNorth: () => map.north }),
    attributionControl: { addAttribution: jest.fn((s) => attr.add.push(s)), removeAttribution: jest.fn((s) => attr.remove.push(s)) },
  });
  map.attr = attr;
  return map;
}

describe("the pane", () => {
  it("right above the tiles, under the radar", () => {
    const map = makeMap();
    const radar = map.createPane(RADAR_PANE);
    map.panes.tilePane.parentNode.insertBefore(radar, map.panes.tilePane.nextSibling);
    const pane = placeCloudPane(map);
    const order = [...map.mapPane.children];
    expect(order.indexOf(pane)).toBe(order.indexOf(map.panes.tilePane) + 1);
    expect(order.indexOf(radar)).toBe(order.indexOf(pane) + 1);
    expect(pane.style.pointerEvents).toBe("none");
    expect(map.getPane(CLOUD_PANE)).toBe(pane);
    expect(viewCovered({ getSouth: () => 75, getNorth: () => 80 })).toBe(false);
    expect(viewCovered({ getSouth: () => 60, getNorth: () => 80 })).toBe(true);
    expect(viewCovered(null)).toBe(false);
  });
});

describe("the tile layer", () => {
  let images;
  const RealImage = globalThis.Image;
  beforeEach(() => {
    images = [];
    globalThis.Image = class { constructor() { images.push(this); } };
  });
  afterEach(() => { globalThis.Image = RealImage; });

  it("asks nowCOAST for each tile's own picture, cross-origin, and draws an empty tile where there is none", async () => {
    const fresh = { goes: frame(T_GOES), global: frame(T_GLOBAL) };
    const layer = cloudLayer(fresh, () => CLOUD_COLOURS.light, 0.7, jest.fn());
    expect(layer.options).toMatchObject({ pane: CLOUD_PANE, maxNativeZoom: 6, opacity: 0.7, tileSize: 256 });
    const done = jest.fn();
    const c = layer.createTile({ z: 6, x: 16, y: 24 }, done);
    expect(c.tagName).toBe("CANVAS");
    expect(images).toHaveLength(1);
    expect(images[0].crossOrigin).toBe("anonymous");
    expect(images[0].src).toBe(tileUrl({ z: 6, x: 16, y: 24 }, { layer: GOES_LAYER, key: T_GOES }));
    images[0].onerror();
    expect(done).toHaveBeenCalledWith(expect.any(Error), c);
    const done2 = jest.fn();
    layer.createTile({ z: 4, x: 3, y: 0 }, done2);
    expect(images).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(done2).toHaveBeenCalledWith(null, expect.anything());
  });
});

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

/**
 * @param {*} option clouds
 * @param {Function} answer (url) => body string, an Error, or a {status}
 * @returns {object}
 */
function make(option, answer) {
  const map = makeMap();
  const ov = { addOverlay: jest.fn((group, name, show) => { if (show) { group.onMap = true; group.fire("add"); } return show; }), removeOverlay: jest.fn() };
  let now = NOW;
  let dark = false;
  const made = [];
  const fetch = jest.fn((url) => {
    const b = answer(url);
    if (b instanceof Error) return Promise.reject(b);
    if (b && typeof b === "object") return Promise.resolve({ ok: false, status: b.status, text: () => Promise.resolve("") });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(b) });
  });
  const timeouts = [];
  const svc = new CloudOverlayService(map, option, ov, () => dark, {
    fetch,
    now: () => now,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (f, ms) => { timeouts.push({ f, ms }); return timeouts.length; },
    clearTimeout: () => {},
    layer: (fresh, colour, opacity, onError) => {
      const l = L._evented({ fresh, colour, opacity, onError, redraw: jest.fn() });
      l.setOpacity = jest.fn((v) => { l.opacity = v; return l; });
      made.push(l);
      return l;
    },
  });
  return { svc, map, ov, fetch, made, timeouts, tick: (ms) => { now += ms; svc._refresh(); }, setDark: (v) => { dark = v; } };
}

describe("the service", () => {
  it("unticked by default: a checkbox and nothing fetched", () => {
    const t = make(undefined, () => caps());
    t.svc.setup();
    expect(t.ov.addOverlay).toHaveBeenCalledWith(t.svc.group, "Clouds", false);
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.map.getPane(CLOUD_PANE)).toBeTruthy();
  });

  it("false: no checkbox, no pane, no fetch", () => {
    const t = make(false, () => caps());
    t.svc.setup();
    expect(t.ov.addOverlay).not.toHaveBeenCalled();
    expect(t.map.panes[CLOUD_PANE]).toBeUndefined();
  });

  it("ticked: reads the frames with no-cache and draws both, with the credit", async () => {
    const t = make({ show: true }, () => caps());
    t.svc.setup();
    await flush();
    expect(t.fetch).toHaveBeenCalledWith(CLOUD_CAPS, expect.objectContaining({ cache: "no-cache", credentials: "omit" }));
    expect(t.made).toHaveLength(1);
    expect(t.made[0].fresh).toEqual({ goes: frame(T_GOES), global: frame(T_GLOBAL) });
    expect(t.made[0].opacity).toBe(1);
    expect(t.made[0].colour()).toEqual(CLOUD_COLOURS.light);
    expect(t.svc.group.layers).toEqual([t.made[0]]);
    expect(t.map.attr.add).toEqual([CLOUD_CREDIT]);
  });

  it("a new GOES frame loads hidden and replaces the old on load; read again only after the poll interval", async () => {
    let goes = T_GOES;
    const t = make({ show: true }, () => caps(goes));
    t.svc.setup();
    await flush();
    goes = "2026-10-28T19:33:00Z";
    t.tick(CLOUD_POLL_MS - 1000);
    await flush();
    expect(t.fetch).toHaveBeenCalledTimes(1);
    t.tick(1000);
    await flush();
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.made).toHaveLength(2);
    expect(t.made[1].opacity).toBe(0);
    expect(t.svc.group.layers).toHaveLength(2);
    t.made[1].fire("load");
    expect(t.made[1].setOpacity).toHaveBeenCalledWith(1);
    expect(t.svc.group.layers).toEqual([t.made[1]]);
    expect(t.timeouts.some((x) => x.ms === SWAP_TIMEOUT_MS)).toBe(true);
  });

  it("GOES stale: the global mosaic alone; both stale: nothing drawn", async () => {
    const t = make({ show: true }, () => caps());
    t.svc.setup();
    await flush();
    t.svc.nextAt = Infinity;
    t.tick(Date.parse(T_GOES) + GOES_STALE_MS + 1 - NOW);
    expect(t.made).toHaveLength(2);
    expect(t.made[1].fresh.goes).toBeNull();
    t.made[1].fire("load");
    t.tick(Date.parse(T_GLOBAL) + GLOBAL_STALE_MS + 1 - (Date.parse(T_GOES) + GOES_STALE_MS + 1));
    expect(t.svc.layer).toBeNull();
    expect(t.svc.group.layers).toHaveLength(0);
    expect(t.map.attr.remove).toEqual([CLOUD_CREDIT]);
  });

  it("a failed read keeps the frames held; an older answer never replaces them", async () => {
    let body = caps();
    const t = make({ show: true }, () => body);
    t.svc.setup();
    await flush();
    body = new Error("down");
    t.tick(CLOUD_POLL_MS);
    await flush();
    expect(t.svc.frames.goes).toEqual(frame(T_GOES));
    body = caps("2026-10-28T19:00:00Z", "2026-10-28T17:00:00Z");
    t.tick(CLOUD_POLL_MS);
    await flush();
    expect(t.svc.frames).toEqual({ goes: frame(T_GOES), global: frame(T_GLOBAL) });
    expect(t.made).toHaveLength(1);
  });

  it("follows the theme: white on the dark map, the tiles redrawn", async () => {
    const t = make({ show: true }, () => caps());
    t.svc.setup();
    await flush();
    t.setDark(true);
    t.tick(TICK_MS);
    expect(t.made[0].redraw).toHaveBeenCalledTimes(1);
    expect(t.made[0].colour()).toEqual(CLOUD_COLOURS.dark);
    t.tick(TICK_MS);
    expect(t.made[0].redraw).toHaveBeenCalledTimes(1);
  });

  it("unticked again: layer and credit gone; cleanup removes the checkbox and the pane", async () => {
    const t = make({ show: true }, () => caps());
    t.svc.setup();
    await flush();
    t.svc.group.onMap = false;
    t.svc.group.fire("remove");
    expect(t.svc.layer).toBeNull();
    expect(t.map.attr.remove).toEqual([CLOUD_CREDIT]);
    const pane = t.map.getPane(CLOUD_PANE);
    t.svc.cleanup();
    expect(t.ov.removeOverlay).toHaveBeenCalledWith(t.svc.group);
    expect(pane.parentNode).toBeNull();
    expect(FETCH_TIMEOUT_MS).toBe(20000);
  });
});
