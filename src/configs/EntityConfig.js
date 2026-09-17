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
  /** @type {number} */
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
    this.zIndexOffset = config.z_index_offset ? config.z_index_offset : 1;

    this.useBaseEntityOnly = config.use_base_entity_only ?? false;
    this.positionUpdateThreshold = config.position_update_threshold ?? 10;
    this.positionTransition = config.position_transition === "auto"
      ? "auto"
      : EntityConfig._nonNegativeSeconds(config.position_transition);
    this.pillCalloutMinZoom = config.pill_callout_min_zoom ?? 15;
    this.rotationAttribute = EntityConfig._nonEmptyString(config.rotation_attribute);
    this.rotationTransition = EntityConfig._nonNegativeSeconds(config.rotation_transition);

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
