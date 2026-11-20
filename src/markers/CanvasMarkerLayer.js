// Plain markers drawn on a canvas instead of one DOM element (and one compositing layer)
// each (map capacity, card SSOT 2026-10-25). "Plain": a picture in its round disc (no label
// overlay, no ring, no badge, not bare, not animated), or a disc with only its label and
// arrow. Everything else - rings, stars, maple leaves, heading tags, delay badges, pulses,
// alternates, pills, icons, animated pictures - stays DOM. A canvas marker under the pointer
// is PROMOTED to its real DOM marker while hovered, so the hover box, its clock and the tap
// action are the card's own; it goes back to the canvas on mouseout.
//
// One canvas per D10 class, each in its own pane under that class's DOM markers
// (MarkerPlacement.js), so the contract's stacking holds across canvas and DOM. The pointer
// is tested against the classes top first.
//
// CanvasMarker stands in for the Leaflet Marker that Entity holds: the methods Entity calls
// (setLatLng, getLatLng, getElement, addTo, remove, setZIndexOffset, tooltips, events). It
// wraps the real DOM marker Entity built, so Entity's attribute writes keep that marker's
// stored html current, and a marker whose look stops being plain becomes that DOM marker.
//
// Nothing here may import MapCardEntityMarker.js: it pulls Lit into Entity's imports, which
// the jest setup does not transform, and about 30 suites stop loading.
import { Renderer, DomUtil, latLng as toLatLng } from "leaflet";
import { stats } from "./MarkerStats.js";
import { bandOf, canvasPane, ensurePanes } from "./MarkerPlacement.js";
// MapCardEntityMarker.SHADOW_FULL_M, copied (see above).
const SHADOW_FULL_M = 12192;

const JsMap = globalThis.Map;
/**
 * What one canvas's sprite cache may hold, in bytes of sprite pixels (4 a pixel), oldest
 * evicted first. Was a count of 4,000 in the prototype: a 60 px aircraft sprite with its
 * shadow margin is ~104 x 104 px, so that count was ~170 MB at 1x and ~690 MB at 2x
 * (soak 2026-10-26: 1,111 sprites after an hour and still rising). 24 MB is ~580 such
 * sprites at 1x, ~145 at 2x.
 */
export const SPRITE_BUDGET_BYTES = 24 * 1024 * 1024;
/** The DOM shadow's `transition: filter 3s linear` (MapCardEntityMarker.groundShadowStyle). */
export const SHADOW_EASE_MS = 3000;
/** Steps in one shadow ease: one every 100 ms. */
export const SHADOW_EASE_STEPS = 30;

/**
 * The attributes written into a marker's DivIcon html (Entity.createMapMarker).
 * @param {string} html
 * @returns {{[name: string]: string}}
 */
export function parseAttrs(html) {
  const out = {};
  const re = /\s([a-z-]+)=(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(html || ""))) out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

const has = (v) => v !== undefined && v !== null && v !== "" && v !== "undefined" && v !== "null";

/**
 * Can this look be drawn on the canvas?
 * @param {{[name: string]: string}} a
 * @returns {boolean}
 */
export function isPlain(a) {
  // A picture wins over an icon in the marker (_inner), so an icon alone is not plain.
  if (has(a.icon) && !has(a.picture)) return false;
  if (has(a["place-icon"]) || has(a.alternate) || has(a["delay-badge"]) || a.pulse === "true") return false;
  if (has(a.shape) || has(a.symbol) || a["label-placement"] === "heading") return false;
  if (has(a["ring-width"]) && Number(a["ring-width"]) !== 1) return false;
  const fill = String(a.color || "").trim().toLowerCase();
  if (has(a["ring-color"]) && a["ring-color"].trim().toLowerCase() !== fill) return false;
  if (has(a.prefix) || has(a.suffix) || has(a.label)) return false;
  if (has(a.picture)) return a["bare-picture"] !== "true";
  return true;
}

/**
 * A picture's path with its query left out: one animation check per picture, whatever token
 * or version its URL carries.
 * @param {string} url
 * @returns {string}
 */
export function picturePath(url) {
  return String(url || "").split("?")[0];
}

