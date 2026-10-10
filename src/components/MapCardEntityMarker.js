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
      'delayBadge': {type: String, attribute: 'delay-badge'},
      'delayLevel': {type: String, attribute: 'delay-level'},
      'pulse': {type: String, attribute: 'pulse'},
      'size': {type: Number},
      'tapAction': {type: Object, attribute: 'tap-action'},
      'extraCssClasses': {type: String, attribute: 'extra-css-classes'},
    };
  }

  render() {
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
          ${this._arrow()}
          ${this._inner()}
        </div>
      `;
    }
    return html`
        <div
          class="marker ${this.picture ? "picture" : ""}  ${this.extraCssClasses ? this.extraCssClasses : ""}"
          style="background-color: ${this.color}; ${ringStyle(this.color, this.ringColor, this.ringWidth)} ${labelTextStyle(this.color, this.labelColor, this.labelOutline)} height: ${this.size}px; width: ${this.size}px;"
          @click=${this._badgeTap}
          >
          ${this._pulse()}
          ${this._arrow()}
          ${this._inner()}
        </div>
      `;
  };

  _badgeTap(ev) {
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
    if (this.pulse !== "true" || this.picture) return "";
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
