import L from "leaflet";
import Logger from "../../util/Logger.js";

/**
 * Shapes on the map (06_MAP_CONTRACT.md D12, backlog 277).
 *
 * A publisher is one entity whose `shapes_url` names a file of shapes by key
 * and whose `zones` say which keys to fill now, each with one event; it may
 * also send `polygons` drawn by their own geometry, `styles` (colour and
 * priority per event) and `attribution`. The card fetches each file once,
 * keeps it in memory only, and fills translucent shapes over the tiles and
 * under every marker, lowest priority first. Nothing here names a publisher.
 */

/** Colour and priority for an event the publisher sent no style for (D12 rule 8). */
export const UNKNOWN_STYLE = Object.freeze({ color: "#808080", priority: 999 });

/** A line's casing shows this many px either side of it (D12 as amended for D15). */
export const CASING_PX = 1;

/** After a failed fetch, the same URL is tried again no sooner than this (D12 rule 6). */
export const RETRY_MS = 10 * 60 * 1000;

/**
 * Defaults; `shape_style` in the card config overrides each. Chosen by Lee
 * from pictures of the real alerts, 2026-10-05: fill 0.25; outline 2 px at
 * 0.9, because a pale event colour (Small Craft Advisory) vanishes on water
 * with a light outline. SVG: canvas measured slower (card SSOT section 52).
 */
export const DEFAULT_SHAPE_STYLE = Object.freeze({
  fillOpacity: 0.25,
  weight: 2,
  opacity: 0.9,
  renderer: "svg",
  byPriority: false,
});

/**
 * @param {*} v
 * @returns {boolean} a plain object, not an array or null
 */
export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Whether an entity state is a publisher that can be drawn now (D12 rules 1, 9).
 * @param {object|undefined} state a Home Assistant state object
 * @returns {boolean}
 */
export function isPublisherState(state) {
  if (!state || state.state === "unavailable" || state.state === "unknown") return false;
  const a = state.attributes;
  // D12 rule 1 as amended for D15: a shape file, or `polygons` alone.
  return isPlainObject(a) && isPlainObject(a.zones) && (hasShapesUrl(a) || Array.isArray(a.polygons));
}

/**
 * @param {object} a attributes
 * @returns {boolean} a non-empty `shapes_url`
 */
function hasShapesUrl(a) {
  return typeof a.shapes_url === "string" && a.shapes_url !== "";
}

/**
 * A publisher's place among the others (D12 as amended for D16): `shape_order`, an
 * integer; a lower one is drawn beneath. Anything else is 0. Ties go by entity id.
 * @param {object} attributes
 * @returns {number}
 */
export function shapeOrderOf(attributes) {
  const o = attributes?.shape_order;
  return Number.isInteger(o) ? o : 0;
}

/**
 * Every publisher in the states, by attribute shape alone (D12 rule 1).
 * @param {object} states hass.states
 * @returns {string[]} entity ids, sorted
 */
export function discoverPublishers(states) {
  return Object.keys(states ?? {}).filter((id) => isPublisherState(states[id])).sort();
}

/**
 * `shape_layers`: absent or "auto" discovers; false turns it off; a list names
 * publishers as `{entity, name, show}` or a bare entity id.
 * @param {*} input
 * @returns {{mode: "auto"}|{mode: "off"}|{mode: "list", items: {entity: string, name: ?string, show: boolean}[]}}
 */
export function parseShapeLayersOption(input) {
  if (input === undefined || input === null || input === true || input === "auto") return { mode: "auto" };
  if (input === false || input === "off") return { mode: "off" };
  const list = Array.isArray(input) ? input : [input];
  const items = [];
  const seen = new Set();
  for (const raw of list) {
    const o = typeof raw === "string" ? { entity: raw } : raw;
    if (!isPlainObject(o) || typeof o.entity !== "string" || o.entity.trim() === "") {
      Logger.warn("[ShapeLayers] shape_layers entry ignored: needs an entity", raw);
      continue;
    }
    const entity = o.entity.trim();
    if (seen.has(entity)) continue;
    seen.add(entity);
    items.push({
      entity,
      name: typeof o.name === "string" && o.name.trim() !== "" ? o.name.trim() : null,
      show: o.show !== false,
    });
  }
  return { mode: "list", items };
}

/**
 * `shape_style`: snake_case keys in YAML, each optional.
 * @param {*} input
 * @returns {{fillOpacity: number, weight: number, opacity: number, renderer: string, byPriority: boolean}}
 */