/**
 * Does this image move by itself? A canvas draw copies ONE still frame of an image, so an
 * animated picture must stay a DOM marker, where the browser plays it as the card's CSS
 * background (defect found by Lee 2026-10-25 21:33: helicopter rotors frozen). Animated:
 * SVG with SMIL (<animate>, <animateTransform>, <animateMotion>, <animateColor>, <set>) or a
 * CSS animation (@keyframes, animation:); a GIF with more than one frame or a loop block; an
 * APNG (acTL before the first IDAT); an animated WebP (ANIM chunk).
 * @param {Uint8Array} bytes the image file
 * @param {string} [contentType]
 * @returns {boolean}
 */
export function isAnimatedImage(bytes, contentType = "") {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const ascii = (from, to) => {
    let s = "";
    const end = Math.min(b.length, to);
    for (let i = from; i < end; i++) s += String.fromCharCode(b[i]);
    return s;
  };
  if (b.length >= 6 && ascii(0, 3) === "GIF") {
    let gce = 0;
    for (let i = 0; i + 2 < b.length; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) gce++;
    return gce > 1 || ascii(0, b.length).includes("NETSCAPE2.0");
  }
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") {
    const head = ascii(8, b.length);
    const ac = head.indexOf("acTL"), idat = head.indexOf("IDAT");
    return ac >= 0 && (idat < 0 || ac < idat);
  }
  if (b.length >= 16 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return ascii(12, 64).includes("ANIM") || ascii(12, 64).includes("ANMF");
  }
  const text = ascii(0, Math.min(b.length, 512 * 1024));
  if (/svg/i.test(contentType) || /<svg[\s>]/i.test(text)) {
    return /<(animate|animateTransform|animateMotion|animateColor|set)[\s/>]/.test(text) ||
      /@keyframes|animation(-name)?\s*:/.test(text);
  }
  return false;
}

/**
 * The ground shadow's numbers, MapCardEntityMarker.groundShadowStyle's formula.
 * @param {string} altitude
 * @param {number} size
 * @returns {{off: number, blur: number, op: number, key: string}|null}
 */
export function shadowParams(altitude, size) {
  if (!has(altitude)) return null;
  const alt = Number(altitude);
  if (!Number.isFinite(alt) || !(size > 0)) return null;
  const f = Math.sqrt(Math.min(Math.max(alt, 0), SHADOW_FULL_M) / SHADOW_FULL_M);
  const off = +(size * (0.025 + 0.12 * f)).toFixed(1);
  const blur = +(0.6 + 0.35 * off).toFixed(1);
  const op = +(0.55 - 0.25 * f).toFixed(2);
  return { off, blur, op, key: `${off}/${blur}/${op}` };
}

/** An angle that turns linearly over `secs`, as the marker's CSS transition does. */
class Turn {
  constructor(v, secs) {
    const n = Number(v);
    this.has = has(v) && Number.isFinite(n);
    this.from = this.target = this.has ? n : 0;
    this.t0 = 0;
    const s = Number(secs);
    this.ms = Number.isFinite(s) && s > 0 ? s * 1000 : 0;
  }
  to(v) {
    const n = Number(v);
    if (!has(v) || !Number.isFinite(n)) { this.has = false; return; }
    const now = performance.now();
    this.from = this.has ? this.at(now) : n;
    this.target = n;
    this.t0 = now;
    this.has = true;
  }
  at(now) {
    if (!this.ms || now >= this.t0 + this.ms) return this.target;
    return this.from + (this.target - this.from) * ((now - this.t0) / this.ms);
  }
  moving(now) { return this.has && this.ms > 0 && now < this.t0 + this.ms; }
}

/**
 * Are two shadows the same, by their rounded key? Null is no shadow.
 * @param {object|null} p
 * @param {object|null} q
 * @returns {boolean}
 */
const sameShadow = (p, q) => (p === null || q === null ? p === q : p.key === q.key);

/**
 * The ground shadow as the DOM marker shows it: `transition: filter 3s linear` on the
 * marker element (D4a-shadow). A change eases linearly from what is shown now. A shadow
 * that appears eases in from nothing (CSS interpolates `none` as zero offsets, zero blur,
 * transparent); one that goes away is gone at once, because the style that has no filter
 * has no transition either. The ease moves in SHADOW_EASE_STEPS steps (100 ms each), so an
 * ease builds at most 31 sprites per picture and angle, not one a frame; at the live 60 px
 * marker the largest step, ground to 40,000 ft, is 0.24 px.
 */
