
import { DivIcon, LatLng, Map, Marker } from "leaflet";
import Circle from "./Circle.js";
import GeoJson from "./GeoJson.js";
import Logger from "../util/Logger.js"
import EntityConfig, { parseMarkerColor, parseRingWidth } from "../configs/EntityConfig.js";
import EntityHistoryManager from "./EntityHistoryManager.js";
import TimelineEntry from "./TimelineEntry.js";

/**
 * The custom element every marker is built from. index.js registers it under
 * this name; anything that looks a marker up by tag must use this constant, or
 * it queries an element this card never defines and silently finds nothing.
 */
export const MARKER_TAG = "live-track-map-card-entity-marker";

/**
 * @param {unknown} v
 * @returns {boolean} true for a number that is not NaN or infinite
 */
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Where a marker seen for the FIRST time should start, so that a card opened
 * mid-segment shows the object where a card open all along would have it,
 * instead of holding it still until the integration's next update.
 *
 * The entity publishes the segment it has just completed
 * (06_MAP_CONTRACT.md D3c): `previous_latitude`/`previous_longitude`, the
 * newest fix (its position) observed at `observed_at`, and
 * `segment_duration_s` between them. A card open all along started sliding
 * previous -> current when that fix arrived and finishes one segment later.
 * So, with f = (now - observed_at) / segment_duration_s clamped to 0..1:
 * start at previous + f * (current - previous), slide the remaining
 * (1 - f) * segment_duration_s. f >= 1 means that slide is already over:
 * no catch-up, the marker is placed at current.
 *
 * CLOCKS. `now` is the BROWSER's wall clock and `observed_at` was stamped by
 * the SERVER, or by the source behind it; the two can disagree by seconds or
 * more. The clamp absorbs it: a browser behind the server gives a negative
 * elapsed time and f = 0, a slide over the whole segment; a browser ahead
 * gives a larger f, a shorter slide, or none. Neither draws the object
 * anywhere off the segment between its two observed fixes.
 *
 * Returns null - place the marker at current and do not move it, which is
 * what the contract requires when previous_* is absent - when any of
 * previous_latitude, previous_longitude, segment_duration_s is missing, not
 * a number or not finite; when either coordinate is out of range; when
 * segment_duration_s is not positive; when observed_at is missing or does not
 * parse; or when f >= 1. previous_observed_at is NOT read: segment_duration_s
 * is the interval, and the formula needs nothing else.
 * @param {{[key: string]: unknown}} attributes the entity's attributes
 * @param {number} nowMs browser wall clock, ms since the epoch
 * @returns {{previous: {lat: number, lng: number}, fraction: number,
 *   elapsedSeconds: number, remainingSeconds: number}|null}
 */
export function catchUpFromPrevious(attributes, nowMs) {
  const a = attributes ?? {};
  const lat = a.previous_latitude, lng = a.previous_longitude;
  const seg = a.segment_duration_s;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng) || !isFiniteNumber(seg)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || seg <= 0) return null;
  if (typeof a.observed_at !== "string" || !isFiniteNumber(nowMs)) return null;
  const observedMs = Date.parse(a.observed_at);
  if (!Number.isFinite(observedMs)) return null;
  const fraction = Math.min(1, Math.max(0, (nowMs - observedMs) / 1000 / seg));
  if (fraction >= 1) return null;
  return {
    previous: { lat, lng },
    fraction,
    elapsedSeconds: fraction * seg,
    remainingSeconds: (1 - fraction) * seg,
  };
}

export default class Entity {
  /** @type {EntityConfig} */
  config;
  /** 
   * @private 
   * @type {Marker} 
   */
  marker;
  /** 
   * @private 
   * @type {object} 
   */
  hass;
  /** 
   * @private 
   * @type {Map}
   */
  map;
  /**
   * @private 
   * @type {string} 
   */
  _currentTitle;
  /**
   * The picture the marker element was last given, so update() can tell
   * when the entity starts serving a different one.
   * @private
   * @type {string|null}
   */
  _currentPicture;
  /**
   * The continuous angle last computed by rotationDegrees().
   * @private
   * @type {number|undefined}
   */
  _rotation;
  /**
   * The angle the marker element was last given.
   * @private
   * @type {number|null}
   */
  _currentRotation;
  /**
   * The continuous angle last computed by arrowDegrees().
   * @private
   * @type {number|undefined}
   */
  _arrow;
  /**
   * The arrow angle and label colour the marker element was last given.
   * @private
   * @type {number|null|undefined}
   */
  _currentArrow;
  /**
   * @private
   * @type {string|null|undefined}
   */
  _currentLabelColor;
  /**
   * The styling (markerStyling) the marker element was last given.
   * @private
   * @type {{[attr: string]: string}|undefined}
   */
  _currentStyling;
  /**
   * The fill the marker element was last given.
   * @private
   * @type {string|undefined}
   */
  _currentColor;
  /** 
   * @private
   * @type {boolean} 
   */
  darkMode;
  /**
   * @private
   * @type {Circle}
   */
  circle;
  /**
   * @private
   * @type {GeoJson}
   */
  geoJson;
  /**
   * @private
   * @type {EntityHistoryManager}
   */
  historyManager;
  /** 
   * @private 
   * @type {TimelineEntry} 
   */
  currentTimelineEntry;
  /**
   * @private
   * @type {LatLng}
   */
  _currentLatLng;
  /**
   * @private
   * @type {LatLng}
   */
  _lastSetLatLng;
  /**
   * The animation frame of a marker slide in progress.
   * @private
   * @type {number|null}
   */
  _transitionFrame = null;
  /**
   * When this entity's position last changed, for position_transition 'auto'.
   * @private
   * @type {number|undefined}
   */
  _lastMoveAt;
  /**
   * Set by remove(). A removed entity never draws again.
   * @type {boolean}
   */
  removed = false;

