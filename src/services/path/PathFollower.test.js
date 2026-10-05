/**
 * @jest-environment node
 */
import { PathFollower, AT_REST_KMH, REST_MAX_CHORD_M, WIDE_MARGIN_M, PLACE } from "./PathFollower.js";
import { parsePathOptions, DEFAULT_SOURCES, DEFAULT_MIN_ZOOM, DEFAULT_STRICT_ZOOM } from "./options.js";
import { at, xy, makeGrid, lRiver } from "./testWater.testhelper.js";

/**
 * @param {function(number, number): boolean} [loaded]
 * @returns {object} a store over the L-shaped river
 */
function stubStore(loaded = () => true) {
  const g = makeGrid(lRiver, { loaded });
  return Object.assign(g, {
    running: true, used: new Set(), listeners: new Set(), tileListeners: new Set(),
    requested: [], request(tiles) { this.requested.push(...tiles); },
  });
}
/**
 * @param {number} [zoom]
 * @returns {object} enough of a Leaflet map
 */
function stubMap(zoom = 15) {
  const attributions = [];
  const b = { s: 41.87, n: 41.89, w: -87.66, e: -87.60 };
  const bounds = { getSouth: () => b.s, getNorth: () => b.n, getWest: () => b.w, getEast: () => b.e };
  return {
    attributions,
    zoom,
    getZoom() { return this.zoom; },
    getBounds: () => ({ pad: () => bounds }),
    attributionControl: { addAttribution: (a) => attributions.push(a) },
  };
}
const WATER = { map_layer: "water", speed_kmh: 10 };
const opts = (o = {}) => ({ ...parsePathOptions({}), ...o });

describe("options", () => {
  test("ON by default, from zoom 14, OpenStreetMap first and OpenFreeMap second", () => {
    const o = parsePathOptions({});
    expect(o.enabled).toBe(true);
    expect(o.minZoom).toBe(14);
    expect(DEFAULT_MIN_ZOOM).toBe(14);
    expect(o.sources.map((s) => s.id)).toEqual(["openstreetmap", "openfreemap"]);
    expect(o.sources[0].tilejson).toBe("https://vector.openstreetmap.org/shortbread_v1/tilejson.json");
    expect(o.sources[0].schema).toBe("shortbread");
    expect(o.sources[1].schema).toBe("openmaptiles");
  });
  test("only `path_following: false` turns it off", () => {
    expect(parsePathOptions({ path_following: false }).enabled).toBe(false);
    for (const v of [true, "false", 0, null, undefined]) expect(parsePathOptions({ path_following: v }).enabled).toBe(true);
  });
  test("path_min_zoom moves the gate; nonsense keeps 14", () => {
    expect(parsePathOptions({ path_min_zoom: 12 }).minZoom).toBe(12);
    expect(parsePathOptions({ path_min_zoom: "15" }).minZoom).toBe(15);
    expect(parsePathOptions({ path_min_zoom: "x" }).minZoom).toBe(14);
    expect(parsePathOptions({ path_min_zoom: "" }).minZoom).toBe(14);
  });
  test("path_tile_sources replaces the list; bad entries are dropped; none left is the defaults", () => {
    const mine = { id: "mine", tiles: "https://t/{z}/{x}/{y}.pbf", schema: "openmaptiles" };
    expect(parsePathOptions({ path_tile_sources: [mine, { id: "bad", schema: "x", tiles: "u" }] }).sources).toEqual([mine]);
    expect(parsePathOptions({ path_tile_sources: [{ id: 1 }] }).sources).toBe(DEFAULT_SOURCES);
  });
});