export class ShadowEase {
  /** @param {{off: number, blur: number, op: number, key: string}|null} p */
  constructor(p) {
    this.from = p;
    this.target = p;
    this.t0 = 0;
  }
  /**
   * @param {{off: number, blur: number, op: number, key: string}|null} p
   * @param {number} [now]
   */
  to(p, now = performance.now()) {
    if (sameShadow(p, this.target)) return;
    if (!p) { this.from = this.target = null; return; }
    this.from = this.at(now) ?? { off: 0, blur: 0, op: 0, key: "0/0/0" };
    this.target = p;
    this.t0 = now;
  }
  /**
   * @param {number} now
   * @returns {{off: number, blur: number, op: number, key: string}|null}
   */
  at(now) {
    const t = this.target, f = this.from;
    if (!t) return null;
    if (!f || f === t || now >= this.t0 + SHADOW_EASE_MS) return t;
    const k = Math.floor(Math.max(0, (now - this.t0) / SHADOW_EASE_MS) * SHADOW_EASE_STEPS) / SHADOW_EASE_STEPS;
    const off = +(f.off + (t.off - f.off) * k).toFixed(1);
    const blur = +(f.blur + (t.blur - f.blur) * k).toFixed(1);
    const op = +(f.op + (t.op - f.op) * k).toFixed(2);
    return { off, blur, op, key: `${off}/${blur}/${op}` };
  }
  /**
   * Is the shadow still easing?
   * @param {number} now
   * @returns {boolean}
   */
  moving(now) {
    return Boolean(this.target && this.from && this.from !== this.target && now < this.t0 + SHADOW_EASE_MS);
  }
}

export class CanvasMarker {
  /**
   * @param {object} dom the Leaflet Marker Entity built (not on the map)
   * @param {object} layer the CanvasMarkerLayer
   * @param {object} entity the Entity
   * @param {string} tag the marker element's tag name
   */
  constructor(dom, layer, entity, tag) {
    this.dom = dom;
    this.layer = layer;
    this.entity = entity;
    this.tag = tag;
    this.options = dom.options;
    this._latlng = dom.getLatLng();
    this.a = parseAttrs(dom.options?.icon?.options?.html);
    this.size = Number(this.a.size) || 24;
    this.z = dom.options?.zIndexOffset || 0;
    this.mode = "canvas";
    this.rot = new Turn(this.a.rotation, this.a["rotation-transition"]);
    this.arr = new Turn(this.a.arrow, this.a["rotation-transition"]);
    this.sh = new ShadowEase(shadowParams(this.a["ground-shadow"], this.size));
    const self = this;
    this._fake = {
      querySelector: () => ({
        setAttribute: (n, v) => {
          self._attr(n, v);
          if (self.mode !== "canvas") self.dom.getElement?.()?.querySelector(self.tag)?.setAttribute(n, v);
        },
      }),
    };
    // The hover clock must see THIS object as the entity's marker (Entity._startTooltipClock).
    dom.off("tooltipopen");
    dom.off("tooltipclose");
    dom.on("tooltipopen", () => entity._startTooltipClock?.(self));
    dom.on("tooltipclose", () => entity._stopTooltipClock?.());
    // A click popup PINS the promoted marker in the DOM: taking the DOM marker off the map closes
    // its popup (Leaflet binds `remove: closePopup`), so on mouseout the popup vanished before the
    // pointer reached a link in it (Lee 2026-11-20 17:50, a ship's popup). While pinned, mouseout
    // and another marker's promotion leave it; when the popup closes it goes back to the canvas
    // unless the pointer is still on it.
    dom.on("popupopen", () => { self.pinned = true; });
    dom.on("popupclose", () => {
      self.pinned = false;
      if (self.mode !== "hover") return;
      let over = false;
      try { over = Boolean(self.dom.getElement?.()?.matches?.(":hover")); } catch { /* */ }
      if (!over) self.layer.demote(self);
    });
    dom.on("mouseout", () => { if (self.mode === "hover") self.layer.demote(self); });   // demote() keeps a pinned one
  }
  _attr(n, v) {
    this.a[n] = String(v);
    if (n === "rotation") this.rot.to(v);
    else if (n === "arrow") this.arr.to(v);
    else if (n === "size") this.size = Number(v) || this.size;
    if (n === "ground-shadow" || n === "size") this.sh.to(shadowParams(this.a["ground-shadow"], this.size));
    if (this.mode === "canvas" && (!isPlain(this.a) || (n === "picture" && this.layer.pictureAnimated(v) === true))) this.layer.toDom(this);
    else this.layer.dirty();
  }
  getLatLng() { return this._latlng; }
  setLatLng(ll) {
    this._latlng = toLatLng(ll);
    this.dom.setLatLng(this._latlng);
    if (this.mode === "canvas") this.layer.dirty();
    return this;
  }
  getElement() { return this._fake; }
  /**
   * A new offset can put the marker in another D10 class: its DOM marker moves pane
   * (MarkerPlacement.bandMarker) and the marker itself moves to that class's canvas.
   * @param {number} z
   * @returns {CanvasMarker}
   */
  setZIndexOffset(z) {
    this.z = z;
    this.dom.setZIndexOffset?.(z);
    const map = this.layer._map;
    const b = bandOf(z);
    if (map && b !== this.layer.band) {
      const was = this.layer;
      if (this.mode === "hover") was.demote(this);
      was._items.delete(this);
      was.dirty();
      this.layer = layerFor(map, b);
      this.layer._items.add(this);
      stats.bandMoves++;
    }
    this.layer.dirty();
    return this;
  }
  addTo() { this.layer.addMarker(this); return this; }
  remove() { this.layer.removeMarker(this); return this; }
  bindTooltip(...args) { this.dom.bindTooltip(...args); return this; }
  setTooltipContent(c) { this.dom.setTooltipContent(c); return this; }
  isTooltipOpen() { return this.dom.isTooltipOpen?.() ?? false; }
  getTooltip() { return this.dom.getTooltip?.(); }
  // The click popup (Entity._bindPopup, refreshMarkerPopup): a photo or link that arrives after the
  // marker was made binds it on this stand-in, so the popup methods reach the DOM marker too.
  bindPopup(...args) { this.dom.bindPopup(...args); return this; }
  unbindPopup() { this.dom.unbindPopup?.(); return this; }
  openPopup(...args) { this.dom.openPopup?.(...args); return this; }
  closePopup() { this.dom.closePopup?.(); return this; }
  isPopupOpen() { return this.dom.isPopupOpen?.() ?? false; }
  getPopup() { return this.dom.getPopup?.(); }
  on(...args) { this.dom.on(...args); return this; }
  off(...args) { this.dom.off(...args); return this; }
  fire(...args) { this.dom.fire(...args); return this; }
  tapAction() {
    try { return JSON.parse(this.a["tap-action"] || "null"); } catch { return null; }
  }
}