  constructor(config, hass, map, historyService, dateRangeManager, linkedEntityService, darkMode) {
    this.config = config;
    this.hass = hass;
    this.map = map;
    this.darkMode = darkMode;

    if (this.display == "state" || this.display == "attribute") {
      this._currentTitle = this.title;
    }
    this.circle = new Circle(this.config.circleConfig, this);
    this.geoJson = new GeoJson(this.config.geoJsonConfig, this);
    this.historyManager = new EntityHistoryManager(this, historyService, dateRangeManager, linkedEntityService);
  }

  get id() {
    return this.config.id;
  }

  get display() {
    return this.config.display;
  }



  /** @returns {object} */
  get state() {
    return this.hass.formatEntityState(this.hass.states[this.id], this.currentTimelineEntry?.state.s) ?? this.hass.formatEntityState(this.hass.states[this.id]);
  }

  /** @returns {{[key: string]: object}} */
  get attributes() {
    return this.currentTimelineEntry?.state.a ?? this.hass.states[this.id]?.attributes ?? {};
  }

  /** 
   * @private 
   * @returns {string}
   */
  get picture() {
    // If no configured picture, fallback to entity picture
    let picture = this.config.picture ?? this.attributes.entity_picture;
    // Skip if neither found and return null
    return picture ? this.hass.hassUrl(picture) : null;
  }

  /**
   * The picture the marker should show: none for display modes that draw an
   * icon or a text label instead.
   * @private
   * @returns {string|null}
   */
  get markerPicture() {
    if (this.display == "icon" || this.display == "state" || this.display == "attribute") {
      return null;
    }
    return this.picture;
  }

  /**
   * The marker's fill: the dashboard's `color` if one is configured, else
   * the entity's `marker_color` attribute if it is valid
   * (05_SHARED_LESSONS.md D4a), else the neutral fallback.
   *
   * Read per update, not at config time: an integration may start sending a
   * colour after the marker exists (a vessel's type arriving, say).
   * @returns {string}
   */
  get markerColor() {
    return this.config.configuredColor
      ?? parseMarkerColor(this.attributes.marker_color)
      ?? this.config.color;
  }

  /**
   * The label's text colour, or null for the default (white on a fill).
   *
   * The dashboard's `label_color` wins, as `color` wins for the fill. The
   * entity's `marker_label_color` (06_MAP_CONTRACT.md D4a rule 6, amended
   * 2026-09-20) is used only when the FILL is the entity's own too: an
   * emitter picks its label colour against its own fill, so under a
   * dashboard `color:` it could be unreadable - #7F281F on a dashboard's
   * dark red, say. A dashboard that overrides the fill and wants a coloured
   * label sets `label_color` as well.
   * @returns {string|null}
   */
  get markerLabelColor() {
    if (this.config.configuredLabelColor) return this.config.configuredLabelColor;
    return this._emitterColor("marker_label_color");
  }

  /**
   * A colour the EMITTER chose for its marker's appearance, from attribute
   * `key`, or null. Same form as marker_color (06_MAP_CONTRACT.md D4a rule
   * 2). Ignored under a dashboard `color:`: an emitter picks these as a set
   * against its own fill, and a set half-applied to someone else's fill is
   * a guess. Each integration styles its markers by emitting these; the card
   * holds no per-integration styling (Lee, 2026-09-20).
   * @private
   * @param {string} key attribute name
   * @returns {string|null}
   */
  _emitterColor(key) {
    if (this.config.configuredColor) return null;
    return parseMarkerColor(this.attributes[key]);
  }

