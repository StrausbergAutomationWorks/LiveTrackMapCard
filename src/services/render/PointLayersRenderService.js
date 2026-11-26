import { escapeHtml } from "../../util/Html.js";
import L from "leaflet";
import Logger from "../../util/Logger.js";
import { apiPath } from "../../util/TrackLine.js";
import { INFO_POPUP } from "../../util/InfoPopup.js";
import { geometryTouchesArea } from "../../util/WeatherArea.js";
import { layerLabel } from "../../util/LayerLabel.js";
import { layerShown } from "../../util/LayerDefault.js";
import {
  isPointPublisherState, discoverPointPublishers, parsePointLayersOption, pointOrderOf, pointStyleFor, pointsOf,
  pointsUrlOf, visiblePoints, hitTest, pointPopupHtml,
} from "../../util/PointLayers.js";

/**
 * Points on the map (06_MAP_CONTRACT_OVERLAYS.md D19): one canvas of dots per publisher, in its own pane above
 * the D12 fills and below every marker, drawn when the view stops moving. The pane takes no pointer events; a map
 * click within a dot opens its popup. See util/PointLayers.js for the rules.
 */

export const POINTS_PANE = "ltmcPointsPane";
/** After a failed fetch, the same URL is tried again no sooner than this (D19 rule 6). */
export const POINT_RETRY_MS = 10 * 60 * 1000;
/** The canvas reaches this share of the view beyond each edge, so a short pan shows dots before the redraw. */
export const PAD = 0.15;

/**
 * The pane, made once per map, right after the overlay pane (the D12 fills) and so before the shadow, marker,
 * tooltip and popup panes. ⚠ Placed by DOM ORDER: this card forces every `.leaflet-pane` to `z-index: 0
 * !important` (MapCard's styles, from ha-map-card), so a z-index here would do nothing (measured on the D19 look
 * page: dots drew over a popup while the pane was last in the DOM). No pointer events.
 * @param {object} map
 * @returns {HTMLElement}
 */
export function pointsPane(map) {
  const pane = map.getPane(POINTS_PANE) ?? map.createPane(POINTS_PANE);
  const after = map.getPane("overlayPane");
  if (after?.parentNode && pane.previousSibling !== after) after.parentNode.insertBefore(pane, after.nextSibling);
  pane.style.pointerEvents = "none";
  return pane;
}

/**
 * A dot's picture for one style at a device pixel ratio: the colour, a 1 px outline when the style has one.
 * @param {{color: string, radius: number, outline: ?string}} st
 * @param {number} dpr
 * @returns {?HTMLCanvasElement}
 */
export function dotSprite(st, dpr) {
  const r = st.radius + (st.outline ? 1 : 0);
  const c = document.createElement("canvas");
  c.width = c.height = Math.ceil((2 * r + 2) * dpr);
  const g = c.getContext?.("2d");
  if (!g) return null;
  g.scale(dpr, dpr);
  g.beginPath();
  g.arc(r + 1, r + 1, st.radius, 0, 2 * Math.PI);
  g.fillStyle = st.color;
  g.fill();
  if (st.outline) {
    g.lineWidth = 1;
    g.strokeStyle = st.outline;
    g.stroke();
  }
  return c;
}

/**
 * One publisher's canvas, a Leaflet layer so the layer control can add and remove it.
 */
