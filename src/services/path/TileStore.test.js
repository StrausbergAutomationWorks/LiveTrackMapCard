/**
 * @jest-environment node
 */
import { TileStore, CACHE_DAYS, WATER_TILE_VERSION } from "./TileStore.js";
import { DEFAULT_SOURCES } from "./options.js";
import { encodeRuns } from "./rasterize.js";
import { SHORTBREAD_B64, OPENMAPTILES_B64, bytes } from "./fixtures.testhelper.js";

const T = { x: 4202, y: 6088 };
const OSM_TJ = DEFAULT_SOURCES[0].tilejson, OFM_TJ = DEFAULT_SOURCES[1].tilejson;
const OSM_TILE = "https://osm.test/{z}/{x}/{y}.mvt", OFM_TILE = "https://ofm.test/{z}/{x}/{y}.pbf";
const res = (status, body) => ({
  status, ok: status >= 200 && status < 300,
  json: async () => body, arrayBuffer: async () => body,
});

/**
 * A fake network. `rules(url)` returns a response, throws, or returns a
 * promise that never settles; every URL asked for is logged.
 * @param {function(string): object} rules
 * @returns {{log: Array<string>, fetchImpl: Function}}
 */
function net(rules) {
  const log = [];
  const fetchImpl = (url) => {
    log.push(url);
    return Promise.resolve().then(() => rules(url));
  };
  return { log, fetchImpl };
}
const healthy = (url) => {
  if (url === OSM_TJ) return res(200, { tiles: [OSM_TILE] });
  if (url === OFM_TJ) return res(200, { tiles: [OFM_TILE] });
  if (url.startsWith("https://osm.test/")) return res(200, bytes(SHORTBREAD_B64));
  if (url.startsWith("https://ofm.test/")) return res(200, bytes(OPENMAPTILES_B64));
  return res(404);
};
/**
 * @param {object} [seed]
 * @returns {object} a storage in a Map
 */
function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { m, get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); } };
}
/**
 * Wait until the store has nothing in flight.
 * @param {object} store
 */
async function settle(store) {
  for (let i = 0; i < 200 && (store.pending.size || store.inFlight); i++) await new Promise((r) => setTimeout(r, 0));
}
const make = (rules, extra = {}) => {
  const n = net(rules);
  const used = [];
  const store = new TileStore({ fetchImpl: n.fetchImpl, storage: memoryStorage(), onSourceUsed: (id) => used.push(id), ...extra });
  return { store, log: n.log, used };
};
const tileUrls = (log, host) => log.filter((u) => u.startsWith(`https://${host}.test/`));