  /**
   * The marker's emitter-chosen styling beyond fill and label colour, as the
   * marker element's attribute names -> values ("" = the card's default):
   * label-outline (`marker_label_outline_color`, default dark), arrow-color
   * (`marker_arrow_color`, default the fill), arrow-outline
   * (`marker_arrow_outline_color`, default dark), ring-color
   * (`marker_ring_color`, default the fill - the ring is there today, in the
   * fill's own colour, and so unseen) and ring-width (`marker_ring_width`,
   * CSS px, fractions allowed, default 1). The width belongs to the same set, so it too is
   * ignored under a dashboard `color:`.
   * @returns {{[attr: string]: string}}
   */
  get markerStyling() {
    const width = this.config.configuredColor ? null : parseRingWidth(this.attributes.marker_ring_width);
    return {
      "label-outline": this._emitterColor("marker_label_outline_color") ?? "",
      "arrow-color": this._emitterColor("marker_arrow_color") ?? "",
      "arrow-outline": this._emitterColor("marker_arrow_outline_color") ?? "",
      "ring-color": this._emitterColor("marker_ring_color") ?? "",
      "ring-width": width == null ? "" : String(width),
    };
  }

  /**
   * The angle an ARROW on the marker's edge points along, or null for no
   * arrow (backlog 238). Continuous for the same reason as
   * rotationDegrees(), with its own running angle.
   *
   * No value means no arrow (D0). Holding a bearing while the object is at
   * rest is the EMITTER's job (06_MAP_CONTRACT.md D4, `icon_rotation_basis:
   * held`), so the card draws exactly what the attribute says.
   * @returns {number|null}
   */
  arrowDegrees() {
    const attr = this.config.arrowAttribute;
    if (!attr) return null;
    const raw = Entity._angleOf(this.attributes[attr]);
    if (raw === null) return null;
    this._arrow = Entity._continue(this._arrow, raw);
    return this._arrow;
  }

  /**
   * A finite angle from a number or a numeric string, else null.
   * @private
   * @param {unknown} value
   * @returns {number|null}
   */
  static _angleOf(value) {
    if (typeof value !== "number" && !(typeof value === "string" && value.trim() !== "")) {
      return null;
    }
    const raw = Number(value);
    return Number.isFinite(raw) ? raw : null;
  }

  /**
   * The next angle in a continuous sequence: the first normalised to 0..360,
   * each later one the previous plus the shortest turn to `raw`.
   * @private
   * @param {number|undefined} previous
   * @param {number} raw
   * @returns {number}
   */
  static _continue(previous, raw) {
    if (previous === undefined) return ((raw % 360) + 360) % 360;
    return previous + ((((raw - previous) % 360) + 540) % 360) - 180;
  }

  /**
   * The angle to turn the marker's picture by, in degrees, or null when
   * rotation is not configured or the attribute holds no usable number.
   *
   * KEPT CONTINUOUS ON PURPOSE. A CSS transition interpolates the number it
   * is given, so a bearing crossing north - 350 to 10 - written as 10 would
   * turn the marker 340 degrees backwards. Each call adds the shortest delta
   * to the last angle instead, giving 370. A missing value returns null but
   * keeps the last angle, so the turn stays short when the value returns.
   * @returns {number|null}
   */
  rotationDegrees() {
    const attr = this.config.rotationAttribute;
    if (!attr) return null;
    const value = this.attributes[attr];
    if (typeof value !== "number" && !(typeof value === "string" && value.trim() !== "")) {
      return null;
    }
    const raw = Number(value);
    if (!Number.isFinite(raw)) return null;
    if (this._rotation === undefined) {
      this._rotation = ((raw % 360) + 360) % 360;
    } else {
      this._rotation += ((((raw - this._rotation) % 360) + 540) % 360) - 180;
    }
    return this._rotation;
  }

  /** @returns {LatLng} */
  get latLng() {
    if (this.config.fixedX && this.config.fixedY) {
      return new LatLng(this.config.fixedX, this.config.fixedY);
    }

    if (this._currentLatLng) {
      return this._currentLatLng;
    }

    // Do we have Lng/Lat directly?
    if (this.attributes.latitude && this.attributes.longitude) {
      return new LatLng(this.attributes.latitude, this.attributes.longitude);
    }

    // Get Lat/Lng of entity. Some entities such as "person" define device_trackers allowing
    // multiple lat/lng sources to be used. This method will call down through these looking for a
    // lat/lng value if none is defined on the parent entity.
    // If any, see if we can get a lng/lat from one instead
    let subTrackerIds = this.attributes.device_trackers ?? []
    for (let t = 0; t < subTrackerIds.length; t++) {
      const entity = this.hass.states[subTrackerIds[t]];
      if (entity?.attributes?.latitude && entity.attributes.longitude) {
        return new LatLng(entity.attributes.latitude, entity.attributes.longitude);
      }
    }

    if (this._lastSetLatLng) {
      return this._lastSetLatLng;
    }

    if (this.config.fallbackX && this.config.fallbackY) {
      return new LatLng(this.config.fallbackX, this.config.fallbackY);
    }

    Logger.warn("Entity: " + this.id + " has no latitude & longitude; skipping marker");
    return null;
  }

