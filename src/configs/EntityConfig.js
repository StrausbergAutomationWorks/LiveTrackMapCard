import HaMapUtilities from "../util/HaMapUtilities.js"
import Logger from "../util/Logger.js";
import CircleConfig from "./CircleConfig.js";
import GeoJsonConfig from "./GeoJsonConfig.js";

/**
 * The fill for a marker whose colour nobody set: no `color:` in the
 * dashboard and no valid `marker_color` on the entity. One neutral grey, so
 * an unset colour reads as "not classified". It replaces upstream's colour
 * hashed from the entity id, which gave every uncoloured object its own
 * arbitrary hue - indistinguishable from a colour that meant something.
 */
export const FALLBACK_MARKER_COLOR = "#757575";

const MARKER_COLOR_FORM = /^#[0-9a-fA-F]{6}$/;

/**
 * The `marker_color` attribute, if it has the one accepted form: `#` and
 * exactly six hex digits, any case (05_SHARED_LESSONS.md D4a). Anything
 * else - null, other types, three-digit or alpha hex, names, rgb()/hsl(),
 * surrounding whitespace - is treated as absent.
 * @param {*} value
 * @returns {string|null}
 */
export function parseMarkerColor(value) {
  return typeof value === "string" && MARKER_COLOR_FORM.test(value) ? value : null;
}

/** Bounds, in CSS px, of an emitted `marker_ring_width` (06_MAP_CONTRACT.md D4a 6b). */
export const RING_WIDTH_MIN = 0.5;
export const RING_WIDTH_MAX = 4;

/**
 * An emitted ring width: a JSON number from RING_WIDTH_MIN to RING_WIDTH_MAX
 * CSS px, fractions allowed, or null. Nothing else - no numeric strings, no
 * booleans, no NaN or Infinity - the same strictness as rule 2 for colours.
 * The width is the INTEGRATION's to choose (Lee, 2026-09-20); the card only
 * refuses what cannot be drawn. A browser floors a border to whole DEVICE
 * pixels, minimum one, so 1.5 draws 1 px on a 1x screen and 1.5 px (3
 * device px) on a 2x one. The ring is drawn inside the disc
 * (box-sizing: border-box), so each pixel is taken from the fill.
 * @param {*} value the attribute value
 * @returns {number|null}
 */
export function parseRingWidth(value) {
  return typeof value === "number" && Number.isFinite(value)
    && value >= RING_WIDTH_MIN && value <= RING_WIDTH_MAX ? value : null;
}

/**
 * Marker shapes an emitter may ask for with `marker_shape` (06_MAP_CONTRACT.md
 * D4a). Absent or anything else: the disc, as every marker was before.
 * "star": Live Track Intercity Rail's Amtrak (2026-10-09). "maple": a disc
 * with a maple leaf and a wide outer band, VIA Rail's (Lee 2026-10-11 00:02).
 */
export const MARKER_SHAPES = Object.freeze(["star", "maple"]);

/**
 * Where an emitter may ask for its label with `marker_label_placement`
 * (06_MAP_CONTRACT.md D4a). Absent or anything else: inside the marker, as
 * before. "heading": an upright tag OUTSIDE the marker on the side it is
 * heading, in place of the arrow (Lee 2026-10-11 00:18, 00:33).
 */
export const LABEL_PLACEMENTS = Object.freeze(["heading"]);

/**
 * Symbols an emitter may ask for inside the DISC with `marker_symbol`
 * (06_MAP_CONTRACT.md D4a). Absent or anything else: the label, as before.
 * "star": a five-pointed star filling the disc in place of the label, for a
 * run with no line number - SE Queensland's grey special shuttles (Lee
 * 2026-10-11 05:21, 05:23: "fuller, small margin").
 */
export const MARKER_SYMBOLS = Object.freeze(["star"]);

/**
 * An emitted `marker_symbol`: one of MARKER_SYMBOLS exactly, or null. The
 * same strictness as marker_shape.
 * @param {*} value the attribute value
 * @returns {string|null}
 */
