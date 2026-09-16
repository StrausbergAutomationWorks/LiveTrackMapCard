import L, {Map, LatLngBounds} from "leaflet";
import "leaflet.markercluster";
import EntityConfig from "../../configs/EntityConfig";
import Entity from "../../models/Entity";
import Logger from "../../util/Logger";
import HaMapUtilities from "../../util/HaMapUtilities";
import HaDateRangeService from "../HaDateRangeService";
import HaLinkedEntityService from "../HaLinkedEntityService";
import HaHistoryService from "../HaHistoryService";
import FocusFollowConfig from "../../configs/FocusFollowConfig";


export default class EntitiesRenderService {

  /** @type {[Entity]} */
  entities = [];
  /** @type {[EntityConfig]} */
  entityConfigs = [];
  /** @type {object} */
  hass;
  /** @type {Map} */
  map;
  /** @type {boolean} */
  isDarkMode = false;
  /** @type {HaDateRangeService} */
  dateRangeManager;
  /** @type {HaLinkedEntityService} */
  linkedEntityService;
  /** @type {HaHistoryService} */
  historyService;
  /** @type {FocusFollowConfig} */
  focusFollowConfig;
  /** @type {L.MarkerClusterGroup} */
  markerClusterGroup;
  /** @type {boolean} */
  clusterMarkers;
  /** @type {boolean} */
  isFollowPaused = false;
  /** @type {number|null} */
  _followPauseTimer = null;
  /** @type {boolean} */
  _isAutoFitting = false;

  constructor(map, hass, focusFollowConfig, entityConfigs, linkedEntityService, dateRangeManager, historyService, isDarkMode, clusterMarkers = true) {
    this.map = map;
    this.hass = hass;
    this.focusFollowConfig = focusFollowConfig;
    this.entityConfigs = entityConfigs;
    this.linkedEntityService = linkedEntityService;
    this.dateRangeManager = dateRangeManager;
    this.historyService = historyService;
    this.isDarkMode = isDarkMode;
    this.clusterMarkers = clusterMarkers;
  }

  setup() {
    // Initialize marker cluster group if clustering is enabled
    Logger.debug("[EntitiesRenderService] Clustering enabled: " + this.clusterMarkers);
    if (this.clusterMarkers) {
      this.markerClusterGroup = L.markerClusterGroup({
        showCoverageOnHover: false,
        removeOutsideVisibleBounds: false,
      });
      this.map.addLayer(this.markerClusterGroup);
      Logger.debug("[EntitiesRenderService] Marker cluster group created and added to map");
    }

    this.entities = this.entityConfigs.map((configEntity) => {
      // Attempt to setup entity. Skip on fail, so one bad entity does not affect others.
      try {
        const entity = new Entity(configEntity, this.hass, this.map, this.historyService, this.dateRangeManager, this.linkedEntityService, this.isDarkMode);
        entity.setup(this.markerClusterGroup);
        return entity;
      } catch (e){
        Logger.error("Entity: " + configEntity.id + " skipped due to missing data", e);
        HaMapUtilities.renderWarningOnMap(this.map, "Entity: " + configEntity.id + " could not be loaded. See console for details.");
        return null;
      }
    })
    // Remove skipped entities.
    .filter(v => v);

    if (!this.focusFollowConfig.isNone && this.focusFollowConfig.hasPause) {
      this._setupFollowPauseListeners();
    }
  }

  _setupFollowPauseListeners() {
    this._pauseFollow = () => {
      if (this._isAutoFitting) { return; }
      this.isFollowPaused = true;
      if (this._followPauseTimer) {
        clearTimeout(this._followPauseTimer);
        this._followPauseTimer = null;
      }
    };

    this._scheduleResume = () => {
      if (this._isAutoFitting) { return; }
      if (this._followPauseTimer) {
        clearTimeout(this._followPauseTimer);
      }
      this._followPauseTimer = setTimeout(() => {
        this.isFollowPaused = false;
        this._followPauseTimer = null;
        this.updateInitialView();
      }, this.focusFollowConfig.pauseMilliseconds);
    };

    this.map.on('mousedown', this._pauseFollow);
    this.map.on('dragstart', this._pauseFollow);
    this.map.on('zoomstart', this._pauseFollow);
    this.map.on('mouseup', this._scheduleResume);
    this.map.on('dragend', this._scheduleResume);
    this.map.on('zoomend', this._scheduleResume);
  }