/**
 * The layer's scratch canvas, at least w x h, cleared.
 * @param {object} layer
 * @param {number} w
 * @param {number} h
 * @returns {{c: HTMLCanvasElement, ctx: CanvasRenderingContext2D}}
 */
function scratch(layer, w, h) {
  const c = layer._scratch || (layer._scratch = document.createElement("canvas"));
  if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
  const ctx = c.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  return { c, ctx };
}

/**
 * A picture marker as the DOM draws it: border-box disc of `s`, 1px border, the picture
 * covering the content box, turned about its centre, clipped to the padding box's circle;
 * the ground shadow as a drop-shadow of the whole disc.
 * @param {object} layer the CanvasMarkerLayer (its scratch canvas)
 * @param {HTMLImageElement} img
 * @param {number} s size, CSS px
 * @param {string} bg fill
 * @param {string} bd border
 * @param {number|null} ang degrees, null for none
 * @param {{off: number, blur: number, op: number}|null} sh shadow
 * @param {number} m device pixel ratio
 * @returns {{c: HTMLCanvasElement, w: number, half: number}}
 */
function buildPictureSprite(layer, img, s, bg, bd, ang, sh, m) {
  const pad = sh ? Math.ceil(sh.off + 3 * sh.blur + 2) : 1;
  const w = s + 2 * pad;
  const px = Math.ceil(w * m);
  const { c: d, ctx: dc } = scratch(layer, Math.ceil(s * m), Math.ceil(s * m));
  dc.setTransform(m, 0, 0, m, 0, 0);
  const r = s / 2;
  if (has(bg) && bg.trim().toLowerCase() !== "transparent") {
    dc.beginPath(); dc.arc(r, r, r, 0, 2 * Math.PI); dc.fillStyle = bg; dc.fill();
  }
  dc.save();
  dc.beginPath(); dc.arc(r, r, r - 1, 0, 2 * Math.PI); dc.clip();
  dc.translate(r, r);
  if (ang !== null) dc.rotate((ang * Math.PI) / 180);
  const box = s - 2;
  const k = Math.max(box / (img.naturalWidth || box), box / (img.naturalHeight || box));
  const iw = (img.naturalWidth || box) * k, ih = (img.naturalHeight || box) * k;
  dc.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  dc.restore();
  if (has(bd) && bd.trim().toLowerCase() !== "transparent") {
    dc.beginPath(); dc.arc(r, r, r - 0.5, 0, 2 * Math.PI); dc.lineWidth = 1; dc.strokeStyle = bd; dc.stroke();
  }
  const c = document.createElement("canvas");
  c.width = px; c.height = px;
  const ctx = c.getContext("2d");
  ctx.setTransform(m, 0, 0, m, 0, 0);
  if (sh) ctx.filter = `drop-shadow(${sh.off}px ${sh.off}px ${sh.blur}px rgba(0, 0, 0, ${sh.op}))`;
  ctx.drawImage(d, 0, 0, Math.ceil(s * m), Math.ceil(s * m), pad, pad, s, s);
  return { c, w, half: w / 2 };
}

