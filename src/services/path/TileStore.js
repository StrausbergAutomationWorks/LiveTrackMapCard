/**
 * Water tiles for path-following (item 270 part 2, card SSOT 41.1).
 *
 * Fetches z14 vector tiles ON VIEW ONLY - the tiles a moving marker's chord
 * needs, never an area ahead of viewing - rasterises them into the global
 * water grid (mercator.js) and keeps them 7 days. Sources are tried in
 * order, PRIMARY first (OpenStreetMap's own vector tiles, Shortbread since
 * Lee's swap of 2026-09-29), the fail-safe after (OpenFreeMap, OpenMapTiles).
 *
 * Switch rules, per page life:
 *  - TileJSON unreachable, network error, HTTP 5xx, timeout or a tile that
 *    will not decode: fail over to the next source.
 *  - HTTP 404: no tile here. Not a failure; the tile is marked absent.
 *  - HTTP 429 from ANY source: stop fetching for the rest of the page's life
 *    (06_MAP_CONTRACT D7a: a volunteer telling us to go away). No retry.
 *  - Every source failed: stop; markers slide straight, as before.
 * Nothing in here throws to the caller.
 */
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { ADAPTERS } from "./adapters.js";
import { rasteriseTile, encodeRuns, decodeRuns } from "./rasterize.js";
import { CELLS_PER_TILE, TILE_ZOOM, fromCell, metresPerCell } from "./mercator.js";
import { DEFAULT_SOURCES } from "./options.js";

export { DEFAULT_SOURCES };

/** Bump when an adapter or the rasteriser changes what a stored tile means. */
// 2 since 2026-09-29: piers and breakwaters are HARD cells and the store keeps
// (value, length) pairs; version 1 records are never read again.
export const WATER_TILE_VERSION = 2;
export const CACHE_DAYS = 7;
export const PIER_LINE_HALF_WIDTH_M = 3;


const TIMEOUT_MS = 10000;
const MAX_IN_FLIGHT = 2;
const MEMORY_TILES = 64;

class FailOver extends Error {}

/**
 * Decode one tile's bytes into its water grid.
 * @param {ArrayBuffer} bytes
 * @param {string} schema 'shortbread' or 'openmaptiles'
 * @param {number} tx
 * @param {number} ty
 * @returns {Uint8Array}
 */
export function decodeWaterTile(bytes, schema, tx, ty) {
  const adapter = ADAPTERS[schema];
  if (!adapter) throw new Error(`unknown schema ${schema}`);
  const tile = new VectorTile(new PbfReader(new Uint8Array(bytes)));
  const lat = fromCell((tx + 0.5) * CELLS_PER_TILE, (ty + 0.5) * CELLS_PER_TILE).lat;
  return rasteriseTile(adapter(tile), CELLS_PER_TILE, PIER_LINE_HALF_WIDTH_M / metresPerCell(lat));
}

/**
 * A 7-day store in IndexedDB, which (unlike the Cache API) also works on a
 * plain-http Home Assistant. Every call is wrapped: private windows, blocked
 * site data and old WebViews make it fail, and then the store just misses.
 * @returns {{get: function(string): Promise<any>, put: function(string, any): Promise<void>}|null}
 */