export function parseMarkerSymbol(value) {
  return typeof value === "string" && MARKER_SYMBOLS.includes(value) ? value : null;
}

/**
 * `marker_alternate` (06_MAP_CONTRACT.md D4a-alternate; Lee 2026-10-11
 * 14:46, 16:11, the Maple Leaf: "slowly blink between its VIA badge and its
 * Amtrak badge ... the entire length"): a SECOND look the card fades to and
 * back, for one train sold under two railroads' badges. Each key is read with
 * the same rule as the primary key of the same name; an invalid key is
 * dropped, an absent key keeps the primary's value. Returns the marker
 * element's property names -> values, or null when nothing valid is left.
 */
export const ALTERNATE_COLORS = Object.freeze({
  marker_color: "color", marker_label_color: "labelColor", marker_arrow_color: "arrowColor",
  marker_arrow_outline_color: "arrowOutline", marker_ring_color: "ringColor",
  marker_symbol_color: "symbolColor", marker_symbol_outline_color: "symbolOutline",
});
/** The alternate label's longest length; a longer one is dropped. */
export const ALTERNATE_LABEL_MAX = 12;
/** Seconds each look is shown (`marker_alternate_s`), default and bounds. */
export const ALTERNATE_S_DEFAULT = 4;
export const ALTERNATE_S_MIN = 2;
export const ALTERNATE_S_MAX = 30;

/**
 * @param {*} value the `marker_alternate` attribute
 * @returns {{[prop: string]: string}|null}
 */
export function parseMarkerAlternate(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  const label = value.marker_label;
  if (typeof label === "string" && label.trim() !== "" && label.trim().length <= ALTERNATE_LABEL_MAX) {
    out.title = label.trim();
  } else if (typeof label === "number" && Number.isFinite(label) && String(label).length <= ALTERNATE_LABEL_MAX) {
    out.title = String(label);
  }
  for (const [key, prop] of Object.entries(ALTERNATE_COLORS)) {
    const c = parseMarkerColor(value[key]);
    if (c) out[prop] = c;
  }
  const outline = value.marker_label_outline_color;
  if (typeof outline === "string" && outline.trim().toLowerCase() === "none") out.labelOutline = "none";
  else if (parseMarkerColor(outline)) out.labelOutline = outline;
  const width = parseRingWidth(value.marker_ring_width);
  if (width != null) out.ringWidth = String(width);
  const shape = parseMarkerShape(value.marker_shape);
  if (shape) out.shape = shape;
  const symbol = parseMarkerSymbol(value.marker_symbol);
  if (symbol) out.symbol = symbol;
  const placement = parseLabelPlacement(value.marker_label_placement);
  if (placement) out.labelPlacement = placement;
  return Object.keys(out).length ? out : null;
}

/**
 * `marker_alternate_s`: seconds each look is shown, a JSON number from
 * ALTERNATE_S_MIN to ALTERNATE_S_MAX, else ALTERNATE_S_DEFAULT.
 * @param {*} value
 * @returns {number}
 */
export function parseAlternateSeconds(value) {
  return typeof value === "number" && Number.isFinite(value)
    && value >= ALTERNATE_S_MIN && value <= ALTERNATE_S_MAX ? value : ALTERNATE_S_DEFAULT;
}

/**
 * An emitted `marker_label_placement`: one of LABEL_PLACEMENTS exactly, or
 * null. The same strictness as marker_shape.
 * @param {*} value the attribute value
 * @returns {string|null}
 */
export function parseLabelPlacement(value) {
  return typeof value === "string" && LABEL_PLACEMENTS.includes(value) ? value : null;
}

/**
 * An emitted `marker_shape`: one of MARKER_SHAPES exactly, or null. The same
 * strictness as rule 2 for colours: no case folding, no whitespace.
 * @param {*} value the attribute value
 * @returns {string|null}
 */