export function parseShapeStyle(input) {
  const s = { ...DEFAULT_SHAPE_STYLE };
  if (!isPlainObject(input)) return s;
  const frac = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  if (frac(input.fill_opacity)) s.fillOpacity = input.fill_opacity;
  if (frac(input.opacity)) s.opacity = input.opacity;
  if (typeof input.weight === "number" && Number.isFinite(input.weight) && input.weight >= 0) s.weight = input.weight;
  if (input.renderer === "canvas" || input.renderer === "svg") s.renderer = input.renderer;
  if (typeof input.by_priority === "boolean") s.byPriority = input.by_priority;
  return s;
}

/**
 * Colour and priority for one event (D12 rule 8), and its optional `casing`:
 * a colour drawn beneath a line, CASING_PX either side (D12 as amended for D15).
 * @param {string} event
 * @param {object} styles the publisher's `styles`
 * @returns {{color: string, priority: number, casing?: string}}
 */
export function styleFor(event, styles) {
  const s = isPlainObject(styles) ? styles[event] : undefined;
  const color = isPlainObject(s) && typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : null;
  const priority = isPlainObject(s) && Number.isInteger(s.priority) ? s.priority : null;
  if (color === null || priority === null) return { ...UNKNOWN_STYLE };
  const casing = typeof s.casing === "string" && /^#[0-9a-fA-F]{6}$/.test(s.casing) ? s.casing : null;
  return casing ? { color, priority, casing } : { color, priority };
}

const AREA_TYPES = new Set(["Polygon", "MultiPolygon"]);

/**
 * @param {*} g
 * @returns {boolean} a GeoJSON Polygon or MultiPolygon with coordinates
 */
function isArea(g) {
  return isPlainObject(g) && AREA_TYPES.has(g.type) && Array.isArray(g.coordinates);
}

const LINE_TYPES = new Set(["LineString", "MultiLineString"]);

/**
 * @param {*} g
 * @returns {boolean} a GeoJSON LineString or MultiLineString (D12 as amended for D15)
 */
export function isLine(g) {
  return isPlainObject(g) && LINE_TYPES.has(g.type) && Array.isArray(g.coordinates);
}

/**
 * The list to draw, in drawing order (D12 rules 3, 5, 7, 8): largest priority
 * first, 1 last; within a priority zones before polygons; zones by key,
 * polygons in the order sent.
 * @param {object} attributes the publisher's attributes
 * @param {?object} shapes the file's `shapes`, or null before it arrives
 * @returns {{items: {kind: string, key: ?string, event: string, geometry: object, color: string, priority: number}[], missing: string[]}}
 */
export function buildDrawList(attributes, shapes) {
  const items = [];
  const missing = [];
  const styles = attributes?.styles;
  if (isPlainObject(shapes) && isPlainObject(attributes?.zones)) {
    for (const key of Object.keys(attributes.zones).sort()) {
      const event = attributes.zones[key];
      if (typeof event !== "string") continue;
      const geometry = shapes[key];
      if (!isArea(geometry)) { missing.push(key); continue; }
      items.push({ kind: "zone", key, event, geometry, ...styleFor(event, styles) });
    }
  }
  const polygons = Array.isArray(attributes?.polygons) ? attributes.polygons : [];
  polygons.forEach((p) => {
    if (!isPlainObject(p) || typeof p.event !== "string" || !(isArea(p) || isLine(p))) return;
    items.push({ kind: isLine(p) ? "line" : "polygon", key: null, event: p.event, geometry: { type: p.type, coordinates: p.coordinates }, ...styleFor(p.event, styles) });
  });
  const kindRank = { zone: 0, polygon: 1, line: 2 };
  const order = items.map((it, i) => [it, i]);
  order.sort(([a, ia], [b, ib]) => (b.priority - a.priority) || (kindRank[a.kind] - kindRank[b.kind]) || ia - ib);
  return { items: order.map(([it]) => it), missing };
}

/**
 * Fill opacity per item. By priority (a picture variant): the drawn events'
 * priorities split in three, the most important third strongest.
 * @param {object[]} items from buildDrawList
 * @param {object} style from parseShapeStyle
 * @returns {number[]}
 */
export function fillOpacities(items, style) {
  if (!style.byPriority) return items.map(() => style.fillOpacity);
  const ps = [...new Set(items.map((i) => i.priority))].sort((a, b) => a - b);
  return items.map((i) => {
    const rank = ps.length <= 1 ? 0 : ps.indexOf(i.priority) / (ps.length - 1);
    if (rank < 1 / 3) return Math.min(1, style.fillOpacity + 0.1);
    if (rank < 2 / 3) return style.fillOpacity;
    return Math.max(0, style.fillOpacity - 0.1);
  });
}

/**
 * Parsed files, by URL, for the life of the page: a card rebuilt by a view
 * change finds the file it already parsed. Never browser storage.
 * @type {Map<string, {status: string, shapes?: object, failedAt?: number, promise?: Promise}>}
 */
