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
  parseCloudsOption, layerFrame, parseCloudCaps, freshFrames, tileBounds, tilePlan, tileUrl, recolour, viewCovered,
  placeCloudPane, cloudLayer, pairKey, DEFAULT_CLOUDS, CLOUD_NAME, CLOUD_PANE, CLOUD_CAPS, CLOUD_WMS, GOES_LAYER,
  GOES_BOUNDS, CLOUD_MAX_NATIVE_ZOOM, CLOUD_POLL_MS, GOES_STALE_MS, TICK_MS, SWAP_TIMEOUT_MS, FETCH_TIMEOUT_MS,
  CLOUD_CREDIT, CLEAR, CLOUDY, MAX_ALPHA, CLOUD_COLOURS, singleFrame, capsUrl, layerOver, viewEumetsat, KINDS, RAMPS,
  LAYER_WMS, MTG_WMS, MTG_LAYER, IODC_WMS, IODC_LAYER, WORLD_WMS, WORLD_LAYER, MTG_REACH, MTG_FULL, IODC_REACH,
  IODC_FULL, WORLD_REACH, WORLD_FULL, MTG_STALE_MS, IODC_STALE_MS, WORLD_STALE_MS, EUMETSAT_CREDIT, SOUTH_LIMIT,
  southRow, colRange,
} from "./CloudOverlayService.js";
import { RADAR_PANE } from "./RadarOverlayService.js";

const NOW = Date.UTC(2026, 9, 28, 19, 32);
const T_GOES = "2026-10-28T19:28:00Z";
const T_MTG = "2026-10-28T19:10:00Z";
const T_IODC = "2026-10-28T19:15:00Z";
const T_WORLD = "2026-10-28T18:00:00Z";
/**
 * The shape of nowCOAST's answer, measured 2026-10-28 (bin\ltw307\caps_nowcoast.xml).
 * @param {?string} goes
 * @returns {string}
 */
const caps = (goes = T_GOES) => `<WMS_Capabilities><Capability><Layer><Name>goes_visible_imagery</Name>`
  + `<Dimension name="time" default="2020-01-01T00:00:00Z">x</Dimension></Layer>`
  + `<Layer queryable="1"><Name>global_longwave_imagery_mosaic</Name><Dimension name="time" default="2026-10-28T18:00:00Z" units="ISO8601">x</Dimension></Layer>`
  + (goes ? `<Layer queryable="1"><Name>${GOES_LAYER}</Name><Style><Name>goes-lir</Name></Style><Dimension name="time" default="${goes}" units="ISO8601">2026-10-28T12:03:00.000Z,${goes}</Dimension></Layer>` : "")
  + `</Capability></WMS_Capabilities>`;

/**
 * The shape of EUMETSAT's one-layer answers, measured 2026-10-28 (bin\ltw307\polar\caps_mtg.xml, caps_world.xml).
 * @param {?string} t the newest frame
 * @param {string} step
 * @returns {string}
 */
const single = (t, step = "PT10M") => `<WMS_Capabilities><Capability><Layer><Name>WMS</Name><Layer queryable="1"><Name>x</Name>`
  + (t ? `<Dimension name="time" default="${t}" units="ISO8601" nearestValue="1">2024-09-23T00:00:00.000Z/${t.replace("Z", ".000Z")}/${step}</Dimension>` : "")
  + `<Style><Name>grayscale</Name></Style></Layer></Layer></Capability></WMS_Capabilities>`;

const frame = (t) => ({ key: t, time: Date.parse(t) });

/**
 * Every list's answer by its URL.
 * @param {object} [o] goes, mtg, iodc, world: a time or null; eum: false sends EUMETSAT a failure
 * @returns {Function}
 */