  setup(clusterGroup = null) {
    // Only add marker if GeoJSON is not configured to hide it and we have a
    // position. Missing/unknown coords used to throw here and abort the rest
    // of the card (#91, #173).
    if (!this.config.geoJsonConfig?.hideMarker && this.latLng) {
      const catchUp = this._catchUpPlan();
      this.marker = this.createMapMarker(catchUp?.start);

      // Bind distance tooltip if configured
      if (this.config.distanceEntity) {
        this.marker.bindTooltip('', {
          permanent: true,
          direction: 'top',
          offset: [0, -this.config.size / 2 - 5],
          className: 'distance-tooltip'
        });
        this.updateDistanceTooltip(this.hass);
      }

      if (clusterGroup) {
        Logger.debug("[Entity] Adding marker for " + this.id + " to cluster group");
        clusterGroup.addLayer(this.marker);
      } else {
        Logger.debug("[Entity] Adding marker for " + this.id + " directly to map");
        this.marker.addTo(this.map);
      }
      // Initialize last set position to prevent immediate update
      this._lastSetLatLng = this.latLng;
      // Added to the map or cluster group first, so the slide moves a marker
      // that is already there.
      if (catchUp) this._startCatchUp(catchUp);
      // Track the current place so update() can recreate the pill on zone change
      this._currentPlaceIcon = this.placeIcon;
      this._clusterGroup = clusterGroup;
      // For `display: pill`, the offset callout + leader only show at/above
      // pillCalloutMinZoom; recreate the marker when zoom crosses that boundary
      // so it isn't obtrusive when zoomed out region-wide.
      if (this.display == "pill") {
        this._calloutActive = this.map.getZoom() >= this.config.pillCalloutMinZoom;
        this._onZoomEnd = () => {
          if (!this.marker) return;
          const active = this.map.getZoom() >= this.config.pillCalloutMinZoom;
          if (active !== this._calloutActive) {
            this._calloutActive = active;
            this._recreateMarker();
          }
        };
        this.map.on("zoomend", this._onZoomEnd);
      }
    }
    this.historyManager.setup();
    this.circle.setup();
    this.geoJson.setup();
  }

  /**
   * Remove and rebuild the marker in place (preserving cluster membership).
   * @private
   */
  _recreateMarker() {
    const cg = this._clusterGroup;
    this.marker.remove();
    this.marker = this.createMapMarker();
    if (cg) {
      cg.addLayer(this.marker);
    } else {
      this.marker.addTo(this.map);
    }
    this._currentTitle = this.title;
    this._currentPlaceIcon = this.placeIcon;
  }

  /** @param {TimelineEntry} entry */
  react(entry) {
    if (entry.entityId == this.id) {
      this.currentTimelineEntry = entry;
    }
    this._currentLatLng = new LatLng(entry.latitude, entry.longitude);
  }

  get friendlyName() {
    return this.attributes.friendly_name ?? this.id;
  }

  /** @returns {string} */
  get title() {
    // Use custom label if provided
    if (this.config.label) {
      return this.config.label;
    }
    if (this.display == "state") {
      return this.state;
    }
    if (this.display == "attribute") {
      return this.hass.formatEntityAttributeValue(this.hass.states[this.id], this.config.attribute);
    }
    const title = this.friendlyName;
    if (title.length < 5) {
      return title;
    }
    const regex = /[ _/-]/;
    return title
      .split(regex)
      .map((part) => part[0])
      .join("")
      .substr(0, 3)
      .toUpperCase();
  }

  /** @returns {string} */
  get tooltip() {
    // placeName only resolves in pill mode and when inside a zone.
    const placeName = this.placeName;
    if (placeName) {
      // "<person> is at <place>" - strip a trailing tracker-ish suffix so
      // "Mom Location" reads as "Mom is at Extended Family".
      const who = (this.friendlyName ?? "").replace(/\s+(location|tracker|device|phone|gps)$/i, "");
      return `${who} is at ${placeName}`;
    }
    return this.friendlyName ?? "";
  }

  get icon() {
    return this.config.icon ?? this.attributes.icon;
  }

  /**
   * The HA zone state object the entity is currently inside (a "named place"),
   * or null when it isn't in one. Drives the place-pill marker. Matches the
   * entity's RAW state against each zone's friendly_name (case-insensitive);
   * the home zone reports state "home".
   * @returns {object|null}
   */
  get zoneState() {
    const raw = this.hass.states[this.id]?.state;
    if (!raw || ["not_home", "away", "unknown", "unavailable"].includes(raw.toLowerCase())) {
      return null;
    }
    const target = raw.toLowerCase();
    for (const eid in this.hass.states) {
      if (!eid.startsWith("zone.")) continue;
      const fn = (this.hass.states[eid].attributes?.friendly_name ?? "").toLowerCase();
      if (fn && fn === target) {
        return this.hass.states[eid];
      }
    }
    if (target === "home" && this.hass.states["zone.home"]) {
      return this.hass.states["zone.home"];
    }
    return null;
  }