describe("PathFollower", () => {
  test("applies to water objects only, at or above the zoom gate, when enabled", () => {
    const map = stubMap(14);
    const f = new PathFollower(map, opts(), stubStore());
    expect(f.applies(WATER)).toBe(true);
    expect(f.applies({ map_layer: "rail" })).toBe(false);
    expect(f.applies({ map_layer: "air" })).toBe(false);
    expect(f.applies({})).toBe(false);
    map.zoom = 13.9;
    expect(f.applies(WATER)).toBe(false);
    expect(new PathFollower(stubMap(16), opts({ enabled: false }), stubStore()).applies(WATER)).toBe(false);
  });

  test("a chord across the corner is planned along the water", () => {
    const f = new PathFollower(stubMap(), opts(), stubStore());
    const p = f.plan(at(200, 0), at(400, 250), WATER);
    expect(p.length).toBeGreaterThan(2);
    expect(f.stats.paths).toBe(1);
  });

  test("below the gate, or for a train, there is no plan: a straight slide", () => {
    expect(new PathFollower(stubMap(13), opts(), stubStore()).plan(at(200, 0), at(400, 250), WATER)).toBeNull();
    expect(new PathFollower(stubMap(), opts(), stubStore()).plan(at(200, 0), at(400, 250), { map_layer: "rail" })).toBeNull();
  });

  test("off screen: no plan, no work", () => {
    const store = stubStore();
    const f = new PathFollower(stubMap(), opts(), store);
    expect(f.plan(at(200, 50000), at(400, 50250), WATER)).toBeNull();
    expect(store.calls.cell).toBe(0);
  });

  test("tiles not loaded, from the strict zoom (14): PLACED, never slid unchecked; tiles asked for", () => {
    // Changed 2026-10-05 (Lee: "4 clicks on + is absolutely mandatory"): this
    // pinned a straight slide at zoom 15 while the tiles loaded.
    const store = stubStore(() => false);
    const f = new PathFollower(stubMap(15), opts(), store);
    expect(f.plan(at(200, 0), at(400, 250), WATER)).toBe(PLACE);
    expect(store.requested.length).toBeGreaterThan(0);
    const g = new PathFollower(stubMap(14), opts(), stubStore(() => false));
    expect(g.plan(at(200, 0), at(400, 250), WATER)).toBe(PLACE);
  });

  test("tiles not loaded below the strict zoom (13, min zoom 13): a straight slide as before", () => {
    const store = stubStore(() => false);
    const f = new PathFollower(stubMap(13), opts({ minZoom: 13 }), store);
    expect(f.plan(at(200, 0), at(400, 250), WATER)).toBeNull();
    expect(store.requested.length).toBeGreaterThan(0);
    const g = new PathFollower(stubMap(13.9), opts({ minZoom: 13 }), stubStore(() => false));
    expect(g.plan(at(200, 0), at(400, 250), WATER)).toBeNull();
  });

  test("at zoom 13 with min zoom 13, water IS followed when the tiles are there", () => {
    const f = new PathFollower(stubMap(13), opts({ minZoom: 13 }), stubStore());
    expect(f.applies(WATER)).toBe(true);
    expect(f.plan(at(200, 0), at(400, 250), WATER).length).toBeGreaterThan(2);
  });

  test("path_strict_zoom moves the strict line; nonsense keeps 14; an options object without it means 14", () => {
    expect(parsePathOptions({}).strictZoom).toBe(14);
    expect(DEFAULT_STRICT_ZOOM).toBe(14);
    expect(parsePathOptions({ path_strict_zoom: 16 }).strictZoom).toBe(16);
    expect(parsePathOptions({ path_strict_zoom: "x" }).strictZoom).toBe(14);
    const old = { enabled: true, minZoom: 14, sources: parsePathOptions({}).sources };
    expect(new PathFollower(stubMap(14), old, stubStore(() => false)).plan(at(200, 0), at(400, 250), WATER)).toBe(PLACE);
    const raised = new PathFollower(stubMap(15), opts({ strictZoom: 16 }), stubStore(() => false));
    expect(raised.plan(at(200, 0), at(400, 250), WATER)).toBeNull();
  });

  test("tiles not loaded and the store stopped (429): nothing is asked for", () => {
    const store = stubStore(() => false);
    store.running = false;
    const f = new PathFollower(stubMap(), opts(), store);
    f.plan(at(200, 0), at(400, 250), WATER);
    f.place(at(0, 70), WATER);
    f.want(at(0, 0), WATER);
    expect(store.requested).toEqual([]);
  });

  const HELD = { map_layer: "water", icon_rotation_basis: "held", speed_kmh: 10 };
  const SLOW = { map_layer: "water", speed_kmh: AT_REST_KMH - 0.1 };

  test("an at-rest move is jitter only under 30 m (Lee, 2026-09-29)", () => {
    expect(REST_MAX_CHORD_M).toBe(30);
  });

  test.each([["held", HELD], ["under 1 km/h", SLOW]])(
    "at rest (%s), a move under 30 m: no routing, a straight slide ending in the water", (_, attrs) => {
      const f = new PathFollower(stubMap(), opts(), stubStore());
      const p = f.plan(at(100, 10), at(110, 30), attrs); // 22 m; the fix 10 m up the bank
      expect(p).toHaveLength(2);
      expect(xy(p[1]).y).toBeLessThanOrEqual(21);
      expect(f.stats.rest).toBe(1);
      expect(f.stats.paths).toBe(0);
    });

  test.each([["held", HELD], ["under 1 km/h", SLOW]])(
    "at rest (%s), a move of 30 m or more is an arrival: routed round the corner", (_, attrs) => {
      const f = new PathFollower(stubMap(), opts(), stubStore());
      const p = f.plan(at(200, 0), at(460, 250), attrs);
      expect(p.length).toBeGreaterThan(2);
      expect(f.stats.paths).toBe(1);
      expect(f.stats.rest).toBe(0);
    });

  test.each([["held", HELD], ["under 1 km/h", SLOW]])(
    "at rest (%s): 29 m is jitter, 31 m is not", (_, attrs) => {
      const f = new PathFollower(stubMap(), opts(), stubStore());
      f.plan(at(0, 0), at(29, 0), attrs);
      expect(f.stats.rest).toBe(1);
      f.plan(at(0, 0), at(31, 0), attrs);
      expect(f.stats.rest).toBe(1);
      expect(f.stats.straight).toBe(1);
    });

  // A harbour behind a breakwater: lake east of x = 15 m, harbour west of x = 0,
  // the wall between them open only north of y = gap.
  const harbour = (gap) => (x, y) => Math.abs(y) <= 1500 && x >= -600 && x <= 800 && (x < 0 || x > 15 || y >= gap);
  const harbourStore = (gap) => {
    const g = makeGrid(harbour(gap));
    return Object.assign(g, {
      running: true, used: new Set(), listeners: new Set(), tileListeners: new Set(),
      requested: [], request(tiles) { this.requested.push(...tiles); },
    });
  };

  test("the wider look is 1,200 m and 'place' is the placement answer", () => {
    expect(WIDE_MARGIN_M).toBe(1200);
    expect(PLACE).toBe("place");
  });

  test("the way into a harbour outside the first window is found by the wider look", () => {
    const f = new PathFollower(stubMap(), opts(), harbourStore(500));
    const p = f.plan(at(400, 0), at(-400, 0), WATER);
    expect(Array.isArray(p) && p.length).toBeGreaterThan(2);
    expect(Math.max(...p.map((q) => xy(q).y))).toBeGreaterThan(480);
    expect(f.stats.wide).toBe(1);
    expect(f.stats.paths).toBe(1);
  });

  test("no way round within the cap: placed, never slid across the breakwater", () => {
    const f = new PathFollower(stubMap(), opts(), harbourStore(1000));
    expect(f.plan(at(400, 0), at(-400, 0), WATER)).toBe(PLACE);
    expect(f.stats.refused).toBe(1);
    expect(f.stats.wide).toBe(1);
  });

  test("a sealed harbour: placed", () => {
    const f = new PathFollower(stubMap(), opts(), harbourStore(99999));
    expect(f.plan(at(400, 0), at(-400, 0), WATER)).toBe(PLACE);
  });

  test("the wider look happens only on refusal", () => {
    const f = new PathFollower(stubMap(), opts(), stubStore());
    f.plan(at(200, 0), at(400, 250), WATER);
    expect(f.stats.wide).toBe(0);
  });

  test("no speed at all is not 'at rest'", () => {
    const f = new PathFollower(stubMap(), opts(), stubStore());
    expect(f.plan(at(200, 0), at(400, 250), { map_layer: "water" }).length).toBeGreaterThan(2);
  });

  test("place: a fix on land is drawn in the water; a fix in the water is left alone", () => {
    const f = new PathFollower(stubMap(), opts(), stubStore());
    const onLand = at(0, 70), inWater = at(0, 5);
    const drawn = f.place(onLand, WATER);
    expect(Math.abs(xy(drawn).y)).toBeLessThanOrEqual(21);
    expect(f.place(inWater, WATER)).toBe(inWater);
    expect(f.place(onLand, { map_layer: "rail" })).toBe(onLand);
  });

  test("attribution goes on the map for each source whose data is used, once", () => {
    const store = stubStore();
    store.used.add("openstreetmap");
    const map = stubMap();
    const f = new PathFollower(map, opts(), store);
    expect(map.attributions).toEqual([DEFAULT_SOURCES[0].attribution]);
    for (const fn of store.listeners) { fn("openfreemap"); fn("openfreemap"); }
    expect(map.attributions).toEqual([DEFAULT_SOURCES[0].attribution, DEFAULT_SOURCES[1].attribution]);
    f.dispose();
    expect(store.listeners.size).toBe(0);
  });

  test("a throw inside routing is a straight slide, never an error", () => {
    const store = stubStore();
    store.cell = () => { throw new Error("boom"); };
    const f = new PathFollower(stubMap(), opts(), store);
    expect(f.plan(at(200, 0), at(400, 250), WATER)).toBeNull();
    expect(f.place(at(0, 70), WATER)).toEqual(at(0, 70));
  });
});