const lists = (o = {}) => (url) => {
  const v = (k, d) => (o[k] === undefined ? d : o[k]);
  if (url === capsUrl(MTG_WMS)) return o.eum === false ? new Error("down") : single(v("mtg", T_MTG));
  if (url === capsUrl(IODC_WMS)) return o.eum === false ? new Error("down") : single(v("iodc", T_IODC), "PT15M");
  if (url === capsUrl(WORLD_WMS)) return o.eum === false ? new Error("down") : single(v("world", T_WORLD), "PT3H");
  return caps(v("goes", T_GOES));
};
const ALL = () => ({ goes: frame(T_GOES), mtg: frame(T_MTG), iodc: frame(T_IODC), world: frame(T_WORLD) });

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

  it("GOES's own newest frame from nowCOAST; NOAA's global mosaic not read", () => {
    expect(parseCloudCaps(caps())).toEqual({ goes: frame(T_GOES) });
    expect(parseCloudCaps(caps(null))).toEqual({ goes: null });
    expect(layerFrame("<Name>goes_longwave_imagery</Name>", GOES_LAYER)).toBeNull();
    expect(layerFrame(`<Name>${GOES_LAYER}</Name><Dimension name="time" default="nope">`, GOES_LAYER)).toBeNull();
    expect(layerFrame(undefined, GOES_LAYER)).toBeNull();
    expect(CLOUD_CAPS).toBe(`${CLOUD_WMS}?service=WMS&version=1.3.0&request=GetCapabilities`);
  });

  it("EUMETSAT's newest frame from each one-layer answer", () => {
    expect(singleFrame(single(T_MTG))).toEqual(frame(T_MTG));
    expect(singleFrame(single(null))).toBeNull();
    expect(singleFrame(`<Dimension name="elevation" default="0"><Dimension name="time" default="${T_WORLD}">`)).toEqual(frame(T_WORLD));
    expect(singleFrame(`<Dimension name="time" default="nope">`)).toBeNull();
    expect(singleFrame(undefined)).toBeNull();
    expect(capsUrl(MTG_WMS)).toBe("https://view.eumetsat.int/geoserver/mtg_fd/ir105_hrfi/ows?service=WMS&version=1.3.0&request=GetCapabilities");
    expect([MTG_LAYER, IODC_LAYER, WORLD_LAYER]).toEqual(["mtg_fd:ir105_hrfi", "msg_iodc:ir108", "mumi:worldcloudmap_ir108"]);
    expect([IODC_WMS, WORLD_WMS]).toEqual(["https://view.eumetsat.int/geoserver/msg_iodc/ir108/ows",
      "https://view.eumetsat.int/geoserver/mumi/worldcloudmap_ir108/ows"]);
    expect(LAYER_WMS).toEqual({ [GOES_LAYER]: CLOUD_WMS, [MTG_LAYER]: MTG_WMS, [IODC_LAYER]: IODC_WMS, [WORLD_LAYER]: WORLD_WMS });
  });

  it("stale: GOES after 30 minutes, MTG after 40, IODC after 45, the world map after 7 hours", () => {
    expect([GOES_STALE_MS, MTG_STALE_MS, IODC_STALE_MS, WORLD_STALE_MS]).toEqual([30, 40, 45, 420].map((m) => m * 60 * 1000));
    const f = ALL();
    expect(freshFrames(f, NOW)).toEqual(f);
    for (const [k, t, ms] of [["goes", T_GOES, GOES_STALE_MS], ["mtg", T_MTG, MTG_STALE_MS],
      ["iodc", T_IODC, IODC_STALE_MS], ["world", T_WORLD, WORLD_STALE_MS]]) {
      expect(freshFrames(f, Date.parse(t) + ms)[k]).not.toBeNull();
      expect(freshFrames(f, Date.parse(t) + ms + 1)[k]).toBeNull();
    }
    expect(freshFrames(undefined, NOW)).toEqual({ goes: null, mtg: null, iodc: null, world: null });
    expect(KINDS).toEqual(["world", "iodc", "mtg", "goes"]);
    expect(pairKey(f)).toBe(`${T_WORLD}|${T_IODC}|${T_MTG}|${T_GOES}`);
    expect(pairKey({ goes: f.goes })).toBe(`-|-|-|${T_GOES}`);
    expect(pairKey(null)).toBe("-|-|-|-");
  });
});