/**
 * A picture marker whose picture has not loaded (or failed): its disc and border only, as
 * the DOM marker shows it with no background image. Found on the look page 2026-10-26: the
 * canvas drew nothing at all.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasMarker} it
 * @param {object} p layer point
 */
function drawEmptyDisc(ctx, it, p) {
  const a = it.a, r = it.size / 2;
  const bg = String(a.color || "").trim();
  const bd = has(a["ring-color"]) ? String(a["ring-color"]).trim() : bg;
  if (has(bg) && bg.toLowerCase() !== "transparent") {
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fillStyle = bg; ctx.fill();
  }
  if (has(bd) && bd.toLowerCase() !== "transparent") {
    ctx.beginPath(); ctx.arc(p.x, p.y, r - 0.5, 0, 2 * Math.PI); ctx.lineWidth = 1; ctx.strokeStyle = bd; ctx.stroke();
  }
}

/**
 * A disc with its label and arrow (MapCardEntityMarker labelTextStyle, _arrow).
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasMarker} it
 * @param {object} p layer point
 * @param {number} now
 * @param {object} layer the CanvasMarkerLayer (fonts, text colour)
 */
function drawDisc(ctx, it, p, now, layer) {
  const a = it.a, s = it.size, r = s / 2;
  const fill = String(a.color || "").trim();
  const filled = fill !== "" && fill.toLowerCase() !== "transparent";
  if (it.arr.has) {
    const ang = it.arr.at(now);
    const w = Math.max(8, Math.round(s * 0.45)), h = Math.round(w * 0.75);
    const own = String(a["arrow-color"] || "").trim();
    const ol = String(a["arrow-outline"] || "").trim();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((ang * Math.PI) / 180);
    ctx.translate(-w / 2, -r - h);
    ctx.scale(w / 10, h / 7.5);
    ctx.beginPath(); ctx.moveTo(5, 0.6); ctx.lineTo(9.4, 6.9); ctx.lineTo(0.6, 6.9); ctx.closePath();
    ctx.fillStyle = has(own) ? own : filled ? fill : "#000";
    ctx.fill();
    ctx.lineWidth = 1; ctx.lineJoin = "round"; ctx.strokeStyle = has(ol) ? ol : "rgba(0, 0, 0, 0.8)";
    ctx.stroke();
    ctx.restore();
  }
  if (filled) {
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fillStyle = fill; ctx.fill();
  }
  const text = String(a.title || "");
  if (text === "") return;
  const lc = String(a["label-color"] || "").trim();
  const oc = String(a["label-outline"] || "").trim();
  const color = lc !== "" ? lc : filled ? "#FFFFFF" : layer._textColor;
  const outline = oc.toLowerCase() === "none" || (lc === "" && !filled) ? null : (oc !== "" ? oc : "rgba(0, 0, 0, 0.8)");
  ctx.font = layer._fontFor(a.style);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (outline) {
    ctx.fillStyle = outline;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.fillText(text, p.x + dx, p.y + dy);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, p.y);
}

