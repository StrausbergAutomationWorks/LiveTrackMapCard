import { LitElement, html, css, unsafeCSS } from "lit";
import { latenessColor, LATENESS_CSS } from "../util/Lateness.js";

/**
 * Picture markers only get a text overlay when the user asked for one.
 * Auto-generated initials (title) must not cover entity pictures (#197).
 * @param {string} prefix
 * @param {string} suffix
 * @param {string} label
 * @returns {boolean}
 */
export function shouldOverlayPictureLabel(prefix, suffix, label) {
  return Boolean(prefix || suffix || (label && String(label).trim()));
}

/**
 * A thin dark outline: four 1px offsets. text-shadow rather than
 * -webkit-text-stroke, which draws inside the glyph and thins it.
 */
export const LABEL_OUTLINE =
  "-1px -1px 0 rgba(0, 0, 0, 0.8), 1px -1px 0 rgba(0, 0, 0, 0.8), " +
  "-1px 1px 0 rgba(0, 0, 0, 0.8), 1px 1px 0 rgba(0, 0, 0, 0.8)";

/**
 * Text style for a label drawn on a filled marker: WHITE with a dark outline,
 * whatever the fill.
 *
 * The text colour is deliberately NOT chosen by contrast against the fill.
 * A label at marker sizes overflows the marker, so part of it sits on the
 * fill and part on the map tiles; a colour picked for the fill (black on
 * #F29F05, say) is lost where it crosses the map. White with an outline reads
 * on both. Only a marker with NO fill - a missing, empty or `transparent`
 * colour - keeps the theme's text colour, without an outline. Every other
 * colour string counts as a fill, whatever its syntax: a dashboard may set
 * `hsl(...)` or a name, and the first version of this rule (hex only) left
 * every marker filled by upstream's hashed `hsl()` colour without an outline.
 *
 * An explicit `labelColor` (the entity's `marker_label_color` or the
 * dashboard's `label_color`, backlog 238) replaces the white and KEEPS the
 * outline, on a fill or not: the outline is what carries the label where it
 * overflows onto the map.
 * @param {string} color the marker fill
 * @param {string} [labelColor] the label colour; empty or absent for the default
 * @param {string} [outlineColor] the outline colour; empty or absent for the default
 * @returns {string} an inline style fragment
 */
export function labelTextStyle(color, labelColor, outlineColor) {
  const outline = labelOutline(outlineColor);
  const l = typeof labelColor === "string" ? labelColor.trim() : "";
  if (l !== "") return `color: ${l}; text-shadow: ${outline};`;
  const c = typeof color === "string" ? color.trim().toLowerCase() : "";
  if (c === "" || c === "transparent") {
    return "color: inherit;";
  }
  return `color: #FFFFFF; text-shadow: ${outline};`;
}

/**
 * The label outline: LABEL_OUTLINE, or the same four 1px offsets in the
 * emitter's `marker_label_outline_color`. An outline matching the FILL makes
 * a label that overflows the disc read as if the disc went on under it.
 * @param {string} [outlineColor] empty or absent for the default
 * @returns {string} a text-shadow value
 */
export function labelOutline(outlineColor) {
  const o = typeof outlineColor === "string" ? outlineColor.trim() : "";
  if (o === "") return LABEL_OUTLINE;
  // "none": no outline at all (2026-10-10, D4a).
  if (o.toLowerCase() === "none") return "none";
  return `-1px -1px 0 ${o}, 1px -1px 0 ${o}, -1px 1px 0 ${o}, 1px 1px 0 ${o}`;
}

/**
 * Inline style turning a marker picture. Empty when there is no angle.
 *
 * The angle is used exactly as given - an accumulated value past 360 or below
 * 0 is what keeps a CSS transition turning the short way.
 * @param {string} rotation degrees, or empty for none
 * @param {string} transition seconds
 * @returns {string}
 */
export function pictureRotationStyle(rotation, transition) {
  if (rotation == null || String(rotation).trim() === "") return "";
  const deg = Number(rotation);
  if (!Number.isFinite(deg)) return "";
  const t = Number(transition);
  const secs = Number.isFinite(t) && t >= 0 ? t : 0;
  return `transform: rotate(${deg}deg); transition: transform ${secs}s linear;`;
}

/**
 * The altitude at which the ground shadow stops growing: 40,000 ft.
 */
export const SHADOW_FULL_M = 12192;

/**
 * Inline style casting a picture's GROUND SHADOW (06_MAP_CONTRACT.md
 * D4a-shadow; Lee 2026-10-21): an aircraft drawn as a picture reads as flying
 * when its shadow falls on the map beside it, further away the higher it is.
 *
 * It sits on the marker element, which never turns: a CSS filter on a parent
 * is applied after its child's rotation, so the shadow keeps one direction
 * (light from the upper left) whichever way the picture faces. A filter's
 * output is not clipped by the element's own `overflow: hidden`, so a round
 * picture marker does not cut it off. Separation grows with the square root
 * of altitude, and the shadow softens and fades as it moves away; offsets are
 * a fraction of the marker size, so a bigger marker casts a bigger shadow.
 * Values chosen by eye on OSM Standard tiles (Live Track Aircraft
 * 20_Research/icons_depth_20261021/), not measured.
 * @param {string} altitude metres, or empty for no shadow
 * @param {number} size marker size in px
 * @returns {string}
 */
export function groundShadowStyle(altitude, size) {
  if (altitude == null || String(altitude).trim() === "") return "";
  const a = Number(altitude);
  const s = Number(size);
  if (!Number.isFinite(a) || !Number.isFinite(s) || s <= 0) return "";
  const f = Math.sqrt(Math.min(Math.max(a, 0), SHADOW_FULL_M) / SHADOW_FULL_M);
  const off = +(s * (0.025 + 0.12 * f)).toFixed(1);
  const blur = +(0.6 + 0.35 * off).toFixed(1);
  const op = +(0.55 - 0.25 * f).toFixed(2);
  return `filter: drop-shadow(${off}px ${off}px ${blur}px rgba(0, 0, 0, ${op})); transition: filter 3s linear;`;
}

