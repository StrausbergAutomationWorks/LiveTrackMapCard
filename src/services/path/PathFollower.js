/**
 * Path-following for one map (item 270 part 2). The glue between a card's
 * map and the renderer-independent pieces: the router (router.js) and the
 * shared water tiles (TileStore.js). An Entity asks it for a slide plan; it
 * answers with lat/lng points, or null for today's straight slide.
 *
 * Decided by Lee, 2026-09-29 (card SSOT 40): ON by default; from zoom 14 up
 * (`path_min_zoom`); water now, rail when item 209 is settled. A fix on land
 * is DRAWN in the nearest water - never written anywhere, state and recorder
 * keep the real fix.
 */
import { TileStore } from "./TileStore.js";
import { DEFAULT_MIN_ZOOM, DEFAULT_STRICT_ZOOM, DEFAULT_SOURCES, parsePathOptions } from "./options.js";
import { routeWater, snapToWater, tilesForChord, DEFAULTS } from "./router.js";
import { fromCell, haversine } from "./mercator.js";
import { PLACE } from "./place.js";

export { PLACE };

export { DEFAULT_MIN_ZOOM, DEFAULT_SOURCES, parsePathOptions };

/** Below this reported speed a boat is at rest: its moves are jitter, not travel. */
export const AT_REST_KMH = 1;

/**
 * An at-rest move shorter than this is jitter and is not routed; a longer one
 * is a boat easing into or out of its slip, and is routed (Lee, 2026-09-29,
 * after ROBERT H left its dock across the neighbourhood). River capture: 920
 * at-rest moves under 30 m; 148 of 30 m or more, 85 of them 100-965 m.
 */
export const REST_MAX_CHORD_M = 30;

/**
 * The second, wider look when the first finds no water path (Lee, 2026-09-29):
 * DuSable Harbor's opening is some 400 m north of its south end, outside the
 * first window of max(300 m, 0.6 x chord) for a boat coming in from the lake.
 * Only on refusal; 20-50 ms in plain node on the river tiles.
 */
export const WIDE_MARGIN_M = 1200;

const stores = new Map();

/**
 * One store per list of sources, shared by every card on the page, so two
 * cards never fetch the same tile twice.
 * @param {Array} sources
 * @returns {TileStore}
 */
export function sharedStore(sources) {
  const key = JSON.stringify(sources.map((s) => [s.id, s.tilejson, s.tiles, s.schema]));
  let s = stores.get(key);
  if (!s) {
    const listeners = new Set();
    const tileListeners = new Set();
    s = new TileStore({
      sources,
      onSourceUsed: (id) => listeners.forEach((fn) => fn(id)),
      onTile: () => tileListeners.forEach((fn) => fn()),
    });
    s.listeners = listeners;
    s.tileListeners = tileListeners;
    stores.set(key, s);
  }
  return s;
}

/** For tests. */
export function _resetStores() { stores.clear(); }


export class PathFollower {
  /**
   * @param {object} map a Leaflet map, or anything with getZoom, getBounds, attributionControl
   * @param {{enabled: boolean, minZoom: number, sources: Array}} options
   * @param {TileStore} [store]
   */
  constructor(map, options, store = null) {
    this.map = map;
    this.options = options;
    this.store = store ?? sharedStore(options.sources);
    this.stats = { plans: 0, paths: 0, straight: 0, refused: 0, missing: 0, rest: 0, wide: 0, ms: [] };
    this._attributed = new Set();
    this._onSource = (id) => this._attribute(id);
    this.store.listeners?.add(this._onSource);
    for (const id of this.store.used) this._attribute(id);
  }

  dispose() {
    this.store.listeners?.delete(this._onSource);
    for (const fn of this._tileFns ?? []) this.store.tileListeners?.delete(fn);
    this._tileFns = [];
  }

