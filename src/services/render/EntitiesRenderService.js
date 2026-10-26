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
import { mergedAway } from "../ObjectMergeService";
import { creditLine } from "../../util/EntityCredits";
import { stats } from "../../markers/MarkerStats.js";
import { setupPlacement } from "../../markers/MarkerPlacement.js";

/**
 * May this entity skip an update when its own state is unchanged (map capacity, card SSOT
 * 2026-10-25)? Not when anything else feeds its marker: a distance entity, device
 * trackers, a zone pill, history, a circle, GeoJSON, history playback or a fixed position.
 * @param {Entity} e
 * @returns {boolean}
 */
export function selfContained(e) {
  const c = e.config ?? {};
  return !c.distanceEntity && !c.circleConfig?.enabled && !c.geoJsonConfig?.enabled &&
    !e.historyManager?.hasHistory && e.display !== "pill" &&
    !(e.attributes?.device_trackers?.length) && !e.currentTimelineEntry && !(c.fixedX && c.fixedY);
}


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

  /**
   * Is the page's copy of this entity one Home Assistant no longer has?
   * See HaStaleStateService. Such an entity is not drawn.
   * @type {(id: string) => boolean}
   */
  isStale = () => false;

  /**
   * Has the viewer hidden this entity's group? (D4f, backlog 345; the map
   * card passes its GroupFilter.) Such an entity is not drawn, not merged
   * with another source's marker and not credited.
   * @type {(id: string) => boolean}
   */
  isFiltered = () => false;

  /**
   * Is this entity drawn by another service (people, devices and zones by
   * presence/PresenceRenderService, Lee 2026-11-19)? Its marker is kept off
   * the map here, but it still counts when the map fits its entities.
   * @type {(id: string) => boolean}
   */
  drawnElsewhere = () => false;

  /**
   * Entities not drawn because another source already draws the same
   * object (06_MAP_CONTRACT.md D11). Recomputed on every render: a
   * proximity pair can form or part as positions move.
   * @type {Set<string>}
   */
  merged = new Set();

  /**
   * Recompute `merged` from the entities about to be drawn: not stale, and
   * with a position.
   */
  computeMerged() {
    const candidates = [];
    for (const ent of this.entities) {
      try {
        if (this.isStale(ent.id) || this.isFiltered(ent.id) || this.drawnElsewhere(ent.id)) continue;
        const ll = ent.latLng;
        if (!ll) continue;
        candidates.push({ id: ent.id, attributes: ent.attributes, lat: ll.lat, lng: ll.lng });
      } catch (e) {
        Logger.error("[EntitiesRenderService] merge check skipped " + ent.id, e);
      }
    }
    try {
      this.merged = mergedAway(candidates);
    } catch (e) {
      // Never let the merge stop the map drawing: fall back to drawing all.
      Logger.error("[EntitiesRenderService] merge failed", e);
      this.merged = new Set();
    }
  }

  /** Hide every entity D11 has merged away, and every one whose group the viewer hid (D4f). */
  hideMerged() {
    for (const ent of this.entities) {
      if (this.merged.has(ent.id) || this.isFiltered(ent.id) || this.drawnElsewhere(ent.id)) {
        try { ent.hide(this.markerClusterGroup); } catch (e) { Logger.error("hide failed " + ent.id, e); }
      }
    }
  }

  /**
   * The one credit line this service has put in the map's attribution box
   * (backlog 228), or "" for none.
   * @type {string}
   */
  credits = "";

  /**
   * Credit the `attribution` of every entity drawn now: not stale, not
   * merged away, with a position, as one line (util/EntityCredits.js
   * creditLine). A source leaves the line when its last drawn entity goes.
   * The box is touched only when the line changes. Never lets a bad credit
   * stop the map drawing.
   */
  refreshCredits() {
    const ctl = this.map?.attributionControl;
    if (!ctl) return;
    const texts = new Set();
    for (const ent of this.entities ?? []) {
      try {
        if (this.isHidden(ent.id) || this.drawnElsewhere(ent.id) || !ent.latLng) continue;
        const a = ent.attributes?.attribution;
        if (typeof a === "string") texts.add(a);
      } catch (e) {
        Logger.error("[EntitiesRenderService] credit skipped " + ent.id, e);
      }
    }
    try {
      const line = creditLine(texts);
      if (line === this.credits) return;
      if (this.credits) ctl.removeAttribution(this.credits);
      if (line) ctl.addAttribution(line);
      this.credits = line;
    } catch (e) {
      Logger.error("[EntitiesRenderService] credits failed", e);
    }
  }

  /**
   * Is this entity kept off the map: stale, hidden by the viewer, or merged away?
   * @param {string} id entity id
   * @returns {boolean}
   */
  isHidden(id) {
    return this.isStale(id) || this.isFiltered(id) || this.merged.has(id);
  }

  /**
   * @param {object} map Leaflet map
   * @param {object} hass
   * @param {FocusFollowConfig} focusFollowConfig
   * @param {EntityConfig[]} entityConfigs
   * @param {HaLinkedEntityService} linkedEntityService
   * @param {HaDateRangeService} dateRangeManager
   * @param {HaHistoryService} historyService
   * @param {boolean} isDarkMode
   * @param {boolean} [clusterMarkers]
   * @param {((id: string) => boolean)|null} [isStale]
   * @param {{canvas: boolean, cull: boolean}|null} [markerDrawing] canvas markers and
   *   culling for this map (MarkerPlacement). MapCard turns both off with clustering;
   *   null leaves every marker a plain DOM marker in Leaflet's markerPane.
   *   (12th since the rebase onto main, 2026-11-19: main's isFiltered took the 11th.)
   */
  constructor(map, hass, focusFollowConfig, entityConfigs, linkedEntityService, dateRangeManager, historyService, isDarkMode, clusterMarkers = true, isStale = null, isFiltered = null, markerDrawing = null) {
    if (isStale) this.isStale = isStale;
    if (isFiltered) this.isFiltered = isFiltered;
    if (markerDrawing) setupPlacement(map, clusterMarkers ? { canvas: false, cull: false } : markerDrawing);
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

    this.computeMerged();
    this.hideMerged();
    this.refreshCredits();

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
    this.computeMerged();
    this.hideMerged();
    this.refreshCredits();
  }

  /**
   * Markers drawn on the canvases now, every class together.
   * @returns {number}
   */
  canvasCount() {
    return (this.map?.__ltmcCanvasLayers ?? []).reduce((n, l) => n + (l?.count?.() ?? 0), 0);
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
    for (const ent of this.entities) {
      if (this.hass) ent.hass = this.hass;
    }
    this.computeMerged();
    // Map capacity (card SSOT 2026-10-25): an entity whose state object Home Assistant has
    // not replaced since its last update is not updated again. Home Assistant replaces a
    // state's object on every change, so the same object is the same state.
    const states = this.hass?.states;
    this.entities.forEach((ent) => {
      // Entity keeps the hass object from setup(); Lovelace replaces hass on
      // every state change, so without this the marker reads a stale snapshot
      // and never moves (#217).
      try {
        if (this.hass) {
          ent.hass = this.hass;
        }
        if (this.isHidden(ent.id) || this.drawnElsewhere(ent.id)) {
          ent._seenState = undefined;
          ent.hide(this.markerClusterGroup);
          return;
        }
        const st = states?.[ent.id];
        if (st !== undefined && st === ent._seenState && ent.marker && selfContained(ent)) {
          stats.skipped++;
          return;
        }
        ent._seenState = st;
        stats.updated++;
        ent.update(this.markerClusterGroup);
      } catch (e) {
        Logger.error("Entity: " + ent.id + " failed to update", e);
      }
    });
    this.refreshCredits();
    this.updateInitialView();
  }

  /**
   * Water tiles arrived, or the zoom crossed path_min_zoom: redraw every
   * marker that is standing still where it should be drawn now (a boat on
   * land into the water, or back to its fix below the gate). A marker mid-
   * slide is left alone; its slide ends where it planned to.
   */
  refreshDrawnPositions() {
    for (const ent of this.entities ?? []) {
      if (this.isHidden(ent.id)) continue;
      try {
        ent.refreshDrawnPosition?.();
      } catch (e) {
        Logger.error("Entity: " + ent.id + " failed to redraw", e);
      }
    }
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
    const points = this.entities.filter(e => e.config.focusOnFit && !this.isHidden(e.id)).map((e) => e.latLng);
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
    const points = this.entities.filter(e => e.config.focusOnFit && !this.isHidden(e.id)).map((e) => e.latLng);
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