export function parseMarkerShape(value) {
  return typeof value === "string" && MARKER_SHAPES.includes(value) ? value : null;
}

/**
 * 06_MAP_CONTRACT.md D10: an integration names its layer, the card owns the
 * numbers. Leaflet stacks a marker at its screen y plus zIndexOffset, so a
 * class is lifted only by a step larger than any screen height.
 */
export const MAP_LAYER_OFFSETS = Object.freeze({
  fixed: 0,
  water: 10000,
  rail: 20000,
  air_low: 30000,
  air: 40000,
});

/**
 * The offset for a `map_layer` attribute. Absent or unknown is `fixed`'s 0,
 * never an error: a third-party entity simply sits at the bottom.
 * @param {*} name
 * @returns {number}
 */
export function layerOffset(name) {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(MAP_LAYER_OFFSETS, name)
    ? MAP_LAYER_OFFSETS[name] : 0;
}

/**
 * A `z_index_offset` written in the DASHBOARD config: any finite number,
 * 0 and negatives included, else null. Upstream wrote
 * `config.z_index_offset ? config.z_index_offset : 1`, which turned an
 * explicit 0 into 1 and made "absent" 1 as well. D10 needs the explicit
 * value to win, whatever it is, and "absent" to fall through to map_layer.
 * @param {*} value
 * @returns {number|null}
 */