describe("tiles", () => {
  const G = { layer: GOES_LAYER, key: T_GOES };
  const T = { layer: MTG_LAYER, key: T_MTG };
  const I = { layer: IODC_LAYER, key: T_IODC };
  const W = { layer: WORLD_LAYER, key: T_WORLD };

  it("a tile's box", () => {
    const b = tileBounds({ x: 0, y: 0, z: 0 });
    expect([b.w, b.e]).toEqual([-180, 180]);
    expect(b.n).toBeCloseTo(85.0511, 3);
    expect(b.s).toBeCloseTo(-85.0511, 3);
    const c = tileBounds({ x: 1, y: 1, z: 1 });
    expect([c.w, c.e, c.n]).toEqual([0, 180, 0]);
  });

  it("the boxes, as measured", () => {
    expect(GOES_BOUNDS).toEqual({ w: -179.5, e: -50.76, s: 10.92, n: 50.55 });
    expect(MTG_REACH).toEqual({ w: -51, e: 45, s: -77.4, n: 77.2 });
    expect(MTG_FULL).toEqual([{ w: -45, e: 45, s: -75, n: 75 }]);
    expect(IODC_REACH).toEqual({ w: -10, e: 100, s: -77, n: 75.2 });
    expect(IODC_FULL).toEqual([{ w: 16, e: 75, s: -71, n: 71 }, { w: -10, e: 100, s: -64.5, n: 64.5 }]);
    expect(WORLD_REACH).toEqual({ w: -180, e: 180, s: -81.4, n: 81.4 });
    expect(WORLD_FULL).toEqual([{ w: -180, e: 180, s: -69.5, n: 69.5 }]);
    expect(SOUTH_LIMIT).toBe(-72.74);
  });

  it("from the top of the pile down to the first picture that covers the tile", () => {
    const fresh = ALL();
    // the US, z6 about 36.6-41.0 N, 90-84.4 W: wholly inside GOES
    expect(tilePlan({ z: 6, x: 16, y: 24 }, fresh)).toEqual([G]);
    // Europe, z5 48.9-55.8 N, 0-11.25 E: inside MTG's whole box
    expect(tilePlan({ z: 5, x: 16, y: 10 }, fresh)).toEqual([T]);
    // z3 0-41 N, 90-45 W: crosses GOES's edges and MTG's limb; the world map under both
    expect(tilePlan({ z: 3, x: 2, y: 3 }, fresh)).toEqual([W, T, G]);
    // the Indian Ocean, z4 0-22 S, 45-67.5 E, and India, z4 21.9-41 N, 67.5-90 E: IODC alone, east of MTG's cut
    expect(tilePlan({ z: 4, x: 10, y: 8 }, fresh)).toEqual([I]);
    expect(tilePlan({ z: 4, x: 11, y: 6 }, fresh)).toEqual([I]);
    // z2 0-66.5 N, 0-90 E: across MTG's cut and past IODC's whole box; the world map under both
    expect(tilePlan({ z: 2, x: 2, y: 1 }, fresh)).toEqual([W, I, T]);
    // East Asia, z4 21.9-41 N, 135-157.5 E: the world map alone
    expect(tilePlan({ z: 4, x: 14, y: 6 }, fresh)).toEqual([W]);
  });

  it("a picture stale: the next one down draws", () => {
    const fresh = ALL();
    expect(tilePlan({ z: 6, x: 16, y: 24 }, { ...fresh, goes: null })).toEqual([W]);
    expect(tilePlan({ z: 5, x: 16, y: 10 }, { ...fresh, mtg: null })).toEqual([I]);
    expect(tilePlan({ z: 5, x: 16, y: 10 }, { ...fresh, mtg: null, iodc: null })).toEqual([W]);
    expect(tilePlan({ z: 3, x: 2, y: 3 }, { goes: fresh.goes })).toEqual([G]);
    expect(tilePlan({ z: 6, x: 16, y: 24 }, { goes: null, mtg: null, iodc: null, world: null })).toEqual([]);
    expect(tilePlan({ z: 6, x: 16, y: 24 }, null)).toEqual([]);
  });

  it("north to the world map's edge; south only to 72.74 S", () => {
    const fresh = ALL();
    // z4 66.5-74.0 N, 0-22.5 E: inside MTG's whole box
    expect(tilePlan({ z: 4, x: 8, y: 3 }, fresh)).toEqual([T]);
    // Svalbard, z5 76.8-79.2 N, 11.25-22.5 E: MTG to 77.1, the world map under it
    expect(tilePlan({ z: 5, x: 17, y: 4 }, fresh)).toEqual([W, T]);
    // north Greenland, z5 79.2-81.1 N, 56.25-45 W, and Alaska's north slope: the world map alone
    expect(tilePlan({ z: 5, x: 11, y: 3 }, fresh)).toEqual([W]);
    expect(tilePlan({ z: 5, x: 2, y: 6 }, fresh)).toEqual([W]);
    // the pole, past every picture
    expect(tilePlan({ z: 5, x: 17, y: 0 }, fresh)).toEqual([]);
    // the Antarctic coast, z4 66.5-74.0 S, 0-22.5 E: drawn (and cut at 72.74 S, below); 74.0-79.2 S: nothing
    expect(tilePlan({ z: 4, x: 8, y: 12 }, fresh)).toEqual([T]);
    expect(tilePlan({ z: 4, x: 8, y: 13 }, fresh)).toEqual([]);
  });

  it("the columns between two longitudes: each picture's cut", () => {
    expect(colRange({ z: 2, x: 2, y: 1 }, MTG_REACH.w, MTG_REACH.e)).toEqual([0, 128]);
    expect(colRange({ z: 2, x: 1, y: 1 }, MTG_REACH.w, MTG_REACH.e)).toEqual([111, 256]);
    expect(colRange({ z: 2, x: 2, y: 1 }, IODC_REACH.w, IODC_REACH.e)).toEqual([0, 256]);
    expect(colRange({ z: 2, x: 3, y: 1 }, IODC_REACH.w, IODC_REACH.e)).toEqual([0, 28]);
    expect(colRange({ z: 5, x: 17, y: 4 }, MTG_REACH.w, MTG_REACH.e)).toEqual([0, 256]);
    expect(colRange({ z: 0, x: 0, y: 0 }, -180, 180)).toEqual([0, 256]);
  });

  it("the first row south of 72.74 S", () => {
    expect(southRow({ z: 4, x: 8, y: 12 })).toBe(206);
    expect(southRow({ z: 4, x: 8, y: 11 })).toBe(256);
    expect(southRow({ z: 4, x: 8, y: 13 })).toBe(0);
    expect(southRow({ z: 5, x: 3, y: 25 })).toBe(155);
    expect(southRow({ z: 6, x: 16, y: 24 })).toBe(256);
  });

  it("the GetMap for a tile, in Web Mercator, with its frame, from its own WMS", () => {
    const u = new URL(tileUrl({ z: 1, x: 0, y: 0 }, G));
    expect(`${u.origin}${u.pathname}`).toBe(CLOUD_WMS);
    const p = Object.fromEntries(u.searchParams);
    expect(p).toEqual({ service: "WMS", request: "GetMap", version: "1.3.0", layers: GOES_LAYER, styles: "", crs: "EPSG:3857",
      bbox: "-20037508.342789244,0,0,20037508.342789244", width: "256", height: "256", format: "image/png",
      transparent: "true", time: T_GOES });
    const q = Object.fromEntries(new URL(tileUrl({ z: 2, x: 3, y: 2 }, W)).searchParams);
    const H = 20037508.342789244;
    q.bbox.split(",").map(Number).forEach((v, i) => expect(v).toBeCloseTo([H / 2, -H / 2, H, 0][i], 4));
    for (const [src, base] of [[T, MTG_WMS], [I, IODC_WMS], [W, WORLD_WMS]]) {
      const w = new URL(tileUrl({ z: 5, x: 17, y: 4 }, src));
      expect(`${w.origin}${w.pathname}`).toBe(base);
      expect(w.searchParams.get("layers")).toBe(src.layer);
      expect(w.searchParams.get("time")).toBe(src.key);
    }
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
    // a ramp of its own
    const e = [v(0.4), v(0.4), v(0.4), 255, v(0.45), v(0.45), v(0.45), 255, v(0.61), v(0.61), v(0.61), 255];
    recolour(e, [1, 2, 3], [0.4, 0.6]);
    expect([e[3], e[7], e[11]]).toEqual([0, 42, Math.round(255 * 0.65)]);
  });

  it("each picture's own ramp, as measured against GOES", () => {
    expect(RAMPS).toEqual({
      [GOES_LAYER]: [CLEAR, CLOUDY], [MTG_LAYER]: [0.175, 0.566], [IODC_LAYER]: [0.181, 0.704], [WORLD_LAYER]: [0.326, 0.585],
    });
  });

  it("layerOver: a picture replaces the tile where it has data, clear sky included, and nowhere else", () => {
    const dst = [9, 9, 9, 100, 9, 9, 9, 100, 9, 9, 9, 100];
    const src = [255, 255, 255, 255, 50, 50, 50, 255, 255, 255, 255, 0];
    layerOver(dst, src, [1, 2, 3], [CLEAR, CLOUDY]);
    expect(dst).toEqual([1, 2, 3, Math.round(255 * MAX_ALPHA), 1, 2, 3, 0, 9, 9, 9, 100]);
    expect(src).toEqual([255, 255, 255, 255, 50, 50, 50, 255, 255, 255, 255, 0]);
    // outside its columns, nothing
    const d2 = [9, 9, 9, 100, 9, 9, 9, 100, 9, 9, 9, 100];
    layerOver(d2, [255, 255, 255, 255, 50, 50, 50, 255, 255, 255, 255, 255], [1, 2, 3], [CLEAR, CLOUDY], 1, 2);
    expect(d2).toEqual([9, 9, 9, 100, 1, 2, 3, 0, 9, 9, 9, 100]);
  });

  it("zoom 6 is the native zoom", () => {
    expect(CLOUD_MAX_NATIVE_ZOOM).toBe(6);
  });
});