  /** @returns {string|null} mdi icon of the current named place (pill mode only). */
  get placeIcon() {
    if (this.display != "pill") return null;
    const z = this.zoneState;
    return z ? (z.attributes?.icon ?? "mdi:map-marker") : null;
  }

  /** @returns {string|null} friendly_name of the current named place (pill mode only). */
  get placeName() {
    if (this.display != "pill") return null;
    const z = this.zoneState;
    return z ? (z.attributes?.friendly_name ?? null) : null;
  }

  /**
   * Format distance value for display
   * @param {number} meters - Distance in meters
   * @param {string} unit - Unit preference (km, mi, or auto)
   * @returns {string} Formatted distance string
   */
  formatDistance(meters, unit) {
    if (!meters || isNaN(meters)) return '';
    const m = parseFloat(meters);
    
    if (unit === 'mi') {
      const miles = m / 1609.344;
      return miles < 0.1 ? Math.round(m * 3.28084) + ' ft' : miles.toFixed(1) + ' mi';
    }
    
    // Default to km/m (metric)
    if (unit === 'km' || unit === 'auto') {
      return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
    }
    
    // Fallback
    if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
    return Math.round(m) + ' m';
  }

  /**
   * Update the distance tooltip content from linked entity
   * @param {object} hass - Home Assistant object
   */
  updateDistanceTooltip(hass) {
    if (!this.config.distanceEntity || !this.marker) return;
    
    const entity = hass?.states?.[this.config.distanceEntity];
    if (entity && entity.state) {
      const distance = this.formatDistance(entity.state, this.config.distanceUnit);
      if (distance) {
        this.marker.setTooltipContent(distance);
      }
    }
  }

  /**
   * Take everything this entity put on the map off it again: marker, circle,
   * GeoJSON, history trail and history stream.
   * @param {object|null} clusterGroup the cluster group markers currently live in
   * @param {{unsubscribeHistory: boolean}} options unsubscribeHistory: false
   *   when another marker of the same entity still uses the history stream
   */
  remove(clusterGroup = null, { unsubscribeHistory = true } = {}) {
    this.removed = true;
    this._cancelTransition();
    if (this._onZoomEnd) {
      this.map.off("zoomend", this._onZoomEnd);
      this._onZoomEnd = null;
    }
    if (this.marker) {
      if (clusterGroup?.hasLayer?.(this.marker)) {
        clusterGroup.removeLayer(this.marker);
      }
      this.marker.remove();
      this.marker = null;
    }
    this.circle.remove();
    this.geoJson.remove();
    this.historyManager.remove({ unsubscribe: unsubscribeHistory });
  }

  async update(clusterGroup = null) {
    if (this.removed) return;
    // Entity recovered a position after being unknown/unavailable.
    //
    // This is first sight too, and gets the same catch-up as setup(): the
    // viewer has seen no marker for this entity, exactly as when setup()
    // makes one. Which of the two paths an entity takes depends on the
    // DASHBOARD, not on the object - a map that lists unavailable entities
    // meets a recovery here; one that excludes them (railair-map, backlog
    // 234) meets the same recovery as a new entity in setup(). Treating the
    // two differently would make motion depend on a filter. The recreate
    // paths below and in _recreateMarker() are NOT first sight - they
    // replace a marker the viewer is already watching - and get no catch-up.
    if (!this.marker && !this.config.geoJsonConfig?.hideMarker && this.latLng) {
      const catchUp = this._catchUpPlan();
      this.marker = this.createMapMarker(catchUp?.start);
      if (clusterGroup) {
        clusterGroup.addLayer(this.marker);
      } else {
        this.marker.addTo(this.map);
      }
      this._lastSetLatLng = this.latLng;
      if (catchUp) this._startCatchUp(catchUp);
      this._currentPlaceIcon = this.placeIcon;
    }

    // Only update marker if it exists (not hidden by GeoJSON config)
    if (this.marker) {
      // Recreate the marker when the display title changes (state/attribute
      // modes) OR when the entity enters/leaves a named place (place-pill).
      const titleChanged = (this.display == "state" || this.display == "attribute") && this.title != this._currentTitle;
      const placeIconChanged = this.placeIcon != this._currentPlaceIcon;
      if (titleChanged || placeIconChanged) {
        Logger.debug("[Entity] recreating marker for " + this.id + " (title/place change)");
        // When recreating marker, we need to track if it was in a cluster
        const wasInCluster = clusterGroup && clusterGroup.hasLayer(this.marker);
        this.marker.remove();
        this.marker = this.createMapMarker();
        if (wasInCluster) {
          clusterGroup.addLayer(this.marker);
        } else if (clusterGroup) {
          clusterGroup.addLayer(this.marker);
        } else {
          this.marker.addTo(this.map);
        }
        this._currentTitle = this.title;
        this._currentPlaceIcon = this.placeIcon;
      }

      this.refreshMarkerPicture();
      this.refreshMarkerRotation();
      this.refreshMarkerColor();
      this.refreshMarkerLabelColor();
      this.refreshMarkerArrow();
      this.refreshMarkerStyling();
      this.updateMarkerPosition();
    }

    this.historyManager.update();
    this.circle.update();
    this.geoJson.update();
  }