export const PointCanvasLayer = L.Layer.extend({
  initialize(options) {
    L.setOptions(this, options);
    this._data = null;
    this._styles = {};
    this._drawn = { n: 0 };
    this._sprites = new Map();
  },

  onAdd(map) {
    this._map = map;
    const pane = pointsPane(map);
    this._canvas = document.createElement("canvas");
    this._canvas.className = "ltmc-points";
    this._canvas.style.position = "absolute";
    pane.appendChild(this._canvas);
    map.on("moveend resize viewreset", this.redraw, this);
    map.on("zoomstart", this._hide, this);
    this.redraw();
  },

  onRemove(map) {
    map.off("moveend resize viewreset", this.redraw, this);
    map.off("zoomstart", this._hide, this);
    this._canvas?.remove();
    this._canvas = null;
    this._drawn = { n: 0 };
  },

  _hide() {
    if (this._canvas) this._canvas.style.visibility = "hidden";
  },

  /**
   * @param {?object} data from pointsOf, or null for nothing
   * @param {object} styles the publisher's `point_styles`
   */
  setData(data, styles) {
    this._data = data;
    this._styles = styles ?? {};
    this._sprites.clear();
    this.redraw();
  },

  /** @returns {number} dots drawn last time */
  drawnCount() {
    return this._drawn.n ?? 0;
  },

  _style(i) {
    const key = this._data.points[i][2];
    let st = this._styleCache?.get(key);
    if (!st) {
      if (!this._styleCache) this._styleCache = new Map();
      st = pointStyleFor(key, this._styles);
      this._styleCache.set(key, st);
    }
    return st;
  },

  redraw() {
    const map = this._map;
    const cv = this._canvas;
    if (!map || !cv) return;
    this._styleCache = new Map();
    const size = map.getSize();
    const padX = Math.round(size.x * PAD);
    const padY = Math.round(size.y * PAD);
    const box = { left: -padX, top: -padY, width: size.x + 2 * padX, height: size.y + 2 * padY };
    const dpr = globalThis.devicePixelRatio || 1;
    cv.width = Math.round(box.width * dpr);
    cv.height = Math.round(box.height * dpr);
    cv.style.width = `${box.width}px`;
    cv.style.height = `${box.height}px`;
    const o = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(cv, L.point(o.x + box.left, o.y + box.top));
    cv.style.visibility = "";
    const g = cv.getContext?.("2d");
    this._drawn = { n: 0 };
    if (!g || !this._data || !this._data.points.length) return;
    const origin = map.getPixelOrigin();
    const scale = map.options.crs.scale(map.getZoom());
    const view = { scale, ox: origin.x + o.x, oy: origin.y + o.y };
    let cell = 2;
    for (const s of Object.keys(this._styles)) cell = Math.max(cell, pointStyleFor(s, this._styles).radius);
    const drawn = visiblePoints(this._data, view, box, cell);
    this._drawn = drawn;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let k = 0; k < drawn.n; k++) {
      const st = this._style(drawn.i[k]);
      const key = `${st.color}${st.radius}${st.outline}`;
      let sp = this._sprites.get(key);
      if (sp === undefined) { sp = dotSprite(st, dpr); this._sprites.set(key, sp); }
      if (!sp) continue;
      const half = sp.width / dpr / 2;
      g.drawImage(sp, drawn.x[k] - box.left - half, drawn.y[k] - box.top - half, sp.width / dpr, sp.height / dpr);
    }
  },

  /**
   * @param {{x: number, y: number}} cp a container point
   * @returns {number} the point's index under it, or -1
   */
  hit(cp) {
    if (!this._data || !this._drawn.n) return -1;
    return hitTest(this._drawn, cp.x, cp.y, (i) => this._style(i).radius);
  },

  /**
   * @param {number} i
   * @returns {{latlng: number[], html: string}}
   */
  popupFor(i) {
    const p = this._data.points[i];
    return { latlng: [p[1], p[0]], html: pointPopupHtml(p, this._data.columns, this._style(i)) };
  },
});

export default class PointLayersService {
  /**
   * @param {object} map
   * @param {*} option the card's `point_layers`
   * @param {{addOverlay: Function, removeOverlay: Function}} overlays the layer control
   * @param {{now?: Function, area?: ?object}} [deps]
   */
  constructor(map, option, overlays, deps = {}) {
    this.map = map;
    this.option = parsePointLayersOption(option);
    this.overlays = overlays;
    this.now = deps.now ?? (() => Date.now());
    this.area = deps.area ?? null;
    this.hass = null;
    /** @type {Map<string, {layer: object, url: ?string, status: ?string, failedAt?: number, order: number, state: ?object}>} */
    this.publishers = new Map();
    this.disposed = false;
    this._onClick = (e) => this._click(e);
    this._onMove = (e) => this._hover(e);
    this._listening = false;
  }

  /** @param {object} hass */
  render(hass) {
    if (this.disposed) return;
    try {
      if (hass) this.hass = hass;
      const states = this.hass?.states ?? {};
      const wanted = this._wanted(states);
      for (const id of [...this.publishers.keys()]) if (!wanted.has(id)) this._forget(id);
      for (const [id, item] of wanted) this._update(id, item, states[id]);
      this._listen(this.publishers.size > 0);
    } catch (e) {
      Logger.error("[PointLayers] render failed; markers unaffected", e);
    }
  }

  _wanted(states) {
    const out = new Map();
    if (this.option.mode === "off") return out;
    if (this.option.mode === "auto") {
      for (const id of discoverPointPublishers(states)) out.set(id, { name: null, show: null });
      return out;
    }
    for (const it of this.option.items) if (states[it.entity]) out.set(it.entity, { name: it.name, show: it.show });
    return out;
  }