export const CanvasMarkerLayer = Renderer.extend({
  options: { padding: 0.1, pane: canvasPane(bandOf(0)) },

  initialize(options) {
    Renderer.prototype.initialize.call(this, options);
    this._items = new Set();
    this._imgs = new JsMap();
    this._sprites = new JsMap();
    this._spriteBytes = 0;
    this._drawnList = [];
    this._raf = null;
    this.band = bandOf(0);
    this._anim = new JsMap();
  },

  /**
   * Is this picture animated: true, false, or null while its one check is in flight. The
   * first call starts the check (one fetch per picture path, as the browser fetches it for
   * the DOM); when it finds an animation, every canvas marker drawing that picture becomes
   * its DOM marker. Until it answers, the marker draws on the canvas, frozen, for one fetch.
   * A failed fetch counts as still: the picture is drawn on the canvas, as before the fix.
   * @param {string} url
   * @returns {boolean|null}
   */
  pictureAnimated(url) {
    const key = picturePath(url);
    if (!key) return false;
    if (this._anim.has(key)) return this._anim.get(key);
    this._anim.set(key, null);
    Promise.resolve()
      .then(() => fetch(url, { credentials: "same-origin" }))
      .then(async (r) => (r.ok ? isAnimatedImage(new Uint8Array(await r.arrayBuffer()), r.headers.get("content-type") || "") : false))
      .catch(() => false)
      .then((animated) => {
        this._anim.set(key, animated);
        if (!animated) return;
        stats.animatedPictures++;
        const all = this._map ? layers(this._map).filter(Boolean) : [this];
        for (const layer of all) {
          for (const it of layer._items) {
            if (it.mode === "canvas" && picturePath(it.a.picture) === key) layer.toDom(it);
          }
        }
      });
    return null;
  },

  onAdd(map) {
    ensurePanes(map);
    Renderer.prototype.onAdd.call(this, map);
    const box = map.getContainer();
    const cs = getComputedStyle(box);
    this._family = cs.fontFamily || "sans-serif";
    this._baseFont = parseFloat(cs.fontSize) || 12;
    this._textColor = cs.color || "#000";
    this._fonts = new JsMap();
    if (!map.__ltmcCanvasEvents) {
      map.on("mousemove", onMapMove, map);
      map.on("click", onMapClick, map);
      map.__ltmcCanvasEvents = true;
    }
    this.dirty();
  },

  onRemove(map) {
    const ls = layers(map);
    if (ls[this.band] === this) ls[this.band] = undefined;
    if (!ls.some(Boolean) && map.__ltmcCanvasEvents) {
      map.off("mousemove", onMapMove, map);
      map.off("click", onMapClick, map);
      map.__ltmcCanvasEvents = false;
    }
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    for (const it of this._items) { try { it.dom.remove(); } catch { /* */ } }
    Renderer.prototype.onRemove.call(this, map);
  },

  _initContainer() {
    const c = (this._container = document.createElement("canvas"));
    c.className = "ltmc-canvas-markers";
    c.style.pointerEvents = "none";
    this._ctx = c.getContext("2d");
  },

  _destroyContainer() {
    DomUtil.remove(this._container);
    delete this._ctx;
  },

  _update() {
    if (this._map._animatingZoom && this._bounds) return;
    Renderer.prototype._update.call(this);
    const b = this._bounds, c = this._container, size = b.getSize();
    const m = window.devicePixelRatio || 1;
    if (m !== this._dpr) { this._sprites.clear(); this._spriteBytes = 0; }
    this._dpr = m;
    DomUtil.setPosition(c, b.min);
    c.width = Math.round(m * size.x);
    c.height = Math.round(m * size.y);
    c.style.width = size.x + "px";
    c.style.height = size.y + "px";
    this._draw(performance.now());
  },

  _fontFor(style) {
    const key = style || "";
    let f = this._fonts.get(key);
    if (!f) {
      // The element's own style sets the HOST's size; the disc's text is 1.5em of it
      // (.marker font-size: var(--ha-marker-font-size, 1.5em)).
      const mm = /font-size:\s*([\d.]+)(px|%|em|rem)/.exec(key);
      let host = this._baseFont;
      if (mm) {
        const n = Number(mm[1]);
        host = mm[2] === "px" ? n : mm[2] === "%" ? (this._baseFont * n) / 100 : mm[2] === "em" ? this._baseFont * n : 16 * n;
      }
      f = `${+(host * 1.5).toFixed(2)}px ${this._family}`;
      this._fonts.set(key, f);
    }
    return f;
  },

  count() { let n = 0; for (const it of this._items) if (it.mode === "canvas") n++; return n; },

  dirty() {
    if (this._raf || !this._map) return;
    this._raf = requestAnimationFrame((t) => { this._raf = null; this._draw(t); });
  },

  addMarker(it) {
    this._items.add(it);
    if (it.mode !== "canvas") it.dom.addTo(this._map);
    this.dirty();
  },

  _unhover(it) {
    if (this._map && this._map.__ltmcHover === it) this._map.__ltmcHover = null;
  },

  removeMarker(it) {
    this._items.delete(it);
    this._unhover(it);
    try { it.dom.closeTooltip?.(); it.dom.remove(); } catch { /* */ }
    this.dirty();
  },

  promote(it) {
    if (it.mode !== "canvas" || !this._map) return;
    const was = this._map.__ltmcHover;
    if (was && was !== it) was.layer.demote(was);
    it.mode = "hover";
    this._map.__ltmcHover = it;
    stats.promoted++;
    it.dom.setLatLng(it._latlng);
    it.dom.addTo(this._map);
    it.dom.openTooltip?.();
    this.dirty();
  },

  demote(it) {
    if (it.mode !== "hover" || it.pinned) return;
    try { it.dom.closeTooltip?.(); it.dom.remove(); } catch { /* */ }
    it.mode = "canvas";
    this._unhover(it);
    this.dirty();
  },

  toDom(it) {
    if (it.mode === "dom") return;
    if (it.mode === "canvas") { it.dom.setLatLng(it._latlng); it.dom.addTo(this._map); }
    this._unhover(it);
    it.mode = "dom";
    stats.toDom++;
    this.dirty();
  },

  _hit(pt) {
    for (let i = this._drawnList.length - 1; i >= 0; i--) {
      const it = this._drawnList[i];
      if (it.mode !== "canvas" || !it._pt) continue;
      const r = it.size / 2;
      const dx = pt.x - it._pt.x, dy = pt.y - it._pt.y;
      if (dx * dx + dy * dy <= r * r) return it;
    }
    return null;
  },

  _tap(it) {
    this.promote(it);
    const host = this._map.getContainer().getRootNode()?.host;
    const ev = new Event("hass-action", { bubbles: true, composed: true });
    ev.detail = { config: { entity: it.a["entity-id"], tap_action: it.tapAction() }, action: "tap" };
    (host || this._map.getContainer()).dispatchEvent(ev);
  },

  _img(url) {
    let im = this._imgs.get(url);
    if (!im) {
      im = new Image();
      im.decoding = "async";
      im.onload = () => this.dirty();
      im.src = url;
      this._imgs.set(url, im);
    }
    return im.complete && im.naturalWidth > 0 ? im : null;
  },

  _sprite(it, now) {
    const a = it.a;
    const img = this._img(a.picture);
    if (!img) return null;
    const ang = it.rot.has ? (((Math.round(it.rot.at(now)) % 360) + 360) % 360) : null;
    const sh = it.sh.at(now);
    const bg = a.color || "";
    const bd = has(a["ring-color"]) ? a["ring-color"] : bg;
    const key = `${a.picture}|${it.size}|${bg}|${bd}|${ang}|${sh ? sh.key : ""}`;
    let spr = this._sprites.get(key);
    if (spr) {
      this._sprites.delete(key);
      this._sprites.set(key, spr);
      return spr;
    }
    spr = buildPictureSprite(this, img, it.size, bg, bd, ang, sh, this._dpr || 1);
    stats.spritesBuilt++;
    spr.bytes = spr.c.width * spr.c.height * 4;
    this._sprites.set(key, spr);
    this._spriteBytes += spr.bytes;
    // Oldest first, never the one just built.
    while (this._spriteBytes > SPRITE_BUDGET_BYTES && this._sprites.size > 1) {
      const oldest = this._sprites.keys().next().value;
      this._spriteBytes -= this._sprites.get(oldest).bytes;
      this._sprites.delete(oldest);
      stats.spritesEvicted++;
    }
    return spr;
  },

  _draw(now) {
    const ctx = this._ctx, map = this._map;
    if (!ctx || !map || !this._bounds) return;
    const t0 = performance.now();
    const b = this._bounds, m = this._dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this._container.width, this._container.height);
    ctx.setTransform(m, 0, 0, m, -b.min.x * m, -b.min.y * m);
    const list = [];
    let animating = false;
    for (const it of this._items) {
      if (it.mode !== "canvas" || !it._latlng) { it._pt = null; continue; }
      const p = map.latLngToLayerPoint(it._latlng);
      const r = it.size;
      if (p.x < b.min.x - r || p.x > b.max.x + r || p.y < b.min.y - r || p.y > b.max.y + r) { it._pt = null; continue; }
      it._pt = p;
      list.push(it);
      if (it.rot.moving(now) || it.arr.moving(now) || it.sh.moving(now)) animating = true;
    }
    list.sort((u, v) => (u.z - v.z) || (u._pt.y - v._pt.y));
    for (const it of list) {
      try {
        if (has(it.a.picture)) {
          const spr = this._sprite(it, now);
          if (spr) ctx.drawImage(spr.c, it._pt.x - spr.half, it._pt.y - spr.half, spr.w, spr.w);
          else drawEmptyDisc(ctx, it, it._pt);
        } else {
          drawDisc(ctx, it, it._pt, now, this);
        }
      } catch { /* one bad marker never stops the rest */ }
    }
    this._drawnList = list;
    stats.draws++;
    stats.drawn = list.length;
    stats.drawMs += performance.now() - t0;
    if (animating) this.dirty();
  },
});

