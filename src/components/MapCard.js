
import L from 'leaflet';
import { LitElement, html, css } from "lit";
import MapConfig from "../configs/MapConfig.js"
import HaHistoryService from "../services/HaHistoryService.js"
import HaDateRangeService from "../services/HaDateRangeService.js"
import HaLinkedEntityService from "../services/HaLinkedEntityService.js"
import HaMapUtilities from "../util/HaMapUtilities.js"
import Logger from "../util/Logger.js"
import { VERSION } from "../version.js"
import HaUrlResolveService from '../services/HaUrlResolveService.js';
import TileLayersService from '../services/render/TileLayersRenderService.js';
import EntitiesRenderService from '../services/render/EntitiesRenderService.js';
import InitialViewRenderService from '../services/render/InitialViewRenderService.js';
import TileLayer from '../leaflet/TileLayer.js';
import PluginsRenderService from '../services/render/PluginsRenderService.js';
import GeoJsonRenderService from '../services/render/GeoJsonRenderService.js';
import ShapeLayersService from '../services/render/ShapeLayersRenderService.js';
import PointLayersService from '../services/render/PointLayersRenderService.js';
import RadarOverlayService from '../services/render/RadarOverlayService.js';
import LightningOverlayService from '../services/render/LightningOverlayService.js';
import CloudOverlayService from '../services/render/CloudOverlayService.js';
import HaStaleStateService from '../services/HaStaleStateService.js';
import { GroupFilter } from '../util/GroupFilter.js';
import { PathFollower } from '../services/path/PathFollower.js';
import { CreditsToggle } from '../util/CreditsToggle.js';
import PresenceRenderService from '../presence/PresenceRenderService.js';
import '../presence/LtmcMapOverview.js';
import {
  OVERVIEW_GAP, inPanelView, overviewShown, overviewPadding, selectedFromSearch, searchWith,
} from '../presence/OverviewRules.js';
import { proto } from '../proto/flags.js';