  /**
   * Call `fn` when water tiles arrive, at most every 250 ms.
   * @param {function(): void} fn
   */
  onTiles(fn) {
    let timer = null;
    const throttled = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; try { fn(); } catch { /* never stops the map */ } }, 250);
    };
    this._tileFns = [...(this._tileFns ?? []), throttled];
    this.store.tileListeners?.add(throttled);
  }

  _attribute(id) {
    if (this._attributed.has(id)) return;
    const src = this.options.sources.find((s) => s.id === id);
    if (!src?.attribution) return;
    try {
      this.map?.attributionControl?.addAttribution?.(src.attribution);
      this._attributed.add(id);
    } catch { /* no attribution control: nothing to write to */ }
  }

  /**
   * Does this entity follow paths at the map's current zoom?
   * @param {object} attributes
   * @returns {boolean}
   */
  applies(attributes) {
    if (!this.options.enabled || !attributes) return false;
    if (attributes.map_layer !== "water") return false;
    const z = this.map?.getZoom?.();
    return Number.isFinite(z) && z >= this.options.minZoom;
  }

  /**
   * Is the map at or above the strict zoom, where an unchecked move is
   * placed rather than slid?
   * @returns {boolean}
   */
  _strict() {
    const z = this.map?.getZoom?.();
    const strict = Number.isFinite(this.options.strictZoom) ? this.options.strictZoom : DEFAULT_STRICT_ZOOM;
    return Number.isFinite(z) && z >= strict;
  }

  _inView(points) {
    try {
      const b = this.map.getBounds().pad(0.25);
      let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
      for (const p of points) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lng); e = Math.max(e, p.lng); }
      return !(n < b.getSouth() || s > b.getNorth() || e < b.getWest() || w > b.getEast());
    } catch {
      return false;
    }
  }

  /**
   * Ask for the tiles round a position that is on screen. Fetch on view only.
   * @param {{lat: number, lng: number}} at
   * @param {object} attributes
   */
  want(at, attributes) {
    if (!at || !this.applies(attributes) || !this.store.running || !this._inView([at])) return;
    this.store.request(tilesForChord(at, at));
  }

  /**
   * Where to DRAW an object whose fix is `to`: the fix itself, or the nearest
   * water when the fix sits on land. Never changes what the entity says.
   * @param {{lat: number, lng: number}} to
   * @param {object} attributes
   * @returns {{lat: number, lng: number}}
   */
  place(to, attributes) {
    if (!to || !this.applies(attributes)) return to;
    try {
      const s = snapToWater(to, this.store, DEFAULTS.maxSnapM);
      if (s.status === "ok") return s.movedM > 0 ? fromCellLatLng(s) : to;
      if (s.status === "missing" && this.store.running && this._inView([to])) this.store.request(tilesForChord(to, to));
    } catch { /* nothing of ours may stop the map */ }
    return to;
  }

  /**
   * The points a slide from `from` (where the marker is drawn) to the fix
   * `to` should follow, first and last included, or null for a straight
   * slide to the fix as reported.
   * @param {{lat: number, lng: number}} from
   * @param {{lat: number, lng: number}} to
   * @param {object} attributes
   * @returns {Array<{lat: number, lng: number}>|string|null} PLACE when there
   * is no way round over water: place the marker, never slide it across land
   */
  plan(from, to, attributes) {
    if (!from || !to || !this.applies(attributes) || !this._inView([from, to])) return null;
    const t0 = now();
    try {
      this.stats.plans++;
      const speed = Number(attributes.speed_kmh);
      const atRest = (attributes.icon_rotation_basis === "held"
        || (attributes.speed_kmh !== undefined && attributes.speed_kmh !== null && Number.isFinite(speed) && speed < AT_REST_KMH))
        && haversine(from, to) < REST_MAX_CHORD_M;
      if (atRest) {
        // Jitter at a mooring is not a journey: no routing, but drawn in the water.
        // A longer move reported at rest is an arrival or a departure: routed below.
        this.stats.rest++;
        return [from, this.place(to, attributes)];
      }
      let r = routeWater(from, to, this.store);
      if (r.status === "refused" && r.reason === "no water path") {
        // The way round can lie outside the first window: look once more, wider.
        this.stats.wide++;
        const wide = routeWater(from, to, this.store, { marginM: WIDE_MARGIN_M, marginMaxM: WIDE_MARGIN_M });
        if (wide.status === "missing") {
          if (this.store.running) this.store.request(wide.tiles);
        } else {
          r = wide;
        }
      }
      if (r.status === "missing") {
        this.stats.missing++;
        if (this.store.running) this.store.request(r.tiles);
        // Water tiles not in yet: below the strict zoom slide straight as
        // before; from it, never slide on a chord nobody checked - place the
        // marker (Lee, 2026-10-05, "absolutely mandatory" from zoom 14).
        return this._strict() ? PLACE : null;
      }
      if (r.status === "path") this.stats.paths++;
      else if (r.status === "straight") this.stats.straight++;
      else {
        // No way round over water within the cap: never slide across land
        // (a refused chord is one that crosses it). The marker is placed.
        this.stats.refused++;
        return PLACE;
      }
      return r.points ?? null;
    } catch {
      return null;
    } finally {
      const ms = now() - t0;
      this.stats.ms.push(ms);
      if (this.stats.ms.length > 500) this.stats.ms.shift();
    }
  }
}

/** @returns {number} milliseconds, high resolution where there is one */
function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * @param {{gx: number, gy: number}} s
 * @returns {{lat: number, lng: number}}
 */
function fromCellLatLng(s) { return fromCell(s.gx, s.gy); }