  _update(id, item, state) {
    let p = this.publishers.get(id);
    if (!p) {
      const attribution = typeof state?.attributes?.attribution === "string" ? state.attributes.attribution : undefined;
      // The attribution control writes it with innerHTML: the publisher's text, escaped (LiveTrackMapCard#1).
      const layer = new PointCanvasLayer(attribution ? { attribution: escapeHtml(attribution) } : {});
      // The device name left off the label (util/LayerLabel.js, Lee 2026-11-19).
      const label = layerLabel(this.hass ?? { states: { [id]: state } }, id, item.name);
      p = { layer, url: null, status: null, order: 0, state: null };
      this.publishers.set(id, p);
      layer.on?.("add", () => this._restack());
      // The dashboard's `show`, else the publisher's `layer_default` (backlog 363); the viewer's tick wins over both.
      this.overlays.addOverlay(layer, label.name, layerShown(item.show, state?.attributes), label.former);
    }
    if (!isPointPublisherState(state)) {
      if (p.url || p.state) p.layer.setData(null, {});
      p.url = null;
      p.state = null;
      p.status = null;
      return;
    }
    const url = pointsUrlOf(state.attributes);
    const order = pointOrderOf(state.attributes);
    if (order !== p.order) { p.order = order; this._restack(); }
    if (p.state === state && p.url === url) return;
    p.state = state;
    if (url !== p.url) {
      p.url = url;
      p.status = null;
    }
    if (p.status === "ok") {
      p.layer.setData(p.data, state.attributes.point_styles);
      return;
    }
    if (p.status === "loading") return;
    if (p.status === "failed" && this.now() - p.failedAt < POINT_RETRY_MS) return;
    this._fetch(id, p, url);
  }

  _fetch(id, p, url) {
    p.status = "loading";
    let req;
    try {
      req = Promise.resolve(this.hass.callApi("GET", apiPath(url)));
    } catch (e) {
      req = Promise.reject(e);
    }
    req.then((json) => {
      if (this.disposed || p.url !== url) return;
      const keep = this.area ? (lon, lat) => geometryTouchesArea({ type: "LineString", coordinates: [[lon, lat]] }, this.area) : null;
      const data = pointsOf(json, keep);
      if (!data) throw new Error("no points list");
      p.status = "ok";
      p.data = data;
      p.layer.setData(data, p.state?.attributes?.point_styles);
    }).catch((e) => {
      if (this.disposed || p.url !== url) return;
      p.status = "failed";
      p.failedAt = this.now();
      p.layer.setData(null, {});
      Logger.warn(`[PointLayers] points for ${id} not loaded (${url}): ${e?.message ?? e}; retry in 10 min or on a new URL`);
    });
  }

  /** Canvases in `point_order`, ties by entity id: a later child is drawn on top. */
  _restack() {
    const ranked = [...this.publishers.entries()].sort(([ia, a], [ib, b]) => (a.order - b.order) || (ia < ib ? -1 : ia > ib ? 1 : 0));
    for (const [, q] of ranked) {
      const cv = q.layer._canvas;
      if (cv?.parentNode) cv.parentNode.appendChild(cv);
    }
  }

  /** @returns {object[]} publishers on the map, topmost first */
  _topFirst() {
    return [...this.publishers.entries()]
      .sort(([ia, a], [ib, b]) => (b.order - a.order) || (ia < ib ? 1 : ia > ib ? -1 : 0))
      .map(([, q]) => q)
      .filter((q) => q.layer._canvas);
  }

  _hitAt(cp) {
    for (const q of this._topFirst()) {
      const i = q.layer.hit(cp);
      if (i >= 0) return { q, i };
    }
    return null;
  }

  _click(e) {
    this.openAt(e?.containerPoint);
  }

  /**
   * Opens the popup of the dot under a container point, the topmost publisher first. A clickable shape (D12) asks
   * this on its own click, because the dots are drawn above the shapes and Leaflet stops a shape's click from
   * reaching the map (Layer._openPopup: "prevent map click"). D19 rule 4 as amended 2026-11-24.
   * @param {?{x: number, y: number}} cp a container point
   * @returns {boolean} a dot was there and its popup opened
   */
  openAt(cp) {
    if (this.disposed || !cp) return false;
    const h = this._hitAt(cp);
    if (!h) return false;
    const { latlng, html } = h.q.layer.popupFor(h.i);
    L.popup(INFO_POPUP).setLatLng(latlng).setContent(html).openOn(this.map);
    return true;
  }

  _hover(e) {
    if (this._hoverQueued || !e?.containerPoint) return;
    this._hoverQueued = true;
    const cp = e.containerPoint;
    const run = () => {
      this._hoverQueued = false;
      if (this.disposed) return;
      const box = this.map.getContainer?.();
      if (box) box.style.cursor = this._hitAt(cp) ? "pointer" : "";
    };
    (globalThis.requestAnimationFrame ?? ((f) => setTimeout(f, 16)))(run);
  }

  _listen(on) {
    if (on === this._listening) return;
    this._listening = on;
    if (on) { this.map.on("click", this._onClick); this.map.on("mousemove", this._onMove); } else {
      this.map.off("click", this._onClick); this.map.off("mousemove", this._onMove);
    }
  }

  _forget(id) {
    const p = this.publishers.get(id);
    if (!p) return;
    this.overlays.removeOverlay(p.layer);
    p.layer.remove();
    this.publishers.delete(id);
  }

  cleanup() {
    for (const id of [...this.publishers.keys()]) {
      try { this._forget(id); } catch (e) { Logger.error("[PointLayers] cleanup", e); }
    }
    this._listen(false);
    this.disposed = true;
  }
}