  /**
   * Give an existing marker the entity's current picture.
   *
   * The picture is baked into the marker element when the marker is built,
   * and the recreate conditions in update() never fire for a picture marker,
   * so without this an entity serving a changing image (a rotated icon, say)
   * keeps the image it had when its marker was made.
   *
   * The marker is deliberately NOT recreated: that would cancel any position
   * transition in flight. `picture` is a reactive property on the marker
   * element, so setting the attribute re-renders it in place.
   */
  refreshMarkerPicture() {
    if (!this.marker) return;
    const wanted = this.markerPicture;
    if (wanted == this._currentPicture) return;

    this._setMarkerAttribute("picture", wanted ?? "");
    this._currentPicture = wanted;
  }

  /**
   * Give an existing marker the entity's current angle. Same reasoning as
   * refreshMarkerPicture(): in place, never a rebuild. `rotation` is a
   * reactive property on the marker element and its CSS transition does the
   * turning.
   */
  refreshMarkerRotation() {
    if (!this.marker) return;
    const wanted = this.rotationDegrees();
    if (wanted == this._currentRotation) return;
    this._setMarkerAttribute("rotation", wanted ?? "");
    this._currentRotation = wanted;
  }

  /**
   * Give an existing marker the entity's current fill. In place, never a
   * rebuild, for the same reason as the picture: a rebuild cancels a slide.
   * `color` is a reactive property on the marker element.
   */
  refreshMarkerColor() {
    if (!this.marker) return;
    const wanted = this.markerColor;
    if (wanted == this._currentColor) return;
    this._setMarkerAttribute("color", wanted);
    this._currentColor = wanted;
  }

  /**
   * Give an existing marker the entity's current label colour. In place, as
   * refreshMarkerColor(). An empty attribute means the default.
   */
  refreshMarkerLabelColor() {
    if (!this.marker) return;
    const wanted = this.markerLabelColor;
    if (wanted == this._currentLabelColor) return;
    this._setMarkerAttribute("label-color", wanted ?? "");
    this._currentLabelColor = wanted;
  }

  /**
   * Give an existing marker the entity's current styling (markerStyling).
   * In place, as the fill; only the attributes that changed are written.
   */
  refreshMarkerStyling() {
    if (!this.marker) return;
    const wanted = this.markerStyling;
    const had = this._currentStyling ?? {};
    for (const [name, value] of Object.entries(wanted)) {
      if (had[name] !== value) this._setMarkerAttribute(name, value);
    }
    this._currentStyling = wanted;
  }

  /**
   * Give an existing marker the entity's current arrow angle. In place, as
   * refreshMarkerRotation(); the arrow's CSS transition does the turning.
   */
  refreshMarkerArrow() {
    if (!this.marker) return;
    const wanted = this.arrowDegrees();
    if (wanted == this._currentArrow) return;
    this._setMarkerAttribute("arrow", wanted ?? "");
    this._currentArrow = wanted;
  }
  /**
   * Set an attribute on the live marker element AND in the DivIcon's stored
   * html. Leaflet re-parses that html whenever it rebuilds the icon - leaving
   * a cluster, for instance - so a value written only to the element reverts.
   * @private
   * @param {string} name attribute name, as written in createMapMarker()
   * @param {string|number} value
   */
  _setMarkerAttribute(name, value) {
    const text = String(value);
    this.marker.getElement?.()?.querySelector(MARKER_TAG)?.setAttribute(name, text);
    const iconOptions = this.marker.options?.icon?.options;
    if (iconOptions && typeof iconOptions.html === "string") {
      // Anchored on the preceding whitespace so `rotation` cannot match
      // inside `rotation-transition` or any other *-rotation attribute.
      const pattern = new RegExp(`(\\s)${name}="[^"]*"`);
      iconOptions.html = iconOptions.html.replace(pattern, (_, ws) => `${ws}${name}="${text}"`);
    }
  }