export default class MapCard extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: {}
    };
  }

  setupNeeded = true;
  /** @type {L.Map} */
  map;
  /** @type {ResizeObserver} */
  resizeObserver;
  /** @type {HaHistoryService} */
  historyService;
  /** @type {HaLinkedEntityService} */
  linkedEntityService;
  /** @type {HaDateRangeService} */
  dateRangeManager;
  /** @type {HaUrlResolveService} */
  urlResolver;
  /** @type {string} */
  themeMode;
  /** @type {MapConfig} */
  _config;
  /** @type {TileLayersService} */
  tileLayersService;
  /** @type {EntitiesRenderService} */
  entitiesRenderService;
  /** @type {InitialViewRenderService} */
  initialViewRenderService;
  /** @type {PluginsRenderService} */
  pluginsRenderService;
  /** @type {GeoJsonRenderService} */
  geoJsonRenderService;
  hasError = false;
  hadError = false;
  /** The overview beside the map (step 2): shown, its tab, its selection, and what it covers. */
  _overviewOn = false;
  _overviewTab = "people";
  _overviewSelected = undefined;
  _overviewSize = { width: 0, height: 0 };

  setup() {
    Logger.debug("[MapCard] Setting up map card");

    // Clean up existing map instance before reinitializing (e.g. when setConfig triggers a re-setup)
    if (this.map) {
      this._teardown();
    }

    this.themeMode = this._config.themeMode;
    this.map = this._setupMap();
    this._setupCreditsToggle();
    this._setupPathFollower();
    // redraw the map every time it resizes
    this.resizeObserver = this._setupResizeObserver();

    // Setup core history service
    this.historyService = new HaHistoryService(this.hass);
    // Is history date range enabled?
    if (this._config.historyDateSelection) {
      this.dateRangeManager = new HaDateRangeService(this.hass);
    }
    this.tileLayersService = new TileLayersService(this.map, this._config.tileLayers, this._config.wms, this.urlResolver, this.linkedEntityService, this.dateRangeManager, undefined, this._config.layerControl, this._config.layerControlCollapsed);
    // Entities the page still holds after Home Assistant removed them - a
    // reconnect merges instead of replacing (HaStaleStateService). A change
    // to the record redraws, which hides or restores the markers.
    this.staleStateService = new HaStaleStateService(() => this.hass, () => this.requestUpdate());
    // The groups this browser's viewer hid in the filter card (D4f, backlog
    // 345). A change redraws, which hides or restores the markers.
    this.groupFilter = new GroupFilter(() => this.requestUpdate());
    this.entitiesRenderService = new EntitiesRenderService(this.map, this.hass, this._config.focusFollow, this._config.entities, this.linkedEntityService, this.dateRangeManager, this.historyService, this._isDarkMode(), this._config.clusterMarkers, (id) => this.staleStateService.isStale(id), (id) => this.groupFilter.hides(this.hass?.states?.[id]?.attributes));
    this._setupPresence();
    this.initialViewRenderService = new InitialViewRenderService(this.map, this._config, this.hass, this.entitiesRenderService);

    this.pluginsRenderService = new PluginsRenderService(this.map, this._config.plugins);
    this.geoJsonRenderService = new GeoJsonRenderService(this.map, this.hass, this._config.geojson);
    // Shapes on the map (D12): filled by key from a publisher's file.
    this.shapeLayersService = new ShapeLayersService(this.map, this._config.shapeLayers, this._config.shapeStyle, this.tileLayersService, { area: this._config.weatherArea });
    // Points on the map (D19): dots from a publisher's file, above the fills, below the markers.
    this.pointLayersService = new PointLayersService(this.map, this._config.pointLayers, this.tileLayersService, { area: this._config.weatherArea });
    // The weather radar overlay (D13): one layer, its own pane under the fills.
    this.radarOverlayService = new RadarOverlayService(this.map, this._config.weatherRadar, this.tileLayersService, { area: this._config.weatherArea });
    // Lightning (D14): its own pane right above the radar's.
    this.lightningOverlayService = new LightningOverlayService(this.map, this._config.lightning, this.tileLayersService);
    // Clouds (D17): its own pane right above the tiles, under the radar's.
    this.cloudOverlayService = new CloudOverlayService(this.map, this._config.clouds, this.tileLayersService, () => this._isDarkMode());

    try {
      this.pluginsRenderService.setup();
      this.tileLayersService.setup();
      // After the named tile overlays, so its checkbox follows theirs.
      this.radarOverlayService.setup();
      // After the radar: its pane goes right above the radar's, its checkbox below.
      this.lightningOverlayService.setup();
      // After the radar's pane exists: the clouds' goes in right after the tiles, under it.
      this.cloudOverlayService.setup();
      this.geoJsonRenderService.setup();
      this.entitiesRenderService.setup();
      this.presenceRenderService.setup();
      this._setupOverview();
      this.initialViewRenderService.setup();
      // After the entities exist: a check that finds stale ones redraws.
      this.staleStateService.start();

      this.setupNeeded = false;
      this.hasError = false;
    } catch (e) {
      this.hasError = true;
      this.hadError = true;
      Logger.error(e);
      HaMapUtilities.renderWarningOnMap(this.map, "Error found in first run, check Console");
    }
    Logger.debug("[MapCard] Map card setup complete");
  }

  /**
   * PROTOTYPE (map capacity, 2026-10-25): with `batch`, an update waits for the next
   * animation frame, so every hass change that lands before it is one update, and the
   * work leaves Home Assistant's websocket task (proto/flags.js).
   * @returns {unknown}
   */
  scheduleUpdate() {
    if (!proto("batch")) return super.scheduleUpdate();
    return new Promise((resolve) => requestAnimationFrame(resolve)).then(() => super.scheduleUpdate());
  }

  firstUpdated() {
    if (this.hass && this.isConnected) {
      this.setup();
    }
  };

  render() {

    // Never build a map on a card that is not in the page. Home Assistant can
    // still call setConfig on a card it has just replaced (a websocket
    // reconnect does this); building then gives a map whose one-shot initial
    // view is skipped, which stays blank if the card is attached again and is
    // otherwise never removed - a window listener and any open subscription
    // keep it alive. connectedCallback requests an update while a setup is
    // pending, so the build simply happens on attach.
    if (this.setupNeeded && this.hass && this.isConnected && this.shadowRoot?.querySelector('#map')) {
      this.setup();
    }

    if (this.map) {
      this._healSize();
      this.pluginsRenderService.render();
      this.tileLayersService.render();
      this.geoJsonRenderService.render(this.hass);
      this.shapeLayersService?.render(this.hass);
      this.pointLayersService?.render(this.hass);
      this.radarOverlayService?.render(this.hass);
      this.entitiesRenderService.render(this.hass);
      this.presenceRenderService?.render(this.hass);
      this.initialViewRenderService.render();

      if (!this.hasError && this.hadError) {
        HaMapUtilities.removeWarningOnMap(this.map, "Error found, check Console");
        HaMapUtilities.removeWarningOnMap(this.map, "Error found in first run, check Console");
        this.hadError = false;
      }

    }

    return html`
            <link rel="stylesheet" href="/static/images/leaflet/leaflet.css">
            <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css">
            <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css">
            <ha-card header="${this._config.title}">
              <div id="mapContainer" style="min-height: ${this._config.mapHeight}px">
                <div id="map" style="min-height: ${this._config.mapHeight}px">
                  <ha-icon-button
                    label='Reset focus'
                    style='${this._isDarkMode() ? "color:#ffffff;" : "color:#000000;"} position: absolute; top: 75px; left: ${3 + this._leftInset()}px; z-index: 1;'
                    @click=${this._fitMap}
                    tabindex="0"
                  >
                    <ha-icon icon="mdi:image-filter-center-focus"></ha-icon>
                  </ha-icon-button>
                  ${this._config.clusterMarkers ? html`
                    <ha-icon-button
                      label='Toggle grouping'
                      style='${this._isDarkMode() ? "color:#ffffff;" : "color:#000000;"} position: absolute; top: 115px; left: ${3 + this._leftInset()}px; z-index: 1;'
                      @click=${this._toggleClustering}
                      tabindex="0"
                    >
                      <ha-icon icon="mdi:group"></ha-icon>
                    </ha-icon-button>
                  ` : ''}
                </div>
                ${this._overviewOn && this.presenceRenderService ? html`
                  <ltmc-map-overview
                    id="overview"
                    .hass=${this.hass}
                    .entityIds=${this.presenceRenderService.entityIds}
                    .names=${this._overviewNames()}
                    .selected=${this._overviewSelected}
                    .tab=${this._overviewTab}
                    .zoneColor=${this._overviewZoneColor}
                    @ltmc-overview-select=${this._onOverviewSelect}
                    @ltmc-overview-tab=${this._onOverviewTab}
                    @ltmc-overview-resize=${this._onOverviewResize}
                  ></ltmc-map-overview>
                ` : ''}
              </div>
            </ha-card>
        `;
  }

  _fitMap() {
    this.initialViewRenderService.setup();
  }

  _toggleClustering() {
    this.entitiesRenderService.toggleClustering();
  }

  /**
   * Re-measure the map when Leaflet's remembered size is not the box's.
   * A map built while its box had no size (0 x 0) draws a single tile in a
   * corner and stays that way; the resize observer was seen NOT to catch it
   * (getSize() 0 x 0 long after load in a hidden tab, 2026-10-04/05, and the
   * same picture in Lee's visible tab; why the observer missed it is not known).
   * Called on every render, which Home Assistant's state updates drive every
   * few seconds, so the map heals within one update whatever was missed.
   * @returns {boolean} whether it re-measured
   */
  _healSize() {
    try {
      const box = this.map?.getContainer?.();
      const size = this.map?.getSize?.();
      if (!box || !size) return false;
      const w = box.clientWidth, h = box.clientHeight;
      if (w > 0 && h > 0 && (w !== size.x || h !== size.y)) {
        this.map.invalidateSize();
        return true;
      }
    } catch { /* never stops the render */ }
    return false;
  }

  _setupResizeObserver() {
    if (this.resizeObserver) {
      return this.resizeObserver;
    }

    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        if (entry.target === this.map?.getContainer()) {
          this.map?.invalidateSize();
        }
      }
    });

    resizeObserver.observe(this.map.getContainer());
    return resizeObserver;
  }

  /** @returns {L.Map} Leaflet Map */
  _setupMap() {
    // Manages watching external entities.
    this.linkedEntityService = new HaLinkedEntityService(this.hass);
    this.urlResolver = new HaUrlResolveService(this.hass, this.linkedEntityService);

    L.Icon.Default.imagePath = "/static/images/leaflet/images/";

    const mapEl = this.shadowRoot.querySelector('#map');
    let map = L.map(mapEl, this._config.mapOptions);

    // Add dark class if darkmode
    this._isDarkMode() ? mapEl.classList.add('dark') : mapEl.classList.add('light');

    if (this._config.tileLayer) {
      let tileUrl = this.urlResolver.resolveUrl(this._config.tileLayer.url);
      let layer = new TileLayer(tileUrl, this._config.tileLayer.options);
      map.addLayer(layer);
      this.urlResolver.registerLayer(layer, this._config.tileLayer.url);
    }
    return map;
  }



  setConfig(config) {
    // Validate first: an invalid config throws here and leaves the card as it was.
    const mapConfig = new MapConfig(config);

    // Only the ENTITY LIST changed? Apply it in place and keep the map.
    //
    // auto-entities calls setConfig on every change to its filter result, and
    // a geo_location source changes constantly. A rebuild each time redraws
    // the map, resets the view and discards UI state such as the cluster
    // toggle. Any other change still rebuilds - tile layers, clustering,
    // focus and the rest genuinely need it.
    const onlyEntitiesChanged =
      this.map && this.config && this.entitiesRenderService &&
      !this.setupNeeded && !this.hasError &&
      MapCard._withoutEntities(this.config) === MapCard._withoutEntities(config);

    this.config = config;
    this._config = mapConfig;

    if (onlyEntitiesChanged) {
      try {
        Logger.debug("[MapCard] entity list changed - updating in place");
        this.presenceRenderService?.setEntities(mapConfig.entities);
        this.entitiesRenderService.updateEntityConfigs(mapConfig.entities);
        return;
      } catch (e) {
        Logger.error("[MapCard] in-place entity update failed, rebuilding", e);
      }
    }
    this.setupNeeded = true;
  }

  /**
   * @param {object} config
   * @returns {string} the config with `entities` left out, serialised
   */
  static _withoutEntities(config) {
    // eslint-disable-next-line no-unused-vars
    const { entities, ...rest } = config ?? {};
    return JSON.stringify(rest);
  }

  // The height of your card. Home Assistant uses this to automatically
  // distribute all cards over the available columns.
  getCardSize() {
    return this._config.cardSize;
  }

  connectedCallback() {
    super.connectedCallback();
    Logger.debug("[MapCard.connectedCallback] called");
    globalThis.addEventListener?.("popstate", this._syncSelection);
    globalThis.addEventListener?.("location-changed", this._syncSelection);
    if (this.setupNeeded) {
      this.requestUpdate();
    }
  }

  _teardown() {
    this.creditsToggle?.dispose();
    this.creditsToggle = undefined;
    this.pathFollower?.dispose();
    this.pathFollower = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.staleStateService?.stop();
    this.groupFilter?.dispose();
    this.groupFilter = undefined;
    this.historyService?.unsubscribe();
    this.dateRangeManager?.disconnect();
    this.linkedEntityService?.disconnect();
    this.pluginsRenderService?.cleanup();
    this.geoJsonRenderService?.cleanup();
    this.shapeLayersService?.cleanup();
    this.pointLayersService?.cleanup();
    this.radarOverlayService?.cleanup();
    this.lightningOverlayService?.cleanup();
    this.cloudOverlayService?.cleanup();
    this.entitiesRenderService?.cleanup();
    this.presenceRenderService?.cleanup();
    this.presenceRenderService = undefined;
    this.map.remove();
    this.map = undefined;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    Logger.debug("[MapCard.disconnectedCallback] called");
    globalThis.removeEventListener?.("popstate", this._syncSelection);
    globalThis.removeEventListener?.("location-changed", this._syncSelection);
    if (this.map) {
      this._teardown();
      this.setupNeeded = true;
    }
  }

  /**
   * People, devices and zones as Home Assistant's map draws them (Lee, 2026-11-19): the presence service
   * takes the dashboard's person, device_tracker and zone entities, and EntitiesRenderService leaves
   * their older markers off the map. `presence_markers: false` takes nothing.
   */
  _setupPresence() {
    this.presenceRenderService = new PresenceRenderService(this.map, { enabled: this._config.presenceMarkers, styleHost: () => this });
    this.presenceRenderService.setEntities(this._config.entities);
    this.entitiesRenderService.drawnElsewhere = (id) => this.presenceRenderService?.drawsId(id) === true;
  }

  /**
   * The overview beside the map (step 2, Lee 2026-11-19): People, Devices and Zones, as Home Assistant's
   * map card shows it in a panel view. Shown when the card fills a panel view (railair-map's card sits in
   * auto-entities, so the enclosing hui-panel-view is looked for) or when `overview: true`; never with
   * `overview: false` or `presence_markers: false`. Its tab filters persons and trackers on the map, its
   * selection lives in the URL (?entity_id=, as HA), a tap on a person, tracker or zone selects, a tap on
   * the map clears it.
   */
  _setupOverview() {
    const svc = this.presenceRenderService;
    this._overviewOn = Boolean(svc?.enabled) && overviewShown(this._config.overview, inPanelView(this));
    if (!svc) return;
    svc.onSelect = (id) => this._overviewSelect(id);
    this._overviewPath = globalThis.location?.pathname;
    this._overviewSelected = this._overviewOn ? selectedFromSearch(globalThis.location?.search) : undefined;
    this._onMapClick = () => { if (this._overviewSelected) this._overviewSelect(undefined); };
    this.map.on("click", this._onMapClick);
    svc.setOverview({ shown: this._overviewOn, tab: this._overviewTab, selected: this._overviewSelected });
    // A selection named in the URL is brought into view once the initial view has been set.
    if (this._overviewSelected) setTimeout(() => this._focusSelected(), 0);
  }

  /**
   * Select (or with `undefined` clear) a person, tracker or zone. A new selection is focused on the map;
   * clearing returns the map to its initial view (HA refits its map).
   * @param {string|undefined} id
   * @param {{push?: boolean}} [o] push: record it in the URL (false when the URL itself changed)
   */
  _overviewSelect(id, { push = true } = {}) {
    if (!this._overviewOn) return;
    if (id === this._overviewSelected) { if (id) this._focusSelected(); return; }
    const was = this._overviewSelected;
    this._overviewSelected = id;
    if (push) this._navigateSelection(id);
    this.presenceRenderService?.setOverview({ shown: true, tab: this._overviewTab, selected: id });
    this.requestUpdate();
    if (id) this._focusSelected();
    else if (was) this._fitMap();
  }

  _focusSelected() {
    if (this._overviewSelected) this.presenceRenderService?.focus(this._overviewSelected, this._overviewPaddingNow() ?? {});
  }

  /** @param {string|undefined} id */
  _navigateSelection(id) {
    try {
      const loc = globalThis.location;
      globalThis.history.pushState(globalThis.history.state, "", `${loc.pathname}${searchWith(loc.search, id)}${loc.hash}`);
      globalThis.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
    } catch (e) {
      Logger.warn?.("[MapCard] the selection could not be put in the URL", e);
    }
  }

  /** Back and forward, or another card's navigation: follow the URL's selection on this card's page. */
  _syncSelection = () => {
    if (!this._overviewOn || globalThis.location?.pathname !== this._overviewPath) return;
    const id = selectedFromSearch(globalThis.location.search);
    if (id !== this._overviewSelected) this._overviewSelect(id, { push: false });
  };

  _onOverviewSelect(ev) {
    this._overviewSelect(ev.detail?.entityId);
  }

  _onOverviewTab(ev) {
    const tab = ev.detail?.tab;
    if (!tab || tab === this._overviewTab) return;
    this._overviewTab = tab;
    this.presenceRenderService?.setOverview({ shown: this._overviewOn, tab, selected: this._overviewSelected });
    this.requestUpdate();
  }

  _onOverviewResize(ev) {
    const before = JSON.stringify(this._overviewPaddingNow() ?? null);
    const { width, height } = ev.detail ?? {};
    // A collapsed overview keeps its width; zero both so it takes no space.
    this._overviewSize = width && height ? ev.detail : { width: 0, height: 0 };
    this._applyInsets();
    this.requestUpdate();
    if (this._overviewSelected && JSON.stringify(this._overviewPaddingNow() ?? null) !== before) this._focusSelected();
  }

  _isPhone() {
    return Boolean(globalThis.matchMedia?.("(max-width: 600px)")?.matches);
  }

  /** @returns {{left?: number, right?: number, bottom?: number}|undefined} what the panel covers */
  _overviewPaddingNow() {
    if (!this._overviewOn) return undefined;
    const { width, height, fitHeight } = this._overviewSize;
    if (!width || !height) return undefined;
    const phone = this._isPhone();
    let rtl = false;
    try { rtl = getComputedStyle(this).direction === "rtl"; } catch { /* no style */ }
    return overviewPadding(phone, phone ? (fitHeight ?? height) : width, rtl);
  }

  /** @returns {number} px the desktop panel takes from the map's left side (0 on a phone or without it) */
  _leftInset() {
    const w = this._overviewSize?.width;
    return this._overviewOn && w && !this._isPhone() ? w + 2 * OVERVIEW_GAP : 0;
  }

  /** Keep Leaflet's controls beside the panel (desktop) or above the sheet (phone), as HA keeps its own. */
  _applyInsets() {
    const box = this.map?.getContainer?.();
    if (!box?.querySelectorAll) return;
    const left = this._leftInset();
    box.querySelectorAll(".leaflet-top.leaflet-left, .leaflet-bottom.leaflet-left").forEach((el) => { el.style.left = left ? `${left}px` : ""; });
    const h = this._overviewSize?.height;
    const bottom = this._overviewOn && h && this._isPhone() ? h + 8 : 0;
    box.querySelectorAll(".leaflet-bottom").forEach((el) => { el.style.bottom = bottom ? `${bottom}px` : ""; });
  }

  /** @returns {Map<string, string>} a dashboard `name:` per entity, which the overview shows as HA does */
  _overviewNames() {
    const raw = this.config?.entities;
    const key = JSON.stringify(raw ?? null);
    if (this._namesKey !== key) {
      this._namesKey = key;
      this._names = new Map((Array.isArray(raw) ? raw : [])
        .filter((e) => e && typeof e === "object" && typeof e.entity === "string" && typeof e.name === "string")
        .map((e) => [e.entity, e.name]));
    }
    return this._names;
  }

  _overviewZoneColor = (id) => this.presenceRenderService?.zoneColor({ id }) ?? "var(--primary-color)";

  /**
   * The credits box collapses behind an "i" button (Lee, 2026-11-19;
   * util/CreditsToggle.js); `attribution_collapse: false` keeps it open.
   * Nothing here may stop the map: any failure leaves the box as Leaflet made it.
   */
  _setupCreditsToggle() {
    try {
      if (!this._config.creditsCollapse || !this.map) return;
      const toggle = new CreditsToggle(this.map);
      if (toggle.setup()) this.creditsToggle = toggle;
    } catch (e) {
      Logger.error("[MapCard] collapsible credits disabled", e);
      this.creditsToggle = undefined;
    }
  }

  /**
   * Path-following (item 270 part 2): water markers slide along the water
   * from path_min_zoom up. The follower hangs off the Leaflet map, where
   * each Entity finds it; a card with `path_following: false` has none.
   * Nothing here may stop the map: any failure leaves straight slides.
   */
  _setupPathFollower() {
    try {
      const opts = this._config.pathFollowing;
      if (!opts?.enabled || !this.map) return;
      const follower = new PathFollower(this.map, opts);
      this.pathFollower = follower;
      this.map.ltmcPathFollower = follower;
      const redraw = () => {
        if (this.map && this.pathFollower === follower) this.entitiesRenderService?.refreshDrawnPositions();
      };
      follower.onTiles(redraw);
      this.map.on("zoomend", redraw);
    } catch (e) {
      Logger.error("[MapCard] path-following disabled", e);
      this.pathFollower = undefined;
    }
  }

  _isDarkMode() {
    return (
      this.themeMode === "dark" ||
      (this.themeMode === "auto" && Boolean(this.hass.themes.darkMode))
    );
  }

  /**
   * The build this element comes from - "0.1.0+2a37a80". Read it in a browser
   * with customElements.get('live-track-map-card').version.
   * @returns {string}
   */
  static get version() {
    return VERSION;
  }

  static getStubConfig(hass) {
    // Find a power entity for default
    const sampleEntities = Object.keys(hass.states).filter(
      (entityId) => {
        const entity = hass.states[entityId];
        return (entity.state && entity.attributes && entity.attributes.latitude && entity.attributes.longitude);
      }
    );

    // Sample config
    return {
      type: 'custom:live-track-map-card',
      history_start: '24 hours ago',
      entities: sampleEntities
    };
  }

  static get styles() {
    return css`
      ha-card {
        height: 100%;
        display: flex;
        width: 100%;
        flex-direction: column;
        overflow: hidden;
      }
      #mapContainer {
        position: relative;
        border-radius: var(--ha-card-border-radius, 12px);
        overflow: hidden;
        z-index: 0;
        height: 100%;
        width: 100%;
      }
      /* The overview (step 2): floating at the start side, as HA's #overview; on a phone its sheet is in the top layer. */
      #overview {
        position: absolute;
        top: 12px;
        inset-inline-start: 12px;
        width: min(360px, calc(100% - 24px));
        max-height: calc(100% - 24px);
        display: flex;
        z-index: 2;
      }
      #overview[single-tab] {
        width: min(300px, calc(100% - 24px));
      }
      #overview[phone] {
        top: auto;
        bottom: 0;
        width: 0;
        height: 0;
      }
      #map {
        height: 100%;
      }
      .leaflet-pane {
        z-index: 0 !important;
      }
      .leaflet-edit-resize {
        border-radius: 50%;
        cursor: nesw-resize !important;
      }
      .leaflet-control,
      .leaflet-top,
      .leaflet-bottom {
        z-index: 1 !important;
      }
      .leaflet-tooltip {
        padding: 8px;
        font-size: 90%;
        background: rgba(80, 80, 80, 0.9) !important;
        color: white !important;
        border-radius: 4px;
        box-shadow: none !important;
      }
      .leaflet-tooltip .hover-airports {
        white-space: normal;
        width: max-content;
        max-width: 20em;
        margin-top: 2px;
      }
      .leaflet-tooltip .hover-source {
        font-size: 85%;
        opacity: 0.75;
        margin-top: 2px;
      }
      /* D4g (backlog 346): a photo under the hover box's lines, with its credit; the popup's photo and links. */
      .leaflet-tooltip .hover-photo {
        margin-top: 6px;
        width: 160px;
      }
      .leaflet-tooltip .hover-photo img,
      .ltmc-extras .ltmc-photo img {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.1);
      }
      .leaflet-tooltip .hover-credit {
        font-size: 75%;
        opacity: 0.75;
        margin-top: 2px;
        white-space: normal;
      }
      .ltmc-extras {
        width: 280px;
        max-width: 100%;
      }
      .ltmc-shape-info + .ltmc-extras {
        margin-top: 8px;
      }
      .ltmc-extras .ltmc-title {
        font-weight: bold;
        margin-bottom: 6px;
      }
      .ltmc-extras .ltmc-credit {
        font-size: 80%;
        opacity: 0.8;
        margin-top: 3px;
      }
      .ltmc-extras .ltmc-links {
        margin-top: 6px;
      }
      .ltmc-extras .ltmc-details {
        margin-top: 8px;
        text-align: right;
      }
      .ltmc-extras .ltmc-details-button {
        font: inherit;
        cursor: pointer;
        padding: 2px 10px;
        border: 1px solid currentColor;
        border-radius: 4px;
        background: transparent;
        color: inherit;
      }
      .distance-tooltip {
        padding: 4px 8px;
        font-size: 12px;
        font-weight: bold;
        background: rgba(0, 0, 0, 0.8) !important;
        color: white !important;
        border-radius: 12px;
        border: none !important;
        white-space: nowrap;
      }
      .distance-tooltip::before {
        display: none;
      }
      #map.dark {
         background: #090909;
        color: #ffffff;
        --map-filter: invert(0.9) hue-rotate(170deg) brightness(1.5)
          contrast(1.2) saturate(0.3);
      }
      #map.dark .leaflet-control-attribution {
        background: #000000cc;
        color: #ffffff;
      }
      #map.dark .leaflet-control-attribution a {
        color: #ffffff;
      }
      .leaflet-control-attribution.ltmc-credits-collapsed {
        display: none;
      }
      .leaflet-control-attribution.ltmc-credits-open {
        overflow-y: auto;
        box-sizing: border-box;
        overflow-wrap: anywhere;
      }
      .ltmc-credits-control {
        clear: both;
      }
      .ltmc-credits-button {
        display: block;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 1px solid rgba(0, 0, 0, 0.3);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.85);
        color: #333333;
        font: italic bold 15px/22px Georgia, "Times New Roman", serif;
        text-align: center;
        cursor: pointer;
      }
      .ltmc-credits-button[aria-expanded="true"] {
        font: bold 16px/22px Arial, sans-serif;
      }
      #map.dark .ltmc-credits-button {
        background: #000000cc;
        color: #ffffff;
        border-color: rgba(255, 255, 255, 0.4);
      }
      #map.light {
        background: #ffffff;
        color: #000000;
        --map-filter: invert(0);
      }
      .dark .leaflet-bar a {
        background-color: #1c1c1c;
        color: #ffffff;
      }
      .dark .leaflet-bar a:hover {
        background-color: #313131;
      }
      .leaflet-tile-pane {
        filter: var(--map-filter);
      }
    `;
  }
}