export function parseZIndexOffset(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export default class EntityConfig {
  /** @type {string} */
  id;
  /** @type {string} */
  display;
  /** @type {string} */
  attribute;
  /** @type {string} */
  prefix;
  /** @type {string} */
  suffix;
  /** @type {string} */
  label;
  /** @type {number} */
  size;
  /** @type {Date} */
  historyStart;
  /** @type {Date} */
  historyEnd;

  /** @type {string} */
  historyStartEntity;
  historyStartEntitySuffix;
  /** @type {string} */
  historyEndEntity;
  historyEndEntitySuffix;

  /** @type {string} */
  historyLineColor;
  /** @type {boolean} */
  historyShowDots;
  /** @type {boolean} */
  historyShowLines;
  /** @type {number} */
  fixedX;
  /** @type {number} */
  fixedY;
  /** @type {number} */
  fallbackX;
  /** @type {number} */
  fallbackY;
  /** @type {string} */
  css;
  // Cannot be set via config. Passed from parent
  historyManagedExternally;

  /** @type {string} */
  picture;
  /** @type {string} */
  icon;
  /**
   * The colour everything derived at config time uses (circle, GeoJSON,
   * history line): the configured `color`, else FALLBACK_MARKER_COLOR.
   * The MARKER's fill is resolved per update by Entity.markerColor, which
   * can also read the entity's `marker_color` attribute.
   * @type {string}
   */
  color;
  /**
   * `color` exactly as configured, or null when the dashboard set none.
   * A configured colour wins over the `marker_color` attribute.
   * @type {string|null}
   */
  configuredColor;
  /** @type {number} */
  gradualOpacity;
  /** @type {object} */
  tapAction;
  /** @type {boolean} */
  focusOnFit;
  /** @type {number|null} dashboard override; null means use map_layer (D10) */
  zIndexOffset;
  /** @type {boolean} */
  useBaseEntityOnly;
  /** @type {number} */
  positionUpdateThreshold;
  /**
   * @type {number|string} Seconds a marker takes to slide to a new position,
   * or 'auto' to use the entity's own update interval. 0 jumps, as before.
   */
  positionTransition;
  /**
   * @type {number} Min map zoom at which a `display: pill` marker shows the
   * offset callout + leader line; below it the pill centers on the point.
   */
  pillCalloutMinZoom;
  /**
   * @type {string|null} Entity attribute holding the angle, in degrees, to
   * turn a picture marker by. Null turns nothing.
   */
  rotationAttribute;
  /** @type {number} Seconds a change of angle takes to animate. 0 is instant. */
  rotationTransition;
  /**
   * @type {string|null} Entity attribute holding the bearing, in degrees, an
   * ARROW on the marker's edge points along (backlog 238). Only the arrow
   * turns; the disc and its label stay upright. Null draws no arrow.
   * Turns over rotationTransition, like a picture.
   */
  arrowAttribute;
  /**
   * @type {string|null} The dashboard's `label_color`. Wins over the
   * entity's `marker_label_color`, as `color` wins over `marker_color`.
   */
  configuredLabelColor;

  /** @type {CircleConfig} */
  circleConfig;
  /** @type {string} Entity ID containing distance value for tooltip display */
  distanceEntity;
  /** @type {string} Unit for distance display (km, mi, or auto) */
  distanceUnit;

  /** @type {GeoJsonConfig} */
  geoJsonConfig;

  /**
   * The entity's configuration exactly as written, serialised. Two configs
   * with the same fingerprint describe the same marker, which is how an
   * in-place entity update tells an unchanged entity from one whose options
   * changed.
   * @type {string}
   */
  fingerprint;

  constructor(config, defaults) {
    this.id = (typeof config === 'string' || config instanceof String) ? config : config.entity;
    this.fingerprint = JSON.stringify(config);
    this.display = config.display ? config.display : "marker";
    this.attribute = config.attribute ? config.attribute : "";
    this.prefix = config.display === "attribute" ? (config.prefix ? config.prefix : "") : "";
    this.suffix = config.display === "attribute" ? (config.suffix ? config.suffix : "") : "";
    this.label = config.label ?? null;
    this.size = config.size ? config.size : 48;
    // If historyLineColor not set, inherit icon color
    this.configuredColor = config.color ?? null;
    this.color = this.configuredColor ?? FALLBACK_MARKER_COLOR;
    this.gradualOpacity = config.gradual_opacity ? config.gradual_opacity : undefined;

    // Get history value to use (normal of default)
    const historyStart = config.history_start ?? defaults.historyStart;
    const historyEnd = config.history_end ?? defaults.historyEnd;

    // If start is an entity, setup entity config
    if (HaMapUtilities.isHistoryEntityConfig(historyStart)) {
      this.historyStartEntity = historyStart['entity'] ?? historyStart;
      this.historyStartEntitySuffix = historyStart['suffix'];
    } else {
      this.historyStart = historyStart ? HaMapUtilities.convertToAbsoluteDate(historyStart) : null;
    }

    // If end is an entity, setup entity config
    if (HaMapUtilities.isHistoryEntityConfig(historyEnd)) {
      this.historyEndEntity = historyEnd['entity'] ?? historyEnd;
      this.historyEndEntitySuffix = historyEnd['suffix'];
    } else {
      this.historyEnd = HaMapUtilities.convertToAbsoluteDate(historyEnd ?? 'now');
    }

    this.historyLineColor = config.history_line_color ?? this.color;
    this.historyShowDots = config.history_show_dots ?? true;
    this.historyShowLines = config.history_show_lines ?? true;
    this.fixedX = config.fixed_x;
    this.fixedY = config.fixed_y;
    this.fallbackX = config.fallback_x;
    this.fallbackY = config.fallback_y;
    this.css = config.css ?? "text-align: center; font-size: 60%;";
    this.picture = config.picture ?? null;
    this.icon = config.icon ?? null;

    // If no start/end date values are given, fallback to using date range manager
    this.usingDateRangeManager = (!historyStart && !historyEnd) && defaults.dateRangeManagerEnabled;

    // Tap action defaults to standard more-info.
    this.tapAction = (typeof config.tap_action == 'object') ? this.parseAction(config.tap_action) : { action: 'more-info' };

    this.focusOnFit = config.focus_on_fit ?? true;
    this.zIndexOffset = parseZIndexOffset(config.z_index_offset);

    this.useBaseEntityOnly = config.use_base_entity_only ?? false;
    this.positionUpdateThreshold = config.position_update_threshold ?? 10;
    this.positionTransition = config.position_transition === "auto"
      ? "auto"
      : EntityConfig._nonNegativeSeconds(config.position_transition);
    this.pillCalloutMinZoom = config.pill_callout_min_zoom ?? 15;
    this.rotationAttribute = EntityConfig._nonEmptyString(config.rotation_attribute);
    this.rotationTransition = EntityConfig._nonNegativeSeconds(config.rotation_transition);
    this.arrowAttribute = EntityConfig._nonEmptyString(config.arrow_attribute);
    this.configuredLabelColor = EntityConfig._nonEmptyString(config.label_color);

    this.circleConfig = new CircleConfig(config.circle, this.color);
    this.geoJsonConfig = new GeoJsonConfig(config.geojson, this.color);

    // Distance tooltip configuration
    this.distanceEntity = config.distance_entity ?? null;
    this.distanceUnit = config.distance_unit ?? 'auto';

    Logger.debug(
      `[EntityConfig]: created with id: ${this.id}, display: ${this.display}, attribute: ${this.attribute}, prefix: ${this.prefix}, suffix: ${this.suffix}, size: ${this.size}, historyStart: ${this.historyStart}, historyEnd: ${this.historyEnd}, historyStartEntity: ${this.historyStartEntity}, historyEndEntity: ${this.historyEndEntity}, historyLineColor: ${this.historyLineColor}, historyShowDots: ${this.historyShowDots}, historyShowLines: ${this.historyShowLines}, fixedX: ${this.fixedX}, fixedY: ${this.fixedY}, fallbackX: ${this.fallbackX}, fallbackY: ${this.fallbackY}, css: ${this.css}, picture: ${this.picture}, icon: ${this.icon}, color: ${this.color}, gradualOpacity: ${this.gradualOpacity}, tapAction: ${this.tapAction}, focusOnFit: ${this.focusOnFit}, zIndexOffset: ${this.zIndexOffset}, useBaseEntityOnly: ${this.useBaseEntityOnly}, circleConfig: ${this.circleConfig}, geoJsonConfig: ${this.geoJsonConfig}`
    );
  }

  // Get tap action_data
  parseAction(tap_action) {
    // No additional props
    if (['more-info', 'none'].includes(tap_action.action)) {
      return {
        action: tap_action.action,
      };
    }

    if (tap_action.action == 'navigate') {
      // Validate
      if (!tap_action.navigation_path) throw new Error("'navigation_path' is required when using action 'navigate'");

      return {
        action: tap_action.action,
        navigation_path: tap_action.navigation_path
      };
    }
    if (tap_action.action == 'url') {
      // Validate
      if (!tap_action.url_path) throw new Error("'url_path' is required when using action 'url'");

      return {
        action: tap_action.action,
        url_path: tap_action.url_path
      };
    }

    if (tap_action.action == 'call-service') {
      // Validate
      if (!tap_action.service) throw new Error("'service' is required when using action 'call-service'");
      return {
        action: tap_action.action,
        service: tap_action.service,
        // I belive this is truely optional.
        data: tap_action.data
      };
    }

    throw Error(`Unknown tap action "${tap_action.action}". Ensure action on tap_action is set.`);
  }

  /**
   * @param {*} value
   * @returns {string|null}
   */
  static _nonEmptyString(value) {
    return (typeof value === "string" && value.trim() !== "") ? value.trim() : null;
  }

  /**
   * @param {*} value
   * @returns {number} the value if it is a finite, non-negative number of seconds, else 0
   */
  static _nonNegativeSeconds(value) {
    if (typeof value !== "number" && typeof value !== "string") return 0;
    const n = Number(value);
    return (Number.isFinite(n) && n >= 0) ? n : 0;
  }

  get hasHistory() {
    return this.historyStart != null || this.historyStartEntity != null || this.usingDateRangeManager === true;
  }
}