/**
 * Inline style turning the arrow's frame. Empty when there is no angle, and
 * then no arrow is drawn at all. The angle is used as given, accumulated
 * past 360 or below 0, so the CSS transition turns the short way.
 * @param {string} arrow degrees, or empty for none
 * @param {string} transition seconds
 * @returns {string}
 */
export function arrowStyle(arrow, transition) {
  return pictureRotationStyle(arrow, transition);
}

/**
 * The ring's width in CSS px from the element's `ring-width` attribute: a
 * positive finite number, fractions allowed, else 1 - the CSS border every
 * disc already has. The emitted range is enforced upstream (parseRingWidth);
 * this only refuses what cannot be a width.
 * @param {string} [ringWidth]
 * @returns {number}
 */
export function ringWidthPx(ringWidth) {
  if (ringWidth == null || String(ringWidth).trim() === "") return 1;
  const n = Number(ringWidth);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * The width the browser will actually DRAW for a border of `width` CSS px:
 * floored to whole device pixels, never under one. Measured in Chrome
 * 2026-09-20 at devicePixelRatio 1: 0.5, 1.25, 1.5 and 1.75 all compute to
 * 1px. The arrow is lifted by this, not by the asked-for width, or a 1.5
 * ring on a 1x screen would leave a half-pixel gap under the arrow.
 * @param {number} width CSS px
 * @param {number} [dpr] device pixels per CSS px; defaults to the window's, else 1
 * @returns {number} CSS px
 */
export function drawnBorderPx(width, dpr) {
  const r = Number.isFinite(dpr) && dpr > 0 ? dpr
    : (typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1);
  return Math.max(1, Math.floor(width * r + 1e-6)) / r;
}

/**
 * Inline style for the disc's ring (its CSS border). Without an emitted ring
 * colour it is the fill, as it always was, so the ring stays unseen; with
 * none of either the output is exactly the old `border-color: <fill>;`. The
 * border is inside the disc (box-sizing: border-box), so a wider ring takes
 * its pixels from the fill and the marker keeps its size.
 * @param {string} color the marker fill
 * @param {string} [ringColor] empty or absent for the fill
 * @param {string} [ringWidth] empty or absent for 1 px
 * @returns {string} an inline style fragment
 */
export function ringStyle(color, ringColor, ringWidth) {
  const r = typeof ringColor === "string" ? ringColor.trim() : "";
  const w = ringWidthPx(ringWidth);
  return `border-color: ${r !== "" ? r : (color ?? "")};` + (w !== 1 ? ` border-width: ${w}px;` : "");
}

/**
 * The arrow's drawn size in CSS px for a marker of `size`: width 0.45 x size,
 * never under 8, and three quarters of that tall. One rule for the arrow and
 * for the delay badge, which must clear it.
 * @param {number} [size]
 * @returns {{w: number, h: number}}
 */
export function arrowSize(size) {
  const w = Math.max(8, Math.round((size || 24) * 0.45));
  return { w, h: Math.round(w * 0.75) };
}

/**
 * The narrowest the delay badge's label box may be, in CSS px: the disc, and
 * where an arrow is drawn, the arrow's reach beyond the ring on BOTH sides,
 * since the box is centred. The badge starts at the box's right edge, so it
 * clears the fill and an arrow pointing east (NICTD 515, 2026-10-04).
 * @param {number} size the disc
 * @param {boolean} hasArrow whether an arrow is drawn
 * @param {string} [ringWidth] the ring-width attribute
 * @returns {number}
 */
export function badgeMinWidth(size, hasArrow, ringWidth) {
  const disc = Number.isFinite(size) && size > 0 ? size : 0;
  if (!hasArrow) return disc;
  return disc + 2 * (arrowSize(size).h + drawnBorderPx(ringWidthPx(ringWidth)));
}

/**
 * The star (06_MAP_CONTRACT.md D4a `marker_shape`; Lee 2026-10-09 16:43:
 * "use the fuller star"). Inner points at half the outer radius.
 */
export const STAR_INNER = 0.5;
/** The inside star's scale: half the star's AREA (Lee: the border "take up 1/2 the star"). */
export const STAR_CORE = Math.SQRT1_2;
/**
 * How far above the star's centre its label sits, as a fraction of the
 * marker's size. 0: across the centre (Lee 2026-10-10 00:46: "drop the
 * numbers a bit so they run across the center"). It was 0.07 from
 * `629e52c`: a horizontal box fits a five-pointed star best a little above
 * the centre, and a 4-digit label then fitted a 50 px star (57 px centred).
 */
export const STAR_LABEL_LIFT = 0;

/**
 * A star's 1- and 2-character labels, larger (Lee 2026-10-10 00:46:
 * "Increase the size of the 1 number and 2 number numbers"): the font scale
 * by the label's length, 1 for any other length. The delay badge keeps its
 * own size.
 */
export const STAR_SHORT_LABEL_SCALE = Object.freeze({ 1: 1.5, 2: 1.3 });

/**
 * @param {unknown} label
 * @returns {number} the font scale for a star's label
 */
export function starLabelScale(label) {
  const n = label == null ? 0 : String(label).trim().length;
  return STAR_SHORT_LABEL_SCALE[n] || 1;
}

/** The star's thin white outline (Lee 16:43), drawn outside its edge. */
export const STAR_EDGE_COLOR = "#FFFFFF";

/**
 * A five-pointed star centred on 0,0, one point straight up, as an SVG
 * polygon `points` string.
 * @param {number} r outer radius
 * @param {number} [k] inner radius as a fraction of r
 * @returns {string}
 */
export function starPoints(r, k = STAR_INNER) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * k;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(rr * Math.cos(a)).toFixed(2)},${(rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/**
 * The star INSIDE a disc (06_MAP_CONTRACT.md D4a `marker_symbol: "star"`;
 * Lee 2026-10-11 05:23, "fuller, small margin"): the fuller star
 * (STAR_INNER), its points at DISC_STAR_SIZE of the inner disc's radius
 * (the disc inside the ring), dropped by DISC_STAR_DROP of its own radius
 * so it sits centred to the eye (a five-pointed star's points reach higher
 * above its centre than below). Drawn in a 200-unit box over the disc's
 * padding box, so the ring's width never moves it.
 */
export const DISC_STAR_SIZE = 0.88;
export const DISC_STAR_DROP = 0.06;
/** The disc star's fill when the emitter sends no `marker_symbol_color`. */
export const DISC_STAR_COLOR = "#FFFFFF";

/**
 * The look properties a `marker_alternate` may replace (EntityConfig
 * parseMarkerAlternate's output); nothing else is swapped.
 */
export const ALTERNATE_PROPS = Object.freeze(["title", "color", "labelColor", "labelOutline", "arrowColor",
  "arrowOutline", "ringColor", "ringWidth", "shape", "symbol", "labelPlacement", "symbolColor", "symbolOutline"]);

/**
 * The width of the star's white outline stroke: half of it is under the
 * fill (paint-order stroke), so it shows about 1 px at size 24 and 2 px at 48.
 * @param {number} size the marker's size, CSS px
 * @returns {number}
 */
export function starEdgeWidth(size) {
  return Math.max(2, size / 12);
}

/**
 * The star's label outline: HEAVIER than the disc's (Lee 16:43: "Increase
 * the white outline of numbers"), eight directions at 1.5 px instead of four
 * at 1, so a number that crosses the star's coloured edge stays readable.
 * @param {string} [outlineColor] empty or absent for the default dark
 * @returns {string} a text-shadow value
 */
export function starLabelOutline(outlineColor) {
  const o = typeof outlineColor === "string" ? outlineColor.trim() : "";
  // "none": no outline at all (Lee 2026-10-10 00:46, D4a).
  if (o.toLowerCase() === "none") return "none";
  const c = o !== "" ? o : "rgba(0, 0, 0, 0.8)";
  const d = 1.5;
  return [[-d, -d], [0, -d], [d, -d], [-d, 0], [d, 0], [-d, d], [0, d], [d, d]]
    .map(([x, y]) => `${x}px ${y}px 0 ${c}`).join(", ");
}

/**
 * The star's label style: the emitter's label colour, else dark (the star's
 * inside is the FILL, which a star emitter sets light), with starLabelOutline.
 * @param {string} [labelColor]
 * @param {string} [outlineColor]
 * @returns {string}
 */
export function starLabelStyle(labelColor, outlineColor) {
  const l = typeof labelColor === "string" ? labelColor.trim() : "";
  return `color: ${l !== "" ? l : "#212121"}; text-shadow: ${starLabelOutline(outlineColor)};`;
}

/**
 * The maple leaf (06_MAP_CONTRACT.md D4a `marker_shape: "maple"`; Lee
 * 2026-10-11 00:02, VIA Rail): the eleven-point leaf of the Flag of Canada,
 * in its own units. MAPLE_LEAF_VIEWBOX is its bounding box, measured with
 * getBBox in Chrome (bin\ltir_via_look\leafbox.html): x -1860..1860,
 * y -2000..2030.
 */
export const MAPLE_LEAF_PATH = "m-90 2030 45-863a95 95 0 0 0-111-98l-859 151 116-320a65 65 0 0 0-20-73l-941-762 212-99a65 65 0 0 0 34-79l-186-572 542 115a65 65 0 0 0 73-38l105-247 423 454a65 65 0 0 0 111-57l-204-1052 327 189a65 65 0 0 0 91-27l332-652 332 652a65 65 0 0 0 91 27l327-189-204 1052a65 65 0 0 0 111 57l423-454 105 247a65 65 0 0 0 73 38l542-115-186 572a65 65 0 0 0 34 79l212 99-941 762a65 65 0 0 0-20 73l116 320-859-151a95 95 0 0 0-111 98l45 863z";
export const MAPLE_LEAF_VIEWBOX = "-1860 -2000 3720 4030";
const MAPLE_LEAF_ASPECT = 3720 / 4030;
/** The outer band's width as a fraction of the marker (Lee: "wide enough to show on the map"). */
export const MAPLE_BAND = 0.12;
/** The leaf's height as a fraction of the marker (Lee: it "takes up most of the circle"). */
export const MAPLE_LEAF_SIZE = 0.58;
/** The disc's outline, inside the band (Lee: "The circle is outlined in #000000"). */
export const MAPLE_EDGE_COLOR = "#000000";
/** The leaf's colours when the emitter sends none (Lee: "#FF0000 outlined in #000000"). */
export const MAPLE_LEAF_COLOR = "#FF0000";
export const MAPLE_LEAF_OUTLINE = "#000000";

/**
 * The band's width in CSS px for a marker of `size`: MAPLE_BAND of it, never
 * under 3 so it still shows on a small marker.
 * @param {number} size
 * @returns {number}
 */
export function mapleBandPx(size) {
  return Math.max(3, (size || 24) * MAPLE_BAND);
}

/** The heading tag's font size as a fraction of the marker. */
export const TAG_FONT = 0.32;
/** Clear space between the marker's edge and the tag, CSS px. */
export const TAG_GAP = 2;
/** Where the tag goes when there is no heading: east, and the delay west. */
export const TAG_DEFAULT_ANGLE = 90;

/**
 * Where the label goes as a heading TAG (06_MAP_CONTRACT.md D4a
 * `marker_label_placement: "heading"`; Lee 2026-10-11 00:18: "make the
 * heading arrow the train number and keep the number horizontal"): its
 * centre's offset from the marker's centre, CSS px, along `angle` (0 north,
 * clockwise), far enough that the tag's box just clears the marker's edge
 * whichever side it is on, and the tag's size. Without a finite angle,
 * TAG_DEFAULT_ANGLE. The width is an estimate from the text's length
 * (0.62 em a character, bold digits); the tag is drawn centred on the point,
 * so an estimate off by a little moves only the gap.
 * @param {*} angle degrees, any number (accumulated angles allowed)
 * @param {number} size the marker, CSS px
 * @param {*} text the label
 * @param {boolean} [bare] no tag box: plain text (the delay)
 * @returns {{x: number, y: number, w: number, h: number, font: number, pad: number}}
 */
export function headingTag(angle, size, text, bare = false) {
  const s = Number.isFinite(size) && size > 0 ? size : 24;
  const n = text == null ? 0 : String(text).trim().length;
  const font = Math.max(10, Math.round(s * TAG_FONT));
  const pad = bare ? 0 : Math.round(font * 0.35);
  const h = bare ? font : font + Math.round(font * 0.35);
  const w = Math.round(font * 0.62 * n) + 2 * pad;
  const a = angle == null || String(angle).trim() === "" || !Number.isFinite(Number(angle))
    ? TAG_DEFAULT_ANGLE : Number(angle);
  const t = (a * Math.PI) / 180;
  const dx = Math.sin(t), dy = -Math.cos(t);
  const d = s / 2 + TAG_GAP + (Math.abs(dx) * w) / 2 + (Math.abs(dy) * h) / 2;
  return { x: +(dx * d).toFixed(2), y: +(dy * d).toFixed(2), w, h, font, pad };
}

/**
 * The tag's number colour when the emitter sends none: black or white,
 * whichever has the higher WCAG contrast against the tag's fill. Unlike a
 * label inside a disc (labelTextStyle), the tag's text sits wholly on its
 * own fill, so contrast with that fill is the right rule. Seen on the look
 * page 2026-10-11: white numbers on VIA's yellow (#FFCC00) tags barely
 * read; by this formula white is 1.5:1 there and black 13.9:1. A fill that
 * is not `#RRGGBB` keeps white.
 * @param {string} fill
 * @returns {string} "#000000" or "#FFFFFF"
 */
export function tagInk(fill) {
  const m = typeof fill === "string" ? /^#([0-9a-fA-F]{6})$/.exec(fill.trim()) : null;
  if (!m) return "#FFFFFF";
  const lin = (i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  const onWhite = 1.05 / (L + 0.05), onBlack = (L + 0.05) / 0.05;
  return onBlack > onWhite ? "#000000" : "#FFFFFF";
}

export default class MapCardEntityMarker extends LitElement {
  static get properties() {
    return {
      'entityId': {type: String, attribute: 'entity-id'},
      'title': {type: String, attribute: 'title'},
      'label': {type: String, attribute: 'label'},
      'prefix': {type: String, attribute: 'prefix'},
      'suffix': {type: String, attribute: 'suffix'},
      'tooltip': {type: String, attribute: 'tooltip'},
      'picture': {type: String, attribute: 'picture'},
      'barePicture': {type: String, attribute: 'bare-picture'},
      'groundShadow': {type: String, attribute: 'ground-shadow'},
      'rotation': {type: String, attribute: 'rotation'},
      'rotationTransition': {type: String, attribute: 'rotation-transition'},
      'icon': {type: String, attribute: 'icon'},
      'placeIcon': {type: String, attribute: 'place-icon'},
      'callout': {type: String, attribute: 'callout'},
      'color': {type: String, attribute: 'color'},
      'labelColor': {type: String, attribute: 'label-color'},
      'arrow': {type: String, attribute: 'arrow'},
      'labelOutline': {type: String, attribute: 'label-outline'},
      'arrowColor': {type: String, attribute: 'arrow-color'},
      'arrowOutline': {type: String, attribute: 'arrow-outline'},
      'ringColor': {type: String, attribute: 'ring-color'},
      'ringWidth': {type: String, attribute: 'ring-width'},
      'shape': {type: String, attribute: 'shape'},
      'symbol': {type: String, attribute: 'symbol'},
      'alternate': {type: String, attribute: 'alternate'},
      'labelPlacement': {type: String, attribute: 'label-placement'},
      'symbolColor': {type: String, attribute: 'symbol-color'},
      'symbolOutline': {type: String, attribute: 'symbol-outline'},
      'delayBadge': {type: String, attribute: 'delay-badge'},
      'delayLevel': {type: String, attribute: 'delay-level'},
      'pulse': {type: String, attribute: 'pulse'},
      'size': {type: Number},
      'tapAction': {type: Object, attribute: 'tap-action'},
      'info': {type: String, attribute: 'info'},
      'extraCssClasses': {type: String, attribute: 'extra-css-classes'},
    };
  }

  /**
   * One look, or two that take turns (D4a `marker_alternate`; Lee 2026-10-11
   * 16:11, the Maple Leaf). With an alternate, both looks are drawn stacked
   * and CSS fades between them (`ltmc-alt-a`/`-b`, each shown for `s`
   * seconds, a crossfade of an eighth of the cycle); nothing ticks in
   * JavaScript, so a slide in flight is not disturbed. Under
   * prefers-reduced-motion only the primary look is shown. Not for a pill.
   * @returns {unknown}
   */
  render() {
    const alt = this._alternateLook();
    if (!alt || this.placeIcon) return this._renderLook();
    const a = this._renderLook();
    const b = this._withLook(alt.look, () => this._renderLook());
    const cycle = 2 * alt.s;
    return html`
      <div class="alt-wrap" style="height: ${this.size}px; width: ${this.size}px;">
        <div class="alt-layer alt-a" style="animation-duration: ${cycle}s;">${a}</div>
        <div class="alt-layer alt-b" style="animation-duration: ${cycle}s;">${b}</div>
      </div>`;
  }

  /**
   * The `alternate` attribute decoded: the second look's property values and
   * the seconds each look is shown, or null (absent, empty, malformed).
   * @returns {{look: {[prop: string]: string}, s: number}|null}
   */
  _alternateLook() {
    if (typeof this.alternate !== "string" || this.alternate === "") return null;
    try {
      // A non-object throws (null) or has none of the look properties.
      const { s, ...look } = JSON.parse(decodeURIComponent(this.alternate));
      if (!ALTERNATE_PROPS.some((p) => p in look)) return null;
      const secs = Number.isFinite(s) && s > 0 ? s : 4;
      return { look, s: secs };
    } catch {
      return null;
    }
  }

  /**
   * Run `fn` with this element's look properties replaced by `look`, then
   * put them back. Only the look properties (ALTERNATE_PROPS) are touched.
   * @param {{[prop: string]: string}} look
   * @param {() => unknown} fn
   * @returns {unknown}
   */
  _withLook(look, fn) {
    const saved = {};
    for (const p of ALTERNATE_PROPS) {
      if (p in look) {
        saved[p] = this[p];
        this[p] = look[p];
      }
    }
    try {
      return fn();
    } finally {
      Object.assign(this, saved);
    }
  }

  _renderLook() {
    // When the entity is inside a named place, render a horizontal "pill":
    // a stadium outline holding two circles - the zone icon (left) and the
    // entity's initials (right). Otherwise fall back to the normal marker.
    if (this.placeIcon) {
      // Pill: zone icon (left) + initials (right). Geometry must match
      // Entity.createMapMarker. When `callout` is on (zoomed in) the pill sits
      // up-left of the point with a thin leader line down-right to a dot on the
      // exact location; otherwise it just centers on the point (no leader).
      const s = this.size;
      const pillW = 2 * s + 14;
      const pillH = s + 8;
      const pill = html`
        <div class="place-pill" style="border-color: ${this.color}; width: ${pillW}px; height: ${pillH}px;">
          <div class="pill-badge" style="border-color: ${this.color}; width: ${s}px; height: ${s}px;">
            <ha-icon icon="${this.placeIcon}" style="--icon-primary-color: ${this.color}; --mdc-icon-size: ${s - 14}px;"></ha-icon>
          </div>
          <div class="pill-badge pill-initials" style="border-color: ${this.color}; color: ${this.color}; width: ${s}px; height: ${s}px; font-size: ${Math.round(s * 0.5)}px;">
            ${this.title}
          </div>
        </div>`;
      if (this.callout !== "true") {
        return html`
          <div class="place-pill-wrap ${this.extraCssClasses ? this.extraCssClasses : ""}"
               style="width: ${pillW}px; height: ${pillH}px;"
               @click=${this._badgeTap}>
            ${pill}
          </div>`;
      }
      const off = Math.round(s * 0.7);
      const boxW = pillW + off;
      const boxH = pillH + off;
      const dotX = boxW - 2, dotY = boxH - 2;
      return html`
        <div class="place-pill-wrap ${this.extraCssClasses ? this.extraCssClasses : ""}"
             style="width: ${boxW}px; height: ${boxH}px;"
             @click=${this._badgeTap}>
          <svg class="pill-leader" width="${boxW}" height="${boxH}">
            <line x1="${pillW - 2}" y1="${pillH - 2}" x2="${dotX}" y2="${dotY}"
                  stroke="${this.color}" stroke-width="1.5"></line>
            <circle cx="${dotX}" cy="${dotY}" r="2.5" fill="${this.color}"></circle>
          </svg>
          ${pill}
        </div>
      `;
    }
    // The label as a heading tag (D4a `marker_label_placement: "heading"`):
    // the tag replaces the arrow and the label inside, and the delay moves to
    // the side opposite. Not on a picture or an icon, which draw their own.
    const tag = this._tagMode();
    if (this.shape === "star" && !this.picture && !this.icon) {
      // The star: no disc, no CSS ring. Arrow, pulse and delay badge as on
      // the disc, around the same box.
      return html`
        <div
          class="marker star ${this.extraCssClasses ? this.extraCssClasses : ""}"
          style="${starLabelStyle(this.labelColor, this.labelOutline)} height: ${this.size}px; width: ${this.size}px;${STAR_LABEL_LIFT > 0 ? ` padding-bottom: ${+(2 * STAR_LABEL_LIFT * this.size).toFixed(2)}px;` : ""}"
          @click=${this._badgeTap}
          >
          ${this._pulse()}
          ${this._star()}
          ${tag ? this._tag() : this._arrow()}
          ${tag ? this._delayOpposite() : this._inner()}
        </div>
      `;
    }
    if (this.shape === "maple" && !this.picture && !this.icon) {
      // The maple leaf: a disc in the fill with a wide band round it, both
      // drawn in SVG, no CSS ring.
      return html`
        <div
          class="marker maple ${this.extraCssClasses ? this.extraCssClasses : ""}"
          style="${starLabelStyle(this.labelColor, this.labelOutline)} height: ${this.size}px; width: ${this.size}px;"
          @click=${this._badgeTap}
          >
          ${this._pulse()}
          ${this._maple()}
          ${tag ? this._tag() : this._arrow()}
          ${tag ? this._delayOpposite() : this._inner()}
        </div>
      `;
    }
    // A symbol in the disc (D4a `marker_symbol`) replaces the label inside it;
    // the delay badge stays. Not on a picture or an icon.
    const sym = this.symbol === "star" && !this.picture && !this.icon;
    // A bare picture (D4a-picture): no disc and no ring behind it, not
    // clipped, and its delay beside it - opposite its tag, else east.
    const bare = this._bare();
    const disc = bare ? "background-color: transparent; border-color: transparent;"
      : `background-color: ${this.color}; ${ringStyle(this.color, this.ringColor, this.ringWidth)}`;
    return html`
        <div
          class="marker ${this.picture ? "picture" : ""}${bare ? " bare" : ""}  ${this.extraCssClasses ? this.extraCssClasses : ""}"
          style="${disc} ${labelTextStyle(this.color, this.labelColor, this.labelOutline)} height: ${this.size}px; width: ${this.size}px; ${this.picture ? groundShadowStyle(this.groundShadow, this.size) : ""}"
          @click=${this._badgeTap}
          >
          ${this._pulse()}
          ${sym ? this._discStar() : ""}
          ${tag ? this._tag() : this._arrow()}
          ${bare ? html`${this._inner()}${tag ? this._delayOpposite() : this._delayAt(TAG_DEFAULT_ANGLE)}`
            : tag ? this._delayOpposite() : sym ? this._withBadge("") : this._inner()}
        </div>
      `;
  };

  /**
   * Whether the label is drawn as a heading tag: asked for, there is a label
   * to draw, and the marker is not a picture or an icon.
   * @returns {boolean}
   */
  _tagMode() {
    if (this.labelPlacement !== "heading" || this.icon || (this.picture && !this._bare())) return false;
    return typeof this.title === "string" && this.title.trim() !== "";
  }

  /**
   * Whether the picture is drawn bare (D4a-picture): the card's Entity says
   * so (`bare-picture="true"`, display state or attribute with the entity's
   * own picture). Any other picture keeps its round, clipped disc.
   * @returns {boolean}
   */
  _bare() {
    return Boolean(this.picture) && this.barePicture === "true";
  }

  /**
   * The label as an upright tag outside the marker on the side it is heading
   * (Lee 2026-10-11 00:18, 00:33, option 2): the band colour (the ring, else
   * the fill), the label colour (else black or white by contrast, tagInk),
   * a black edge. It follows the
   * same angle as the arrow it replaces, so while the marker slides along
   * its track the tag sits on the line ahead; it moves round the marker with
   * the arrow's transition time.
   * @returns {unknown}
   */
  _tag() {
    const g = headingTag(this.arrow, this.size, this.title);
    const ring = typeof this.ringColor === "string" ? this.ringColor.trim() : "";
    const fill = ring !== "" ? ring : this.color;
    const l = typeof this.labelColor === "string" ? this.labelColor.trim() : "";
    const ink = l !== "" ? l : tagInk(fill);
    const t = Number(this.rotationTransition);
    const secs = Number.isFinite(t) && t >= 0 ? t : 0;
    return html`<div class="heading-tag" style="left: calc(50% + ${g.x}px); top: calc(50% + ${g.y}px); height: ${g.h}px; padding: 0 ${g.pad}px; font-size: ${g.font}px; line-height: ${g.h - 3}px; background-color: ${fill}; color: ${ink}; transition: left ${secs}s linear, top ${secs}s linear;">${this.title.trim()}</div>`;
  }

  /**
   * The delay badge in tag mode: on the side OPPOSITE the tag, so the two
   * never collide (Lee 2026-10-11 00:33, the fix that came with option 2).
   * Its colour is the lateness level's, with the default dark outline, as
   * beside a label. Nothing on time.
   * @returns {unknown}
   */
  _delayOpposite() {
    const a = this.arrow == null || String(this.arrow).trim() === "" || !Number.isFinite(Number(this.arrow))
      ? TAG_DEFAULT_ANGLE : Number(this.arrow);
    return this._delayAt(a + 180);
  }

  /**
   * The delay as plain text outside the marker at `angle` (0 north,
   * clockwise): opposite a heading tag, or east of a bare picture with no
   * tag (D4a-picture; Lee 2026-10-15 03:38). Nothing on time.
   * @param {number} angle
   * @returns {unknown}
   */
  _delayAt(angle) {
    const text = typeof this.delayBadge === "string" ? this.delayBadge.trim() : "";
    const color = latenessColor(this.delayLevel);
    if (text === "" || color === "") return "";
    const g = headingTag(angle, this.size, text, true);
    const t = Number(this.rotationTransition);
    const secs = Number.isFinite(t) && t >= 0 ? t : 0;
    // Its own class, not .delay-badge: that one is placed after the label
    // (LATENESS_CSS, appended last, would win over these rules).
    return html`<span class="heading-delay" style="left: calc(50% + ${g.x}px); top: calc(50% + ${g.y}px); font-size: ${g.font}px; color: ${color}; text-shadow: ${LABEL_OUTLINE}; transition: left ${secs}s linear, top ${secs}s linear;">${text}</span>`;
  }

  /**
   * The maple-leaf marker under its label (Lee 2026-10-11 00:02): a band of
   * MAPLE_BAND in the ring colour (else the fill), inside it the disc in the
   * fill outlined black, and the leaf, MAPLE_LEAF_SIZE of the marker tall,
   * in `marker_symbol_color` (else red) outlined in
   * `marker_symbol_outline_color` (else black). The other direction is the
   * EMITTER's: it swaps the fill and the ring and sends a white outline.
   * @returns {unknown}
   */
  _maple() {
    const r = this.size / 2;
    const ring = typeof this.ringColor === "string" ? this.ringColor.trim() : "";
    const band = ring !== "" ? ring : this.color;
    const sym = typeof this.symbolColor === "string" && this.symbolColor.trim() !== "" ? this.symbolColor.trim() : MAPLE_LEAF_COLOR;
    const line = typeof this.symbolOutline === "string" && this.symbolOutline.trim() !== "" ? this.symbolOutline.trim() : MAPLE_LEAF_OUTLINE;
    const leafH = this.size * MAPLE_LEAF_SIZE;
    const leafW = leafH * MAPLE_LEAF_ASPECT;
    return html`
      <svg class="maple-shape" width="${this.size}" height="${this.size}" viewBox="${-r} ${-r} ${2 * r} ${2 * r}">
        <circle r="${r}" fill="${band}"></circle>
        <circle r="${+(r - mapleBandPx(this.size)).toFixed(2)}" fill="${this.color}" stroke="${MAPLE_EDGE_COLOR}" stroke-width="1"></circle>
        <svg class="maple-leaf" x="${+(-leafW / 2).toFixed(2)}" y="${+(-leafH / 2).toFixed(2)}" width="${+leafW.toFixed(2)}" height="${+leafH.toFixed(2)}" viewBox="${MAPLE_LEAF_VIEWBOX}" overflow="visible">
          <path d="${MAPLE_LEAF_PATH}" fill="${sym}" stroke="${line}" stroke-width="1" vector-effect="non-scaling-stroke" stroke-linejoin="round"></path>
        </svg>
      </svg>`;
  }

  _badgeTap(ev) {
    // A marker with `marker_info` (D4e): the click goes on to Leaflet's marker, which opens the popup.
    if (this.info === "true") return;
    ev.stopPropagation();
    if (this.entityId) {
      // https://developers.home-assistant.io/blog/2023/07/07/action-event-custom-cards/
      const actions = {
        entity: this.entityId,
        // Passed from entity
        tap_action: this.tapAction
      };

      const event = new Event('hass-action', {bubbles: true, composed: true});
      event.detail = { config: actions, action: 'tap'};
      this.dispatchEvent(event);
    }
  }

  /**
   * A small arrow outside the disc's edge, pointing along `arrow` degrees
   * (0 = north, clockwise). Only its frame turns: the disc and the label
   * stay upright, which is the point (backlog 238). Not drawn on a picture
   * marker - `.marker.picture` clips its overflow, and a picture turns
   * itself with rotation_attribute - nor without an angle.
   * @returns {unknown}
   */
  _arrow() {
    const style = arrowStyle(this.arrow, this.rotationTransition);
    if (!style || this.picture) return "";
    const own = typeof this.arrowColor === "string" ? this.arrowColor.trim() : "";
    const c = typeof this.color === "string" ? this.color.trim() : "";
    const fill = own !== "" ? own : c !== "" && c.toLowerCase() !== "transparent" ? c : "currentColor";
    const ol = typeof this.arrowOutline === "string" ? this.arrowOutline.trim() : "";
    const stroke = ol !== "" ? ol : "rgba(0, 0, 0, 0.8)";
    const { w, h } = arrowSize(this.size);
    // The frame fills the PADDING box, inside the ring, so the arrow is lifted
    // by the ring's DRAWN width to sit on the disc's outer edge whatever the width.
    const ring = drawnBorderPx(ringWidthPx(this.ringWidth));
    return html`
      <div class="arrow-frame" style="${style}">
        <svg class="arrow" width="${w}" height="${h}" viewBox="0 0 10 7.5"
             style="top: ${-h - ring}px; margin-left: ${-w / 2}px;">
          <path d="M5 0.6 L9.4 6.9 L0.6 6.9 Z" fill="${fill}"
                stroke="${stroke}" stroke-width="1" stroke-linejoin="round"></path>
        </svg>
      </div>`;
  }

  /**
   * The star itself, under the label: the outer star in the ring colour (the
   * emitter's `marker_ring_color`, else the fill) with a thin white outline,
   * and the inside star, half its area, in the fill (`marker_color`).
   * @returns {unknown}
   */
  _star() {
    const r = this.size / 2;
    const ring = typeof this.ringColor === "string" ? this.ringColor.trim() : "";
    const band = ring !== "" ? ring : this.color;
    return html`
      <svg class="star-shape" width="${this.size}" height="${this.size}" viewBox="${-r} ${-r} ${2 * r} ${2 * r}">
        <polygon points="${starPoints(r)}" fill="${band}" stroke="${STAR_EDGE_COLOR}"
                 stroke-width="${starEdgeWidth(this.size)}" stroke-linejoin="round" paint-order="stroke"></polygon>
        <polygon points="${starPoints(r * STAR_CORE)}" fill="${this.color}"></polygon>
      </svg>`;
  }

  /**
   * The star inside the disc (D4a `marker_symbol: "star"`; Lee 2026-10-11
   * 05:23): the fuller star in `marker_symbol_color` (else white), outlined
   * in `marker_symbol_outline_color` when one is sent (else none), over the
   * disc's padding box - inside the ring, whatever its width.
   * @returns {unknown}
   */
  _discStar() {
    const fill = typeof this.symbolColor === "string" && this.symbolColor.trim() !== "" ? this.symbolColor.trim() : DISC_STAR_COLOR;
    const line = typeof this.symbolOutline === "string" ? this.symbolOutline.trim() : "";
    const r = 100 * DISC_STAR_SIZE;
    return html`
      <svg class="disc-symbol" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
        <polygon points="${starPoints(r, STAR_INNER)}" transform="translate(0 ${+(r * DISC_STAR_DROP).toFixed(2)})"
                 fill="${fill}" stroke="${line !== "" ? line : "none"}" stroke-width="1.2"
                 vector-effect="non-scaling-stroke" stroke-linejoin="round"></polygon>
      </svg>`;
  }

  _inner() {
    if(this.picture) {
      const hasLabel = shouldOverlayPictureLabel(this.prefix, this.suffix, this.label);
      return html`
        <div class="entity-picture" style="background-image: url(${this.picture}); ${pictureRotationStyle(this.rotation, this.rotationTransition)}"></div>
        ${hasLabel ? html`
          <div class="picture-label">
            <span class="prefix" style="display: ${this.prefix ? 'initial' : 'none'}">${this.prefix}</span>
            ${this.title}
            <span class="suffix" style="display: ${this.suffix ? 'initial' : 'none'}">${this.suffix}</span>
          </div>
        ` : ''}
      `;
    }
    if(this.icon) {
      return html`<ha-icon icon="${this.icon}" style="color: ${this.color}; --icon-primary-color: ${this.color}; --mdc-icon-size: ${this.size - 10}px;">icon</ha-icon>`
    }
    if (!this.prefix && !this.suffix) {
      const scale = this.shape === "star" ? starLabelScale(this.title) : 1;
      return this._withBadge(scale === 1 ? this.title
        : html`<span class="star-label" style="font-size: ${Math.round(scale * 100)}%;">${this.title}</span>`);
    } else {
      return this._withBadge(html`
        <span class="prefix" style="display: ${this.prefix ? 'initial' : 'none'}">${this.prefix}</span>
        ${this.title}
        <span class="suffix" style="display: ${this.suffix ? 'initial' : 'none'}">${this.suffix}</span>
      `);
    }
  }

  /**
   * The label with the delay badge after it: "835 +12" (backlog 275). The
   * badge is placed past the right edge of the label or of the disc,
   * whichever is further out, so it is always on the map, never on the fill,
   * and the label itself stays where it was, centred on the disc. Its colour is the lateness
   * level's, outlined with the DEFAULT dark outline whatever the emitter's
   * label outline: an orange outline round an amber badge would hide it.
   * Without a badge the label is returned untouched, so a train on time is
   * drawn exactly as before.
   * @param {unknown} label
   * @returns {unknown}
   */
  _withBadge(label) {
    const text = typeof this.delayBadge === "string" ? this.delayBadge.trim() : "";
    const color = latenessColor(this.delayLevel);
    if (text === "" || color === "") return label;
    // At least as wide as the disc and the arrow's reach, text centred: the
    // badge then starts past both even when the label fits inside the disc.
    // Without this a short label put the badge ON the fill - amber "+6" on
    // Lakeshore orange, seen live 2026-10-04 on NICTD 515 - and the next try
    // put it on that train's eastward arrow.
    // (A picture marker never gets here: _inner() draws its own label.)
    const hasArrow = Boolean(arrowStyle(this.arrow, this.rotationTransition));
    const minW = badgeMinWidth(this.size, hasArrow, this.ringWidth);
    return html`<span class="label-with-badge" style="min-width: ${minW}px;">${label}<span class="delay-badge" style="color: ${color}; text-shadow: ${LABEL_OUTLINE};">${text}</span></span>`;
  }

  /**
   * The slow pulse on a train that is late AND stalled (backlog 275): a ring
   * outside the disc and its halo, in the lateness colour, growing and fading;
   * a still ring under prefers-reduced-motion. The fill and the halo do not
   * change. Not on a picture marker, which clips its overflow.
   * @returns {unknown}
   */
  _pulse() {
    if (this.pulse !== "true" || (this.picture && !this._bare())) return "";
    const color = latenessColor(this.delayLevel);
    if (color === "") return "";
    // The ring is inside the border box: start the pulse 2 px outside the
    // DRAWN halo, whatever its width.
    const out = drawnBorderPx(ringWidthPx(this.ringWidth)) + 2;
    return html`<div class="stall-pulse" style="inset: ${-out}px; border-color: ${color};"></div>`;
  }

  static get styles() {
    return [css`
      .marker {
        display: flex;
        justify-content: center;
        align-items: center;
        box-sizing: border-box;
        width: 48px;
        height: 48px;
        font-size: var(--ha-marker-font-size, 1.5em);
        border-radius: var(--ha-marker-border-radius, 50%);
        border: 1px solid var(--ha-marker-color, var(--primary-color));
        color: var(--primary-text-color);
        background-color: var(--card-background-color);
        position: relative;
      }
      .arrow-frame {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .arrow {
        position: absolute;
        left: 50%;
        overflow: visible;
      }
      .marker.picture {
        overflow: hidden;
      }
      /* D4a-picture: a bare picture is not clipped, so its tag, delay and
         pulse outside the marker show. */
      .marker.picture.bare {
        overflow: visible;
      }
      .marker.star {
        background: transparent;
        border: none;
        border-radius: 0;
        font-weight: 700;
        isolation: isolate;
      }
      .star-shape {
        position: absolute;
        inset: 0;
        overflow: visible;
        pointer-events: none;
        z-index: -1;
      }
      .marker.maple {
        background: transparent;
        border: none;
        border-radius: 0;
        font-weight: 700;
        isolation: isolate;
      }
      .alt-wrap {
        position: relative;
      }
      .alt-layer {
        position: absolute;
        inset: 0;
        animation-iteration-count: infinite;
        animation-timing-function: ease-in-out;
      }
      .alt-a {
        animation-name: ltmc-alt-a;
      }
      .alt-b {
        animation-name: ltmc-alt-b;
        opacity: 0;
      }
      @keyframes ltmc-alt-a {
        0%, 37.5% { opacity: 1; }
        50%, 87.5% { opacity: 0; }
        100% { opacity: 1; }
      }
      @keyframes ltmc-alt-b {
        0%, 37.5% { opacity: 0; }
        50%, 87.5% { opacity: 1; }
        100% { opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .alt-a {
          animation: none;
          opacity: 1;
        }
        .alt-b {
          display: none;
        }
      }
      .disc-symbol {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
        pointer-events: none;
      }
      .maple-shape {
        position: absolute;
        inset: 0;
        overflow: visible;
        pointer-events: none;
        z-index: -1;
      }
      .heading-tag {
        position: absolute;
        transform: translate(-50%, -50%);
        box-sizing: border-box;
        border: 1.5px solid #000000;
        border-radius: 999px;
        font-weight: 800;
        white-space: nowrap;
        text-align: center;
        text-shadow: none;
        pointer-events: none;
        z-index: 1;
      }
      .heading-delay {
        position: absolute;
        transform: translate(-50%, -50%);
        line-height: 1;
        font-weight: 700;
        white-space: nowrap;
        pointer-events: none;
        z-index: 1;
      }
      .entity-picture {
        background-size: cover;
        height: 100%;
        width: 100%;
      }
      .picture-label {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.6);
        color: white;
        padding: 2px 4px;
        font-size: 0.7em;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .marker.dark {
        color: #ffffff;
        background: #1c1c1c;
      }
      /* The star and the maple leaf draw their own shape: no dark square
         behind them in dark mode. Seen on the look page 2026-10-11: every
         Amtrak star stood on a #1c1c1c square in dark mode, since the star
         (64d611a), because this rule comes after .marker.star. */
      .marker.star.dark,
      .marker.maple.dark {
        background: transparent;
      }
      .prefix {
        margin-right: var(--ha-marker-prefix-margin, 2px);
      }
      .suffix {
        margin-left: var(--ha-marker-suffix-margin, 2px);
      }
      .place-pill-wrap {
        position: relative;
      }
      .pill-leader {
        position: absolute;
        left: 0;
        top: 0;
        overflow: visible;
        pointer-events: none;
      }
      .place-pill {
        position: absolute;
        left: 0;
        top: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        box-sizing: border-box;
        padding: 3px 5px;
        border-radius: 999px;
        border: 1px solid var(--ha-marker-color, var(--primary-color));
        background-color: var(--card-background-color);
        font-size: var(--ha-marker-font-size, 1.5em);
        white-space: nowrap;
      }
      .place-pill .pill-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        border-radius: 50%;
        border: 1px solid var(--ha-marker-color, var(--primary-color));
        background-color: var(--card-background-color);
        color: var(--primary-text-color);
        flex: 0 0 auto;
      }
      .place-pill .pill-initials {
        font-weight: 700;
        text-align: center;
        line-height: 1;
      }
      .place-pill.dark,
      .place-pill.dark .pill-badge {
        color: #ffffff;
        background: #1c1c1c;
      }
    `, unsafeCSS(LATENESS_CSS)];
  }
}