describe("TileStore", () => {
  test("the primary answers: OpenStreetMap's tile is decoded, used, attributed and stored", async () => {
    const { store, log, used } = make(healthy);
    store.request([T]);
    await settle(store);
    expect(store.hasTile(T.x, T.y)).toBe(true);
    expect(store.cell(T.x * 512 + 50, T.y * 512 + 50)).toBe(1);
    expect(store.cell(T.x * 512 + 400, T.y * 512 + 50)).toBe(0);
    expect(store.cell((T.x + 1) * 512, T.y * 512)).toBe(-1);
    expect(used).toEqual(["openstreetmap"]);
    expect(tileUrls(log, "osm")).toEqual([`https://osm.test/14/${T.x}/${T.y}.mvt`]);
    expect(tileUrls(log, "ofm")).toEqual([]);
    expect(store.storage.m.has(`v${WATER_TILE_VERSION}/openstreetmap/14/${T.x}/${T.y}`)).toBe(true);
  });

  test.each([
    ["HTTP 5xx on a tile", (u) => (u.startsWith("https://osm.test/") ? res(503) : healthy(u))],
    ["a network error on a tile", (u) => { if (u.startsWith("https://osm.test/")) throw new TypeError("Failed to fetch"); return healthy(u); }],
    ["the TileJSON unreachable", (u) => { if (u === OSM_TJ) throw new TypeError("Failed to fetch"); return healthy(u); }],
    ["the TileJSON without tiles", (u) => (u === OSM_TJ ? res(200, {}) : healthy(u))],
    ["a tile that will not decode", (u) => (u.startsWith("https://osm.test/") ? res(200, new Uint8Array([0xff, 0xff, 0xff, 0xff]).buffer) : healthy(u))],
  ])("%s fails over to OpenFreeMap", async (_, rules) => {
    const { store, used } = make(rules);
    store.request([T]);
    await settle(store);
    expect(store.hasTile(T.x, T.y)).toBe(true);
    expect(store.active).toBe(1);
    expect(store.stats.failovers).toBe(1);
    expect(store.state).toBe("running");
    expect(used).toEqual(["openfreemap"]);
  });

  test("a timeout fails over", async () => {
    const { store } = make((u) => (u.startsWith("https://osm.test/") ? new Promise(() => {}) : healthy(u)), { timeoutMs: 20 });
    store.request([T]);
    for (let i = 0; i < 50 && !store.hasTile(T.x, T.y); i++) await new Promise((r) => setTimeout(r, 10));
    expect(store.hasTile(T.x, T.y)).toBe(true);
    expect(store.active).toBe(1);
  });

  test("HTTP 404 is no tile here: not a failure, and never asked again", async () => {
    const { store, log } = make((u) => (u.startsWith("https://osm.test/") ? res(404) : healthy(u)));
    store.request([T]);
    await settle(store);
    store.request([T]);
    await settle(store);
    expect(store.hasTile(T.x, T.y)).toBe(false);
    expect(store.active).toBe(0);
    expect(tileUrls(log, "osm")).toHaveLength(1);
    expect(tileUrls(log, "ofm")).toHaveLength(0);
  });

  test("HTTP 429 from the primary STOPS everything: no fail-over, no more requests", async () => {
    const { store, log } = make((u) => (u.startsWith("https://osm.test/") ? res(429) : healthy(u)));
    store.request([T]);
    await settle(store);
    store.request([{ x: T.x + 1, y: T.y }]);
    await settle(store);
    expect(store.state).toBe("stopped-429");
    expect(tileUrls(log, "osm")).toHaveLength(1);
    expect(tileUrls(log, "ofm")).toHaveLength(0);
    expect(log).not.toContain(OFM_TJ);
  });

  test("HTTP 429 on the primary's TileJSON stops too", async () => {
    const { store, log } = make((u) => (u === OSM_TJ ? res(429) : healthy(u)));
    store.request([T]);
    await settle(store);
    expect(store.state).toBe("stopped-429");
    expect(log).not.toContain(OFM_TJ);
  });

  test("HTTP 429 from the fail-safe while it stands in stops too", async () => {
    const { store } = make((u) => (u.startsWith("https://osm.test/") ? res(500) : u.startsWith("https://ofm.test/") ? res(429) : healthy(u)));
    store.request([T]);
    await settle(store);
    expect(store.state).toBe("stopped-429");
    expect(store.hasTile(T.x, T.y)).toBe(false);
  });

  test("both down: exhausted, and nothing is fetched after", async () => {
    const { store, log } = make((u) => res(u.endsWith("json") || u === OFM_TJ ? 200 : 502, { tiles: [u === OSM_TJ ? OSM_TILE : OFM_TILE] }));
    store.request([T]);
    await settle(store);
    const n = log.length;
    store.request([{ x: T.x + 1, y: T.y }]);
    await settle(store);
    expect(store.state).toBe("exhausted");
    expect(log.length).toBe(n);
  });

  test("two tiles failing together on the primary move to the fail-safe ONCE", async () => {
    const { store } = make((u) => (u.startsWith("https://osm.test/") ? res(503) : healthy(u)));
    store.request([T, { x: T.x + 1, y: T.y }]);
    await settle(store);
    expect(store.stats.failovers).toBe(1);
    expect(store.active).toBe(1);
    expect(store.state).toBe("running");
    expect(store.hasTile(T.x + 1, T.y)).toBe(true);
  });

  test("a stored tile under 7 days old is used without asking the network", async () => {
    const grid = new Uint8Array(512 * 512).fill(1);
    const key = `v${WATER_TILE_VERSION}/openstreetmap/14/${T.x}/${T.y}`;
    const { log, fetchImpl } = net(healthy);
    const store = new TileStore({ fetchImpl, storage: memoryStorage({ [key]: { t: 1000, runs: encodeRuns(grid) } }), now: () => 1000 + (CACHE_DAYS - 1) * 86400000 });
    store.request([T]);
    await settle(store);
    expect(store.cell(T.x * 512 + 400, T.y * 512 + 50)).toBe(1);
    expect(log).toEqual([]);
    expect(store.stats.fromStore).toBe(1);
  });

  test("a stored tile over 7 days old is fetched again", async () => {
    const grid = new Uint8Array(512 * 512).fill(1);
    const key = `v${WATER_TILE_VERSION}/openstreetmap/14/${T.x}/${T.y}`;
    const { log, fetchImpl } = net(healthy);
    const store = new TileStore({ fetchImpl, storage: memoryStorage({ [key]: { t: 1000, runs: encodeRuns(grid) } }), now: () => 1000 + (CACHE_DAYS + 1) * 86400000 });
    store.request([T]);
    await settle(store);
    expect(tileUrls(log, "osm")).toHaveLength(1);
    expect(store.cell(T.x * 512 + 400, T.y * 512 + 50)).toBe(0);
  });

  test("a storage that throws is a miss, not a failure", async () => {
    const { log, fetchImpl } = net(healthy);
    const store = new TileStore({ fetchImpl, storage: { get: async () => { throw new Error("blocked"); }, put: () => { throw new Error("blocked"); } } });
    store.request([T]);
    await settle(store);
    expect(store.hasTile(T.x, T.y)).toBe(true);
    expect(tileUrls(log, "osm")).toHaveLength(1);
  });

  test("a cell asked for before its tile arrived answers once the tile is in", async () => {
    const { store } = make(healthy);
    expect(store.cell(T.x * 512 + 50, T.y * 512 + 50)).toBe(-1);
    store.request([T]);
    await settle(store);
    expect(store.cell(T.x * 512 + 50, T.y * 512 + 50)).toBe(1);
  });

  test("fillWindow copies the same answers as cell(), across a tile edge, and refuses a gap", async () => {
    const { store } = make(healthy);
    store.request([T, { x: T.x + 1, y: T.y }]);
    await settle(store);
    const x0 = (T.x + 1) * 512 - 300, y0 = T.y * 512 + 100, w = 400, h = 30;
    const out = new Uint8Array(w * h);
    expect(store.fillWindow(x0, y0, w, h, out)).toBe(true);
    let differ = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (out[y * w + x] !== store.cell(x0 + x, y0 + y)) differ++;
    expect(differ).toBe(0);
    expect(out.reduce((s, v) => s + v, 0)).toBeGreaterThan(0);
    expect(store.fillWindow(x0, T.y * 512 - 5, w, h, new Uint8Array(w * h))).toBe(false);
  });

  test("the fetch sends no credentials and an origin referrer (OSMF policy: a valid Referer)", async () => {
    const seen = [];
    const store = new TileStore({ storage: null, fetchImpl: (u, init) => { seen.push(init); return Promise.resolve(healthy(u)); } });
    store.request([T]);
    await settle(store);
    expect(seen.every((i) => i.credentials === "omit" && i.referrerPolicy === "origin")).toBe(true);
  });
});

test("the stored tile format is version 2 (HARD cells, value-length pairs)", () => {
  expect(WATER_TILE_VERSION).toBe(2);
});