  updateMarkerPosition() {
    if (!this.marker) return;
    const newLatLng = this.latLng;
    if (!newLatLng) return;
    const threshold = this.config.positionUpdateThreshold;
    // Update position only if it has changed significantly (configurable threshold in meters)
    if (!this._lastSetLatLng || this.map.distance(this._lastSetLatLng, newLatLng) > threshold) {
      this._moveMarkerTo(this._lastSetLatLng, newLatLng);
      this._lastSetLatLng = newLatLng;
    }
  }

  /**
   * Move the marker, over position_transition seconds if configured.
   *
   * The threshold in updateMarkerPosition() decides WHETHER to move; this
   * decides HOW, so jitter below the threshold never animates. With no
   * previous position there is nothing to slide from and the marker is
   * placed. A slide starts from where the marker is DRAWN, so a position that
   * arrives mid-slide carries on from there instead of jumping.
   * @private
   * @param {LatLng|null} from the last position the marker was sent to
   * @param {LatLng} to
   */
  _moveMarkerTo(from, to) {
    const seconds = this._transitionSeconds();
    this._cancelTransition();
    if (!from || !seconds) {
      this.marker.setLatLng(to);
      return;
    }
    this._slide(from, to, seconds);
  }

  /**
   * The first-sight catch-up for a marker about to be created, or null to
   * place it at its current position and hold it there.
   *
   * Only when position_transition is configured and the user has not asked
   * for reduced motion - the same gate as any other slide - and only when the
   * position comes from the entity's own latitude/longitude attributes,
   * which is what previous_* describes. A fixed position, a history-playback
   * entry or a device_tracker's position gets none. The fraction itself is
   * catchUpFromPrevious(); a start within positionUpdateThreshold of the
   * current position is not worth a slide.
   * @private
   * @returns {{start: LatLng, elapsedSeconds: number, remainingSeconds: number}|null}
   */
  _catchUpPlan() {
    if (!this._transitionConfigured() || Entity._prefersReducedMotion()) return null;
    if (this.config.fixedX && this.config.fixedY) return null;
    if (this.currentTimelineEntry || this._currentLatLng) return null;
    const attrs = this.attributes;
    if (!(attrs.latitude && attrs.longitude)) return null;
    const plan = catchUpFromPrevious(attrs, Date.now());
    if (!plan) return null;
    const to = this.latLng;
    const start = new LatLng(
      plan.previous.lat + (to.lat - plan.previous.lat) * plan.fraction,
      plan.previous.lng + (to.lng - plan.previous.lng) * plan.fraction,
    );
    const threshold = this.config.positionUpdateThreshold;
    if (Number.isFinite(threshold) && this.map.distance(start, to) <= threshold) return null;
    return { start, elapsedSeconds: plan.elapsedSeconds, remainingSeconds: plan.remainingSeconds };
  }

  /**
   * Run a catch-up planned by _catchUpPlan() on the marker just created at
   * its start. For 'auto', the segment is recorded as having begun when the
   * fix was observed, so the NEXT update's slide is measured over a real
   * segment rather than over the time since the page opened.
   * @private
   * @param {{start: LatLng, elapsedSeconds: number, remainingSeconds: number}} plan
   */
  _startCatchUp(plan) {
    this._lastMoveAt = performance.now() - plan.elapsedSeconds * 1000;
    this._cancelTransition();
    this._slide(plan.start, this.latLng, plan.remainingSeconds);
  }

  /**
   * position_transition is on: 'auto' or a positive number of seconds.
   * The same reading as _transitionSeconds(), which EntityConfig has already
   * normalised, without its side effect on _lastMoveAt.
   * @private
   * @returns {boolean}
   */
  _transitionConfigured() {
    const cfg = this.config.positionTransition;
    if (cfg === "auto") return true;
    const n = Number(cfg);
    return Number.isFinite(n) && n > 0;
  }

  /**
   * Slide the marker from where it is DRAWN to `to` over `seconds`.
   * @private
   * @param {LatLng} from used only when the marker cannot report its position
   * @param {LatLng} to
   * @param {number} seconds
   */
  _slide(from, to, seconds) {
    const start = this.marker.getLatLng?.() ?? from;
    const startLat = start.lat, startLng = start.lng;
    const duration = seconds * 1000;
    const started = performance.now();
    const step = (now) => {
      this._transitionFrame = null;
      if (!this.marker || this.removed) return;
      const f = Math.min(1, Math.max(0, (now - started) / duration));
      if (f >= 1) {
        this.marker.setLatLng(to);
        return;
      }
      this.marker.setLatLng([
        startLat + (to.lat - startLat) * f,
        startLng + (to.lng - startLng) * f,
      ]);
      this._transitionFrame = requestAnimationFrame(step);
    };
    this._transitionFrame = requestAnimationFrame(step);
  }

  /** @private */
  _cancelTransition() {
    if (this._transitionFrame) {
      cancelAnimationFrame(this._transitionFrame);
      this._transitionFrame = null;
    }
  }