export function indexedDbStorage() {
  let dbp = null;
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        const req = globalThis.indexedDB.open("live-track-map-card-water", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("tiles");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
    return dbp;
  };
  const run = (mode, fn) => open().then((db) => new Promise((resolve) => {
    if (!db) return resolve(undefined);
    try {
      const tx = db.transaction("tiles", mode);
      const req = fn(tx.objectStore("tiles"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  }));
  if (typeof globalThis.indexedDB === "undefined") return null;
  return {
    get: (key) => run("readonly", (s) => s.get(key)),
    put: (key, value) => run("readwrite", (s) => s.put(value, key)).then(() => undefined),
  };
}

export class TileStore {
  /**
   * @param {object} [opts]
   * @param {Array} [opts.sources] tried in order; DEFAULT_SOURCES if absent
   * @param {Function} [opts.fetchImpl]
   * @param {object|null} [opts.storage] {get, put}; indexedDbStorage() if undefined
   * @param {function(): number} [opts.now]
   * @param {function(string): void} [opts.onSourceUsed] a source's id, the first time its data is used
   * @param {function(): void} [opts.onTile] a tile became available
   */
  constructor(opts = {}) {
    this.sources = (opts.sources?.length ? opts.sources : DEFAULT_SOURCES).map((s) => ({ ...s, template: s.tiles ?? null }));
    this.fetchImpl = opts.fetchImpl ?? ((...a) => globalThis.fetch(...a));
    this.storage = opts.storage === undefined ? indexedDbStorage() : opts.storage;
    this.now = opts.now ?? (() => Date.now());
    this.onSourceUsed = opts.onSourceUsed ?? (() => {});
    this.onTile = opts.onTile ?? (() => {});
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
    this.active = 0;
    /** 'running', 'stopped-429' or 'exhausted' */
    this.state = "running";
    this.grids = new Map();      // "x/y" -> Uint8Array
    this.absent = new Set();     // "x/y" answered 404
    this.pending = new Set();
    this.queue = [];
    this.inFlight = 0;
    this.used = new Set();
    this.stats = { fetched: 0, fromStore: 0, failovers: 0, absent: 0, errors: 0 };
  }

  get running() { return this.state === "running"; }

  /**
   * @param {number} tx
   * @param {number} ty
   * @returns {boolean}
   */
  hasTile(tx, ty) { return this.grids.has(`${tx}/${ty}`); }

  /**
   * 1 water, 0 land, HARD (2) a pier or breakwater, -1 tile not loaded.
   * @param {number} gx integer global cell
   * @param {number} gy
   * @returns {number}
   */
  cell(gx, gy) {
    const tx = Math.floor(gx / CELLS_PER_TILE), ty = Math.floor(gy / CELLS_PER_TILE);
    let g;
    // Neighbouring cells are nearly always in the same tile: skip the lookup.
    if (tx === this._lastTx && ty === this._lastTy) g = this._lastGrid;
    else {
      g = this.grids.get(`${tx}/${ty}`);
      this._lastTx = tx; this._lastTy = ty; this._lastGrid = g;
    }
    if (!g) return -1;
    return g[(gy - ty * CELLS_PER_TILE) * CELLS_PER_TILE + (gx - tx * CELLS_PER_TILE)];
  }

  /**
   * Copy a window of the water grid into `out` (w x h, row-major, 1 water),
   * a tile row at a time: the router's hot path. False if a tile is missing.
   * @param {number} x0 global cell of the window's first column
   * @param {number} y0 global cell of its first row
   * @param {number} w
   * @param {number} h
   * @param {Uint8Array} out
   * @returns {boolean}
   */
  fillWindow(x0, y0, w, h, out) {
    const N = CELLS_PER_TILE;
    for (let ty = Math.floor(y0 / N); ty <= Math.floor((y0 + h - 1) / N); ty++) {
      for (let tx = Math.floor(x0 / N); tx <= Math.floor((x0 + w - 1) / N); tx++) {
        const g = this.grids.get(`${tx}/${ty}`);
        if (!g) return false;
        const cx0 = Math.max(x0, tx * N), cx1 = Math.min(x0 + w, (tx + 1) * N);
        const cy0 = Math.max(y0, ty * N), cy1 = Math.min(y0 + h, (ty + 1) * N);
        for (let gy = cy0; gy < cy1; gy++) {
          const src = (gy - ty * N) * N + (cx0 - tx * N);
          out.set(g.subarray(src, src + (cx1 - cx0)), (gy - y0) * w + (cx0 - x0));
        }
      }
    }
    return true;
  }

  /**
   * Ask for tiles; returns at once. Loaded, absent and pending tiles are
   * skipped, and nothing is fetched once the store has stopped.
   * @param {Array<{x: number, y: number}>} tiles
   */
  request(tiles) {
    for (const t of tiles) {
      const key = `${t.x}/${t.y}`;
      if (this.grids.has(key) || this.absent.has(key) || this.pending.has(key)) continue;
      this.pending.add(key);
      this.queue.push(t);
    }
    this._pump();
  }

  _pump() {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length) {
      const t = this.queue.shift();
      this.inFlight++;
      this._load(t).catch(() => { this.stats.errors++; }).finally(() => {
        this.pending.delete(`${t.x}/${t.y}`);
        this.inFlight--;
        this._pump();
      });
    }
  }

  _remember(key, grid) {
    this.grids.delete(key);
    this.grids.set(key, grid);
    while (this.grids.size > MEMORY_TILES) this.grids.delete(this.grids.keys().next().value);
    // cell()'s one-tile cache may hold a tile just evicted, or a miss just filled.
    this._lastTx = NaN;
    this.onTile();
  }

  _markUsed(id) {
    if (this.used.has(id)) return;
    this.used.add(id);
    this.onSourceUsed(id);
  }

  async _load(t) {
    const key = `${t.x}/${t.y}`;
    if (this.storage) {
      for (const src of this.sources) {
        let rec;
        try { rec = await this.storage.get(this._storeKey(src.id, t)); } catch { rec = undefined; }
        if (!rec || !Number.isFinite(rec.t) || this.now() - rec.t > CACHE_DAYS * 86400000) continue;
        const grid = decodeRuns(rec.runs ?? [], CELLS_PER_TILE * CELLS_PER_TILE);
        if (!grid) continue;
        this.stats.fromStore++;
        this._markUsed(src.id);
        this._remember(key, grid);
        return;
      }
    }
    while (this.running) {
      const at = this.active;
      const src = this.sources[at];
      if (!src) { this.state = "exhausted"; return; }
      let bytes;
      try {
        bytes = await this._fetchTile(src, t);
      } catch (e) {
        if (e === STOP) { this.state = "stopped-429"; return; }
        this._failOver(at);
        continue;
      }
      if (bytes === ABSENT) { this.absent.add(key); this.stats.absent++; return; }
      let grid;
      try {
        grid = decodeWaterTile(bytes, src.schema, t.x, t.y);
      } catch {
        this._failOver(at);
        continue;
      }
      this.stats.fetched++;
      this._markUsed(src.id);
      this._remember(key, grid);
      if (this.storage) {
        try {
          Promise.resolve(this.storage.put(this._storeKey(src.id, t), { t: this.now(), runs: encodeRuns(grid) })).catch(() => {});
        } catch { /* a store that fails just misses next time */ }
      }
      return;
    }
  }

  _failOver(from) {
    // Two tiles in flight on one source both fail: move on ONCE, not twice.
    if (this.active !== from) return;
    this.stats.failovers++;
    this.active++;
    if (this.active >= this.sources.length) this.state = "exhausted";
  }

  _storeKey(id, t) { return `v${WATER_TILE_VERSION}/${id}/${TILE_ZOOM}/${t.x}/${t.y}`; }

  async _get(url, as) {
    let res, timer;
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { ctl?.abort(); reject(new FailOver("timeout")); }, this.timeoutMs);
    });
    timeout.catch(() => {});
    try {
      res = await Promise.race([
        this.fetchImpl(url, { signal: ctl?.signal, credentials: "omit", referrerPolicy: "origin" }),
        timeout,
      ]);
    } catch (e) {
      throw e instanceof FailOver ? e : new FailOver(String(e));
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429) throw STOP;
    if (res.status === 404) return ABSENT;
    if (!res.ok) throw new FailOver(`HTTP ${res.status}`);
    try {
      return as === "json" ? await res.json() : await res.arrayBuffer();
    } catch {
      throw new FailOver("unreadable body");
    }
  }

  async _fetchTile(src, t) {
    if (!src.template) {
      src.templatePromise ??= this._get(src.tilejson, "json").then((tj) => {
        const tpl = tj !== ABSENT && Array.isArray(tj?.tiles) ? tj.tiles[0] : null;
        if (typeof tpl !== "string") throw new FailOver("TileJSON without tiles");
        src.template = tpl;
        return tpl;
      });
      try {
        await src.templatePromise;
      } catch (e) {
        src.templatePromise = null;
        throw e;
      }
    }
    const url = src.template.replace("{z}", String(TILE_ZOOM)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
    return this._get(url, "bytes");
  }
}

const STOP = new Error("HTTP 429: stop");
const ABSENT = Symbol("absent");