  /**
   * Replace the entity list WITHOUT rebuilding the map.
   *
   * auto-entities hands the card a new list on every change to its filter
   * result, and a geo_location source changes constantly. Rebuilding each
   * time redraws the map, resets the view and loses the cluster toggle.
   *
   * An entity whose configuration is unchanged keeps its object - and with
   * it its marker and any movement in flight. One that left is removed
   * completely. One that is new, or whose own options changed, is created.
   * Removal runs first: history streams are keyed by entity id, so creating
   * a replacement before removing the original would close the new stream.
   * @param {[EntityConfig]} newConfigs
   */
  updateEntityConfigs(newConfigs) {
    // Key by id AND occurrence, so two entries for one entity stay two
    // markers if a caller passes them. MapConfig already keeps only the
    // first entry per entity (MapConfig.firstPerEntity), so from the card
    // every occurrence is #0; this is a guard for direct callers.
    const keyed = (configs) => {
      const seen = {};
      return configs.map((c) => {
        const n = seen[c.id] = (seen[c.id] ?? -1) + 1;
        return [`${c.id}#${n}`, c];
      });
    };
    // ⚠ `Map` in this module is LEAFLET's map class (imported above), not
    // JavaScript's. `new Map(...)` here would build a map widget, throw, and
    // turn every in-place update into a full rebuild without a trace.
    const JsMap = globalThis.Map;
    const entityOf = new JsMap(this.entities.map((e) => [e.config, e]));
    const previous = new JsMap(keyed(this.entityConfigs).map(([k, c]) => [k, { config: c, entity: entityOf.get(c) }]));

    const plan = keyed(newConfigs).map(([key, config]) => {
      const before = previous.get(key);
      if (before?.entity && before.config.fingerprint === config.fingerprint) {
        previous.delete(key);
        return { entity: before.entity, config: before.config };
      }
      return { config };
    });

    const keptIds = new Set(plan.filter((p) => p.entity).map((p) => p.entity.config.id));
    for (const { entity } of previous.values()) {
      if (!entity) continue;
      try {
        entity.remove(this.markerClusterGroup, { unsubscribeHistory: !keptIds.has(entity.config.id) });
      } catch (e) {
        Logger.error("[EntitiesRenderService] failed removing " + entity.config.id, e);
      }
    }

    for (const p of plan) {
      if (p.entity) continue;
      try {
        p.entity = new Entity(p.config, this.hass, this.map, this.historyService, this.dateRangeManager, this.linkedEntityService, this.isDarkMode);
        p.entity.setup(this.markerClusterGroup);
      } catch (e) {
        p.entity = null;
        Logger.error("Entity: " + p.config.id + " skipped due to missing data", e);
        HaMapUtilities.renderWarningOnMap(this.map, "Entity: " + p.config.id + " could not be loaded. See console for details.");
      }
    }

    this.entities = plan.map((p) => p.entity).filter((e) => e);
    this.entityConfigs = plan.map((p) => p.config);
  }

  cleanup() {
    if (this._followPauseTimer) {
      clearTimeout(this._followPauseTimer);
      this._followPauseTimer = null;
    }
    if (this._pauseFollow) {
      this.map.off('mousedown', this._pauseFollow);
      this.map.off('dragstart', this._pauseFollow);
      this.map.off('zoomstart', this._pauseFollow);
    }
    if (this._scheduleResume) {
      this.map.off('mouseup', this._scheduleResume);
      this.map.off('dragend', this._scheduleResume);
      this.map.off('zoomend', this._scheduleResume);
    }
  }

  async render(hass) {
    if (hass) {
      this.hass = hass;
    }
    this.entities.forEach((ent) => {
      // Entity keeps the hass object from setup(); Lovelace replaces hass on
      // every state change, so without this the marker reads a stale snapshot
      // and never moves (#217).
      try {
        if (this.hass) {
          ent.hass = this.hass;
        }
        ent.update(this.markerClusterGroup);
      } catch (e) {
        Logger.error("Entity: " + ent.id + " failed to update", e);
      }
    });
    this.updateInitialView();
  }

  toggleClustering() {
    this.clusterMarkers = !this.clusterMarkers;

    if (this.clusterMarkers) {
      // Enable clustering
      this.markerClusterGroup = L.markerClusterGroup({
        showCoverageOnHover: false,
        removeOutsideVisibleBounds: false,
      });
      this.map.addLayer(this.markerClusterGroup);

      // Move all markers to cluster group
      this.entities.forEach((entity) => {
        if (entity.marker && this.map.hasLayer(entity.marker)) {
          this.map.removeLayer(entity.marker);
          this.markerClusterGroup.addLayer(entity.marker);
        }
      });
    } else {
      // Disable clustering
      if (this.markerClusterGroup) {
        this.markerClusterGroup.clearLayers();
        this.map.removeLayer(this.markerClusterGroup);
        this.markerClusterGroup = null;
      }

      // Add all markers directly to map
      this.entities.forEach((entity) => {
        if (entity.marker && !this.map.hasLayer(entity.marker)) {
          entity.marker.addTo(this.map);
        }
      });
    }
  }

  updateInitialView() {
    if(this.focusFollowConfig.isNone) {
      return;
    }
    if(this.isFollowPaused) {
      return;
    }
    const points = this.entities.filter(e => e.config.focusOnFit).map((e) => e.latLng);
    if(points.length === 0) {
      return;
    }
    // If not, get bounds of all markers rendered
    const bounds = (new LatLngBounds(points)).pad(0.1);
    if(this.focusFollowConfig.isContains) {
      if(this.map.getBounds().contains(bounds)) {
        return;
      }
    }
    this._isAutoFitting = true;
    this.map.once('moveend', () => {
      this._isAutoFitting = false;
    });
    this.map.fitBounds(bounds);
    Logger.debug("[EntitiesRenderService.updateInitialView]: Updating bounds to: " + points.join(","));
  }

  setInitialView() {
    const points = this.entities.filter(e => e.config.focusOnFit).map((e) => e.latLng);
    if(points.length === 0) {
      return;
    }
    // If not, get bounds of all markers rendered
    const bounds = (new LatLngBounds(points)).pad(0.1);
    this._isAutoFitting = true;
    this.map.once('moveend', () => {
      this._isAutoFitting = false;
    });
    this.map.fitBounds(bounds);
    Logger.debug("[EntitiesRenderService.setInitialView]: Setting initial view to: " + points.join(","));
  }
}