/**
 * @returns {object} a map stand-in with real DOM panes; its view starts inside GOES's box
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
    panes, mapPane, south: 30, north: 50, west: -100, east: -80,
    getPane: jest.fn((n) => panes[n]),
    createPane: jest.fn((n) => { panes[n] = document.createElement("div"); mapPane.appendChild(panes[n]); return panes[n]; }),
    getBounds: () => ({ getSouth: () => map.south, getNorth: () => map.north, getWest: () => map.west, getEast: () => map.east }),
    attributionControl: { addAttribution: jest.fn((s) => attr.add.push(s)), removeAttribution: jest.fn((s) => attr.remove.push(s)) },
  });
  map.view = (s, n, w, e) => { Object.assign(map, { south: s, north: n, west: w, east: e }); map.fire("moveend"); };
  map.attr = attr;
  return map;
}

/**
 * @param {number} s
 * @param {number} n
 * @param {number} w
 * @param {number} e
 * @returns {object} Leaflet bounds
 */
const vb = (s, n, w, e) => ({ getSouth: () => s, getNorth: () => n, getWest: () => w, getEast: () => e });

describe("the pane and the view", () => {
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
  });

  it("whose pictures a view can show", () => {
    // inside GOES's box
    expect(viewCovered(vb(30, 50, -100, -80))).toBe(true);
    expect(viewEumetsat(vb(30, 50, -100, -80))).toBe(false);
    expect(viewEumetsat(vb(30, 50, -100, -80), false)).toBe(true);
    // Europe
    expect(viewCovered(vb(40, 60, -10, 30))).toBe(false);
    expect(viewEumetsat(vb(40, 60, -10, 30))).toBe(true);
    // both
    expect(viewCovered(vb(30, 50, -100, -40))).toBe(true);
    expect(viewEumetsat(vb(30, 50, -100, -40))).toBe(true);
    // across 180, and panned a world round
    expect(viewCovered(vb(30, 50, 170, 200))).toBe(true);
    expect(viewCovered(vb(30, 50, 260, 280))).toBe(true);
    expect(viewEumetsat(vb(30, 50, 260, 280))).toBe(false);
    // the whole world
    expect(viewCovered(vb(-80, 80, -540, 540))).toBe(true);
    expect(viewEumetsat(vb(-80, 80, -540, 540))).toBe(true);
    // Antarctica, past 72.74 S; the pole, past the world map
    expect(viewEumetsat(vb(-85, -75, -10, 30))).toBe(false);
    expect(viewEumetsat(vb(82, 85, -10, 30))).toBe(false);
    expect(viewCovered(null)).toBe(false);
    expect(viewEumetsat(null)).toBe(false);
    // no west and east: every longitude
    expect(viewEumetsat({ getSouth: () => 30, getNorth: () => 50 })).toBe(true);
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

  it("asks for each tile's own pictures, cross-origin, and draws an empty tile where there is none", async () => {
    const fresh = ALL();
    const onError = jest.fn();
    const layer = cloudLayer(fresh, () => CLOUD_COLOURS.light, 0.7, onError);
    expect(layer.options).toMatchObject({ pane: CLOUD_PANE, maxNativeZoom: 6, opacity: 0.7, tileSize: 256 });
    expect(L.latLngBounds).toHaveBeenLastCalledWith([SOUTH_LIMIT, -180], [WORLD_REACH.n, 180]);
    const done = jest.fn();
    const c = layer.createTile({ z: 6, x: 16, y: 24 }, done);
    expect(c.tagName).toBe("CANVAS");
    expect(images).toHaveLength(1);
    expect(images[0].crossOrigin).toBe("anonymous");
    expect(images[0].src).toBe(tileUrl({ z: 6, x: 16, y: 24 }, { layer: GOES_LAYER, key: T_GOES }));
    images[0].onerror();
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toHaveBeenCalledWith(expect.any(Error), c);
    expect(onError).toHaveBeenCalledTimes(1);
    const done2 = jest.fn();
    layer.createTile({ z: 5, x: 17, y: 0 }, done2);
    expect(images).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(done2).toHaveBeenCalledWith(null, expect.anything());
    // Svalbard: the world map and MTG asked at once
    layer.createTile({ z: 5, x: 17, y: 4 }, jest.fn());
    expect(images.slice(1).map((i) => i.src)).toEqual([
      tileUrl({ z: 5, x: 17, y: 4 }, { layer: WORLD_LAYER, key: T_WORLD }),
      tileUrl({ z: 5, x: 17, y: 4 }, { layer: MTG_LAYER, key: T_MTG }),
    ]);
  });

  it("lays the pictures bottom first, each on its own ramp; one failing leaves the rest; cut at 72.74 S", async () => {
    const fresh = ALL();
    const onError = jest.fn();
    const layer = cloudLayer(fresh, () => [1, 2, 3], 1, onError);
    // a canvas stand-in: each drawImage "fetches" the pixels set for that image; tiles here are 2 px
    const pixels = new Map();
    const put = [];
    let size = 8;
    const ctx = {
      drawn: null,
      clearRect: jest.fn(),
      drawImage: jest.fn((img) => { ctx.drawn = img; }),
      getImageData: jest.fn(() => ({ data: Uint8ClampedArray.from(pixels.get(ctx.drawn)) })),
      createImageData: jest.fn(() => ({ data: new Uint8ClampedArray(size) })),
      putImageData: jest.fn((d) => put.push(Array.from(d.data))),
    };
    const realCreate = document.createElement.bind(document);
    const spy = jest.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === "canvas") el.getContext = () => ctx;
      return el;
    });
    try {
      const v = (x) => Math.round(x * 255);
      const done = jest.fn();
      // z3 0-41 N, 90-45 W: the world map, MTG (cut at 51 W: not in these two columns), GOES
      layer.createTile({ z: 3, x: 2, y: 3 }, done);
      const [world, mtg, goes] = images;
      // pixel 1: every picture has data; pixel 2: only the world map and MTG have
      pixels.set(world, [v(0.585), v(0.585), v(0.585), 255, v(0.6), v(0.6), v(0.6), 255]);
      pixels.set(mtg, [v(0.9), v(0.9), v(0.9), 255, v(0.1), v(0.1), v(0.1), 255]);
      pixels.set(goes, [v(0.3), v(0.3), v(0.3), 255, 0, 0, 0, 0]);
      world.onload();
      goes.onload();
      mtg.onload();
      await new Promise((r) => setTimeout(r, 0));
      expect(done).toHaveBeenCalledWith(null, expect.anything());
      // GOES's clear sky over the rest; the world map's full cloud where only it has data
      expect(put).toEqual([[1, 2, 3, 0, 1, 2, 3, Math.round(255 * MAX_ALPHA)]]);
      // Svalbard with the world map failing: MTG alone, and the failure reported
      const done3 = jest.fn();
      layer.createTile({ z: 5, x: 17, y: 4 }, done3);
      const [w2, m2] = images.slice(3);
      pixels.set(m2, [v(0.6), v(0.6), v(0.6), 255, 0, 0, 0, 0]);
      w2.onerror();
      m2.onload();
      await new Promise((r) => setTimeout(r, 0));
      expect(done3).toHaveBeenCalledWith(null, expect.anything());
      expect(put[1]).toEqual([1, 2, 3, Math.round(255 * MAX_ALPHA), 0, 0, 0, 0]);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0].message).toBe(`tile not loaded: ${WORLD_LAYER}`);
      // the Antarctic coast: every row from 206 down cleared
      size = 256 * 256 * 4;
      const full = new Array(size).fill(255);
      const done4 = jest.fn();
      layer.createTile({ z: 4, x: 8, y: 12 }, done4);
      pixels.set(images[5], full);
      images[5].onload();
      await new Promise((r) => setTimeout(r, 0));
      const out = put[2];
      expect(out[205 * 1024 + 3]).toBe(Math.round(255 * MAX_ALPHA));
      expect(out[206 * 1024 + 3]).toBe(0);
      expect(out.slice(206 * 1024).every((x) => x === 0)).toBe(true);
    } finally {
      spy.mockRestore();
    }
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
    const t = make(undefined, lists());
    t.svc.setup();
    expect(t.ov.addOverlay).toHaveBeenCalledWith(t.svc.group, "Clouds", false);
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.map.getPane(CLOUD_PANE)).toBeTruthy();
  });

  it("false: no checkbox, no pane, no fetch", () => {
    const t = make(false, lists());
    t.svc.setup();
    expect(t.ov.addOverlay).not.toHaveBeenCalled();
    expect(t.map.panes[CLOUD_PANE]).toBeUndefined();
  });

  it("ticked: reads the four lists with no-cache and draws them, with GOES's credit over the US", async () => {
    const t = make({ show: true }, lists());
    t.svc.setup();
    await flush();
    for (const url of [CLOUD_CAPS, capsUrl(MTG_WMS), capsUrl(IODC_WMS), capsUrl(WORLD_WMS)]) {
      expect(t.fetch).toHaveBeenCalledWith(url, expect.objectContaining({ cache: "no-cache", credentials: "omit" }));
    }
    expect(t.fetch).toHaveBeenCalledTimes(4);
    expect(t.made).toHaveLength(1);
    expect(t.made[0].fresh).toEqual(ALL());
    expect(t.made[0].opacity).toBe(1);
    expect(t.made[0].colour()).toEqual(CLOUD_COLOURS.light);
    expect(t.svc.group.layers).toEqual([t.made[0]]);
    expect(t.map.attr.add).toEqual([CLOUD_CREDIT]);
  });

  it("a new GOES frame loads hidden and replaces the old on load; read again only after the poll interval", async () => {
    let goes = T_GOES;
    const t = make({ show: true }, (url) => lists({ goes })(url));
    t.svc.setup();
    await flush();
    goes = "2026-10-28T19:33:00Z";
    t.tick(CLOUD_POLL_MS - 1000);
    await flush();
    expect(t.fetch).toHaveBeenCalledTimes(4);
    t.tick(1000);
    await flush();
    expect(t.fetch).toHaveBeenCalledTimes(8);
    expect(t.made).toHaveLength(2);
    expect(t.made[1].opacity).toBe(0);
    expect(t.svc.group.layers).toHaveLength(2);
    t.made[1].fire("load");
    expect(t.made[1].setOpacity).toHaveBeenCalledWith(1);
    expect(t.svc.group.layers).toEqual([t.made[1]]);
    expect(t.timeouts.some((x) => x.ms === SWAP_TIMEOUT_MS)).toBe(true);
  });

  it("GOES stale: EUMETSAT draws the US too, with its credit; all stale: nothing drawn, no credit", async () => {
    const t = make({ show: true }, lists());
    t.svc.setup();
    await flush();
    t.svc.nextAt = Infinity;
    t.tick(Date.parse(T_GOES) + GOES_STALE_MS + 1 - NOW);
    expect(t.made).toHaveLength(2);
    expect(t.made[1].fresh.goes).toBeNull();
    expect(t.made[1].fresh.world).toEqual(frame(T_WORLD));
    t.made[1].fire("load");
    expect(t.map.attr.remove).toEqual([CLOUD_CREDIT]);
    expect(t.map.attr.add).toEqual([CLOUD_CREDIT, EUMETSAT_CREDIT]);
    t.tick(Date.parse(T_WORLD) + WORLD_STALE_MS + 1 - (Date.parse(T_GOES) + GOES_STALE_MS + 1));
    expect(t.svc.layer).toBeNull();
    expect(t.svc.group.layers).toHaveLength(0);
    expect(t.map.attr.remove).toEqual([CLOUD_CREDIT, EUMETSAT_CREDIT]);
  });

  it("EUMETSAT down: GOES alone, its credit only", async () => {
    const t = make({ show: true }, lists({ eum: false }));
    t.svc.setup();
    await flush();
    expect(t.made[0].fresh).toEqual({ goes: frame(T_GOES), mtg: null, iodc: null, world: null });
    t.map.view(30, 50, -100, -40);
    expect(t.map.attr.add).toEqual([CLOUD_CREDIT]);
  });

  it("a failed read keeps the frames held; an older answer never replaces them; each list on its own", async () => {
    let answer = lists();
    const t = make({ show: true }, (url) => answer(url));
    t.svc.setup();
    await flush();
    answer = () => new Error("down");
    t.tick(CLOUD_POLL_MS);
    await flush();
    expect(t.svc.frames).toEqual(ALL());
    answer = lists({ goes: "2026-10-28T19:00:00Z", mtg: "2026-10-28T19:00:00Z", iodc: "2026-10-28T19:00:00Z", world: "2026-10-28T15:00:00Z" });
    t.tick(CLOUD_POLL_MS);
    await flush();
    expect(t.svc.frames).toEqual(ALL());
    expect(t.made).toHaveLength(1);
    // EUMETSAT down, NOAA new: NOAA's frame moves on alone
    answer = lists({ goes: "2026-10-28T19:43:00Z", eum: false });
    t.tick(CLOUD_POLL_MS);
    await flush();
    expect(t.svc.frames).toEqual({ ...ALL(), goes: frame("2026-10-28T19:43:00Z") });
    expect(t.made).toHaveLength(2);
    // MTG and IODC new
    answer = lists({ goes: "2026-10-28T19:43:00Z", mtg: "2026-10-28T19:30:00Z", iodc: "2026-10-28T19:30:00Z" });
    t.tick(CLOUD_POLL_MS);
    await flush();
    expect(t.made.at(-1).fresh.mtg).toEqual(frame("2026-10-28T19:30:00Z"));
    expect(t.made.at(-1).fresh.iodc).toEqual(frame("2026-10-28T19:30:00Z"));
  });

  it("the credits follow the view", async () => {
    expect([CLOUD_CREDIT, EUMETSAT_CREDIT]).toEqual(["Clouds: NOAA nowCOAST, GOES", "Clouds: \u00a9 EUMETSAT"]);
    const t = make({ show: true }, lists());
    t.map.south = 40;
    t.map.north = 60;
    t.map.west = -10;
    t.map.east = 30;
    t.svc.setup();
    await flush();
    expect(t.map.attr.add).toEqual([EUMETSAT_CREDIT]);
    t.map.view(30, 50, -100, -40);
    expect(t.map.attr.add).toEqual([EUMETSAT_CREDIT, CLOUD_CREDIT]);
    t.map.view(30, 50, -100, -80);
    expect(t.map.attr.remove).toEqual([EUMETSAT_CREDIT]);
    t.map.view(-85, -75, -10, 30);
    expect(t.map.attr.remove).toEqual([EUMETSAT_CREDIT, CLOUD_CREDIT]);
  });

  it("follows the theme: white on the dark map, the tiles redrawn", async () => {
    const t = make({ show: true }, lists());
    t.svc.setup();
    await flush();
    t.setDark(true);
    t.tick(TICK_MS);
    expect(t.made[0].redraw).toHaveBeenCalledTimes(1);
    expect(t.made[0].colour()).toEqual(CLOUD_COLOURS.dark);
    t.tick(TICK_MS);
    expect(t.made[0].redraw).toHaveBeenCalledTimes(1);
  });

  it("unticked again: layer and credits gone; cleanup removes the checkbox and the pane", async () => {
    const t = make({ show: true }, lists());
    t.map.west = -100;
    t.map.east = -40;
    t.svc.setup();
    await flush();
    t.svc.group.onMap = false;
    t.svc.group.fire("remove");
    expect(t.svc.layer).toBeNull();
    expect(t.map.attr.remove).toEqual([CLOUD_CREDIT, EUMETSAT_CREDIT]);
    const pane = t.map.getPane(CLOUD_PANE);
    t.svc.cleanup();
    expect(t.ov.removeOverlay).toHaveBeenCalledWith(t.svc.group);
    expect(pane.parentNode).toBeNull();
    expect(FETCH_TIMEOUT_MS).toBe(20000);
  });
});