  /**
   * Slide duration in seconds, 0 for none. 'auto' uses the time since this
   * entity's previous position change, capped at 30 s, so the marker is
   * still moving when the next one arrives; update rates vary from seconds
   * to minutes by source. Called once per position change, which is what
   * 'auto' measures. Honours the user's reduced-motion setting.
   * @private
   * @returns {number}
   */
  _transitionSeconds() {
    const now = performance.now();
    const previous = this._lastMoveAt;
    this._lastMoveAt = now;
    if (Entity._prefersReducedMotion()) return 0;
    const cfg = this.config.positionTransition;
    if (cfg === "auto") {
      // undefined, not falsy: _startCatchUp() can set it to 0 or below.
      if (previous === undefined) return 0;
      const gap = (now - previous) / 1000;
      if (gap < 0.5) return 0;
      return Math.min(gap, 30);
    }
    const n = Number(cfg);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * @private
   * @returns {boolean}
   */
  static _prefersReducedMotion() {
    return typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  }

  /**
   * @private
   * @param {LatLng} [at] where to create it; the current position if omitted.
   *   Only the first-sight catch-up passes one.
   * @returns {Marker}
   */
  createMapMarker(at = this.latLng) {
    Logger.debug("[MarkerEntity] Creating marker for " + this.id + " with display mode " + this.display);
    let icon = this.icon;
    const picture = this.markerPicture;
    if (this.display == "state" || this.display == "attribute") {
      icon = null;
    }
    this._currentPicture = picture;
    const rotation = this.rotationDegrees();
    this._currentRotation = rotation;
    const color = this.markerColor;
    this._currentColor = color;
    const labelColor = this.markerLabelColor;
    this._currentLabelColor = labelColor;
    const arrow = this.arrowDegrees();
    this._currentArrow = arrow;
    const styling = this.markerStyling;
    this._currentStyling = styling;

    const extraCssClasses = this.darkMode ? "dark" : "";
    // Pill mode (opt-in via display: pill): zone icon + initials when the entity
    // is in a named place; falls back to the normal initials marker otherwise.
    // placeIcon already returns null unless display === "pill".
    const placeIcon = this.placeIcon;
    if (this.display == "pill") {
      icon = null;
    }
    // Pill-callout geometry (must match MapCardEntityMarker's pill render): the
    // pill sits up-left of the point with a short leader line down-right to a
    // dot on the exact location, so it doesn't cover what's underneath. The
    // callout only engages at/above pillCalloutMinZoom; zoomed out, the pill
    // centers on the point with no leader (so it isn't obtrusive region-wide).
    const s = this.config.size;
    const pillW = 2 * s + 14;
    const pillH = s + 8;
    const off = Math.round(s * 0.7);
    const boxW = pillW + off;
    const boxH = pillH + off;
    const callout = placeIcon != null && this.map.getZoom() >= this.config.pillCalloutMinZoom;

    const marker = new Marker(at, {
      icon: new DivIcon({
        html: `
          <${MARKER_TAG}
            entity-id="${this.id}"
            title="${this.title}"
            label="${this.config.label ?? ""}"
            prefix="${this.config.prefix}"
            suffix="${this.config.suffix}"
            tooltip="${this.tooltip}"
            icon="${icon ?? ""}"
            picture="${picture ?? ""}"
            rotation="${rotation ?? ""}"
            rotation-transition="${this.config.rotationTransition ?? 0}"
            place-icon="${placeIcon ?? ""}"
            callout="${callout}"
            color="${color}"
            label-color="${labelColor ?? ""}"
            arrow="${arrow ?? ""}"
            label-outline="${styling["label-outline"]}"
            arrow-color="${styling["arrow-color"]}"
            arrow-outline="${styling["arrow-outline"]}"
            ring-color="${styling["ring-color"]}"
            ring-width="${styling["ring-width"]}"
            style="${this.config.css}"
            size="${this.config.size}"
            extra-css-classes="${extraCssClasses}"
            tap-action='${JSON.stringify(this.config.tapAction)}'
          ></${MARKER_TAG}>
        `,
        iconSize: placeIcon ? (callout ? [boxW, boxH] : [pillW, pillH]) : [s, s],
        iconAnchor: placeIcon ? (callout ? [boxW - 2, boxH - 2] : [pillW / 2, pillH / 2]) : [s / 2, s / 2],
        className: ''
      }),
      zIndexOffset: this.config.zIndexOffset
    });
    // Instant hover label: a Leaflet tooltip opens on mouseover with no delay,
    // unlike the native `title` attribute (which the browser holds ~1s). The
    // distance feature (setup) rebinds a permanent tooltip when configured.
    if (!this.config.distanceEntity) {
      marker.bindTooltip(this.tooltip, {
        direction: "top",
        offset: [0, -this.config.size / 2 - 4]
      });
    }
    return marker;
  }
}