const files = new Map();
/** Keys already warned about as missing from their file, for the life of the page. */
const warnedKeys = new Set();

/** For tests. */
export function _resetShapeCache() {
  files.clear();
  warnedKeys.clear();
}

/**
 * Validate a parsed file (D12 rule 6).
 * @param {*} json
 * @returns {?object} its `shapes`, or null
 */
export function shapesOf(json) {
  return isPlainObject(json) && isPlainObject(json.shapes) ? json.shapes : null;
}

export default class ShapeLayersService {
  /**
   * @param {L.Map} map
   * @param {*} option the card's `shape_layers`
   * @param {*} styleOption the card's `shape_style`
   * @param {{addOverlay: Function, removeOverlay: Function}} overlays the layer control (TileLayersService)
   * @param {{fetch?: Function, now?: Function}} [deps] for tests
   */
  constructor(map, option, styleOption, overlays, deps = {}) {
    this.map = map;
    this.option = parseShapeLayersOption(option);
    this.style = parseShapeStyle(styleOption);
    this.overlays = overlays;
    this.fetch = deps.fetch ?? ((...a) => globalThis.fetch(...a));
    this.now = deps.now ?? (() => Date.now());
    this.hass = null;
    this.renderer = null;
    /** @type {Map<string, {group: object, url: ?string, state: ?object, fileStatus: ?string, drawn: number}>} */
    this.publishers = new Map();
    this.disposed = false;
  }

  /** @returns {object} the Leaflet renderer every shape shares */
  _renderer() {
    if (!this.renderer) {
      this.renderer = this.style.renderer === "canvas" ? L.canvas({ pane: "overlayPane" }) : L.svg({ pane: "overlayPane" });
    }
    return this.renderer;
  }

  /**
   * Called on every card render. Redraws a publisher only when its state
   * object changed or its file arrived; never throws.
   * @param {object} hass
   */
  render(hass) {
    if (this.disposed) return;
    try {
      if (hass) this.hass = hass;
      const states = this.hass?.states ?? {};
      const wanted = this._wanted(states);
      for (const id of [...this.publishers.keys()]) {
        if (!wanted.has(id)) this._forget(id);
      }
      for (const [id, item] of wanted) this._update(id, item, states[id]);
    } catch (e) {
      Logger.error("[ShapeLayers] render failed; markers unaffected", e);
    }
  }

  /**
   * @param {object} states
   * @returns {Map<string, {name: ?string, show: boolean}>} publishers to keep a checkbox for
   */
  _wanted(states) {
    const out = new Map();
    if (this.option.mode === "off") return out;
    if (this.option.mode === "auto") {
      for (const id of discoverPublishers(states)) out.set(id, { name: null, show: true });
      return out;
    }
    // A named entity keeps its checkbox while it exists, drawn or not.
    for (const it of this.option.items) {
      if (states[it.entity]) out.set(it.entity, { name: it.name, show: it.show });
    }
    return out;
  }

  /**
   * @param {string} id
   * @param {{name: ?string, show: boolean}} item
   * @param {object} state
   */
  _update(id, item, state) {
    let p = this.publishers.get(id);
    if (!p) {
      const attribution = typeof state?.attributes?.attribution === "string" ? state.attributes.attribution : undefined;
      const group = L.layerGroup([], attribution ? { attribution } : {});
      const name = item.name ?? (typeof state?.attributes?.friendly_name === "string" && state.attributes.friendly_name) ?? id;
      this.overlays.addOverlay(group, name || id, item.show);
      p = { group, url: null, state: null, fileStatus: null, drawn: 0, order: 0 };
      this.publishers.set(id, p);
      // A re-ticked box puts its shapes back on top: restore the order (D16).
      const added = p;
      group.on("add", () => this._restack(added));
    }
    if (!isPublisherState(state)) {
      if (p.drawn || p.state) this._clear(p);
      p.state = null;
      p.url = null;
      return;
    }
    const url = hasShapesUrl(state.attributes) ? state.attributes.shapes_url : null;
    if (p.url !== null && p.url !== url) files.delete(p.url);
    p.url = url;
    // No shape file (D15's storms): nothing fetched, `polygons` drawn alone.
    const file = url ? this._file(url, id) : { status: "none" };
    const fileStatus = file.status;
    if (p.state === state && p.fileStatus === fileStatus) return;
    p.state = state;
    p.fileStatus = fileStatus;
    p.order = shapeOrderOf(state.attributes);
    this._draw(p, state.attributes, fileStatus === "ok" ? file.shapes : null);
    this._restack(p);
  }