/**
 * A canvas stand-in for this DOM marker, or null when its look is not plain.
 * @param {object} dom the Leaflet Marker Entity built
 * @param {object} entity
 * @param {string} tag the marker element's tag name
 * @param {(m: object) => object} [wrapDom] e.g. culling, applied to the DOM fallback
 * @returns {CanvasMarker|null}
 */
export function canvasMarkerFor(dom, entity, tag, wrapDom) {
  if (entity.config?.distanceEntity) return null;
  // Only the tracked objects: people, zones and the like are a handful of markers, cost
  // nothing as DOM, and keep their order with the zone they stand in (look page 2026-10-26:
  // on the canvas, the people at home were drawn under the home zone's icon).
  if (!String(entity.id ?? entity.config?.id ?? "").startsWith("geo_location.")) return null;
  const a = parseAttrs(dom.options?.icon?.options?.html);
  if (!isPlain(a)) return null;
  const map = entity.map;
  const layer = layerFor(map, bandOf(dom.options?.zIndexOffset));
  // An animated picture is never drawn on the canvas (isAnimatedImage).
  if (has(a.picture) && pictureAnimated(map, a.picture) === true) return null;
  if (wrapDom) wrapDom(dom);
  return new CanvasMarker(dom, layer, entity, tag);
}

