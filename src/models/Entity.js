
import { DivIcon, LatLng, Map, Marker } from "leaflet";
import Circle from "./Circle.js";
import GeoJson from "./GeoJson.js";
import Logger from "../util/Logger.js"
import EntityConfig from "../configs/EntityConfig.js";
import EntityHistoryManager from "./EntityHistoryManager.js";
import TimelineEntry from "./TimelineEntry.js";

/**
 * The custom element every marker is built from. index.js registers it under
 * this name; anything that looks a marker up by tag must use this constant, or
 * it queries an element this card never defines and silently finds nothing.
 */
export const MARKER_TAG = "live-track-map-card-entity-marker";

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
      this.marker = this.createMapMarker();

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
    if (!this.marker && !this.config.geoJsonConfig?.hideMarker && this.latLng) {
      this.marker = this.createMapMarker();
      if (clusterGroup) {
        clusterGroup.addLayer(this.marker);
      } else {
        this.marker.addTo(this.map);
      }
      this._lastSetLatLng = this.latLng;
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
      if (!previous) return 0;
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
   * @returns {Marker}
   */
  createMapMarker() {
    Logger.debug("[MarkerEntity] Creating marker for " + this.id + " with display mode " + this.display);
    let icon = this.icon;
    const picture = this.markerPicture;
    if (this.display == "state" || this.display == "attribute") {
      icon = null;
    }
    this._currentPicture = picture;
    const rotation = this.rotationDegrees();
    this._currentRotation = rotation;

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

    const marker = new Marker(this.latLng, {
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
            color="${this.config.color}"
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