  /**
   * A publisher just drawn (or re-added) lands on top of every other. Bring each one
   * ranked above it back to the front, lowest first, so the stack is in `shape_order`
   * again (D12 as amended for D16). Nothing moves when it is the top one.
   * @param {object} p the publisher record
   */
  _restack(p) {
    const ranked = [...this.publishers.entries()]
      .sort(([ia, a], [ib, b]) => (a.order - b.order) || (ia < ib ? -1 : ia > ib ? 1 : 0))
      .map(([, q]) => q);
    for (const q of ranked.slice(ranked.indexOf(p) + 1)) q.group.eachLayer((l) => l.bringToFront());
  }

  /**
   * The file for a URL: fetched once, retried after RETRY_MS on failure.
   * @param {string} url
   * @param {string} id the publisher, for the log
   * @returns {{status: string, shapes?: object}}
   */
  _file(url, id) {
    let f = files.get(url);
    if (f && (f.status !== "failed" || this.now() - f.failedAt < RETRY_MS)) {
      if (f.status === "loading") f.listeners.add(this);
      return f;
    }
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    f = { status: "loading", listeners: new Set([this]), ctl };
    files.set(url, f);
    const entry = f;
    let request;
    try {
      request = Promise.resolve(this.fetch(url, { credentials: "same-origin", signal: ctl?.signal }));
    } catch (e) {
      request = Promise.reject(e);
    }
    entry.promise = request
      .then((r) => {
        if (!r || !r.ok) throw new Error(`HTTP ${r?.status}`);
        return r.json();
      })
      .then((json) => {
        const shapes = shapesOf(json);
        if (!shapes) throw new Error("no shapes mapping");
        entry.status = "ok";
        entry.shapes = shapes;
      })
      .catch((e) => {
        if (e?.name === "AbortError") {
          if (files.get(url) === entry) files.delete(url);
          return;
        }
        entry.status = "failed";
        entry.failedAt = this.now();
        Logger.warn(`[ShapeLayers] shape file for ${id} not loaded (${url}): ${e?.message ?? e}; polygons only, retry in 10 min or on a new URL`);
      })
      .finally(() => {
        const waiting = [...entry.listeners];
        entry.listeners.clear();
        entry.ctl = null;
        if (files.get(url) !== entry) return;
        for (const svc of waiting) if (!svc.disposed) svc.render();
      });
    return entry;
  }

  /**
   * @param {object} p the publisher record
   * @param {object} attributes
   * @param {?object} shapes
   */
  _draw(p, attributes, shapes) {
    p.group.clearLayers();
    const { items, missing } = buildDrawList(attributes, shapes);
    for (const key of missing) {
      if (warnedKeys.has(key)) continue;
      warnedKeys.add(key);
      Logger.warn(`[ShapeLayers] key ${key} is not in the shape file; skipped`);
    }
    const opacities = fillOpacities(items, this.style);
    const renderer = this._renderer();
    items.forEach((it, i) => {
      const feature = { type: "Feature", properties: {}, geometry: it.geometry };
      if (it.kind === "line" && it.casing) {
        p.group.addLayer(L.geoJSON(feature, {
          interactive: false,
          renderer,
          style: () => ({ color: it.casing, weight: this.style.weight + 2 * CASING_PX, opacity: this.style.opacity, fill: false }),
        }));
      }
      p.group.addLayer(L.geoJSON(feature, {
        interactive: false,
        renderer,
        style: () => (it.kind === "line"
          ? { color: it.color, weight: this.style.weight, opacity: this.style.opacity, fill: false }
          : {
            color: it.color,
            fillColor: it.color,
            weight: this.style.weight,
            opacity: this.style.opacity,
            fillOpacity: opacities[i],
          }),
      }));
    });
    p.drawn = items.length;
  }

  /** @param {object} p */
  _clear(p) {
    p.group.clearLayers();
    p.drawn = 0;
    p.fileStatus = null;
  }

  /** @param {string} id */
  _forget(id) {
    const p = this.publishers.get(id);
    if (!p) return;
    p.group.clearLayers();
    this.overlays.removeOverlay(p.group);
    p.group.remove();
    this.publishers.delete(id);
  }

  /**
   * On teardown: stop waiting on any file, aborting a fetch no other card
   * waits on; remove every layer. Parsed files stay for the page.
   */
  cleanup() {
    this.disposed = true;
    for (const f of files.values()) {
      if (!f.listeners?.delete(this)) continue;
      if (f.status === "loading" && f.listeners.size === 0) {
        try { f.ctl?.abort(); } catch { /* nothing to do */ }
      }
    }
    for (const id of [...this.publishers.keys()]) {
      try { this._forget(id); } catch (e) { Logger.error("[ShapeLayers] cleanup", e); }
    }
  }
}