/**
 * This map's canvas layers, indexed by D10 class.
 * @param {object} map
 * @returns {Array<object|undefined>}
 */
export function layers(map) {
  return map.__ltmcCanvasLayers || (map.__ltmcCanvasLayers = []);
}

/**
 * The canvas for one D10 class, made on first use.
 * @param {object} map
 * @param {number} band 0..5
 * @returns {object} a CanvasMarkerLayer on the map
 */
export function layerFor(map, band) {
  const ls = layers(map);
  if (!ls[band]) {
    const layer = new CanvasMarkerLayer({ pane: canvasPane(band) });
    layer.band = band;
    // The animation checks are per picture, not per class: every layer shares one table.
    layer._anim = map.__ltmcAnim || (map.__ltmcAnim = new JsMap());
    ls[band] = layer;
    layer.addTo(map);
  }
  return ls[band];
}

/**
 * Is this picture animated, as any of the map's layers knows it (CanvasMarkerLayer
 * pictureAnimated)? The check runs on the first layer asked; its answer moves the canvas
 * markers drawing that picture to the DOM in every layer.
 * @param {object} map
 * @param {string} url
 * @returns {boolean|null}
 */
function pictureAnimated(map, url) {
  const ls = layers(map).filter(Boolean);
  return ls.length ? ls[0].pictureAnimated(url) : null;
}

/**
 * The canvas marker under a point, the top class first: a class drawn above another wins
 * the pointer, as it wins the picture.
 * @param {object} map
 * @param {object} pt layer point
 * @returns {CanvasMarker|null}
 */
export function topHit(map, pt) {
  const ls = layers(map);
  for (let b = ls.length - 1; b >= 0; b--) {
    const it = ls[b]?._hit(pt);
    if (it) return it;
  }
  return null;
}

/**
 * The map's mousemove: promote the top canvas marker under the pointer. Bound to the map.
 * @param {{layerPoint: object}} e
 */
function onMapMove(e) {
  const it = topHit(this, e.layerPoint);
  if (it) it.layer.promote(it);
}

/**
 * The map's click: tap the top canvas marker under the pointer. Bound to the map.
 * @param {{layerPoint: object}} e
 */
function onMapClick(e) {
  const it = topHit(this, e.layerPoint);
  if (it) it.layer._tap(it);
}
