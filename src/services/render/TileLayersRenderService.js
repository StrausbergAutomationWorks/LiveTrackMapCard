
import L from "leaflet";
import TileLayerConfig from "../../configs/TileLayerConfig";
import WmsLayerConfig from "../../configs/WmsLayerConfig";
import Layer from "../../models/Layer";
import LayerWithHistory from "../../models/LayerWithHistory";
import Map from "leaflet";

/** Where a viewer's choice for a named overlay is kept, per overlay name. */
export const OVERLAY_STORAGE_PREFIX = "ltmc.overlay.";

/**
 * The viewer's stored choice for a named overlay: true, false, or null when
 * there is none or storage cannot be read (a private window, blocked site
 * data). Never throws.
 * @param {string} name
 * @param {Storage} [storage]
 * @returns {boolean|null}
 */
export function storedOverlayChoice(name, storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(OVERLAY_STORAGE_PREFIX + name);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

/**
 * Keep the viewer's choice for a named overlay. Never throws.
 * @param {string} name
 * @param {boolean} shown
 * @param {Storage} [storage]
 */
export function storeOverlayChoice(name, shown, storage = globalThis.localStorage) {
  try {
    storage?.setItem(OVERLAY_STORAGE_PREFIX + name, shown ? "1" : "0");
  } catch {
    /* a convenience only: the dashboard's `show` applies next time */
  }
}

export default class TileLayersService {
  
  /** @type {Map} */
  map;
  /** @type {[TileLayerConfig]} */
  tileLayersConfig = [];
  /** @type {[WmsLayerConfig]} */
  wmsLayersConfig = [];
  /** @type {HaUrlResolveService} */
  urlResolver;
  /** @type {LinkedEntityService} */
  linkedEntityService;
  /** @type {DateRangeManager} */
  dateRangeManager;
  /** The layer control, when any overlay is named; else null. */
  control = null;

  constructor(map, tileLayersConfig, wmsLayersConfig, urlResolver, linkedEntityService, dateRangeManager, storage = globalThis.localStorage) {
    this.map = map;
    this.tileLayersConfig = tileLayersConfig;
    this.wmsLayersConfig = wmsLayersConfig;
    this.urlResolver = urlResolver;
    this.linkedEntityService = linkedEntityService;
    this.dateRangeManager = dateRangeManager;
    this.storage = storage;
  }

  async setup() {    
    const named = this._addLayers(this.map, this.tileLayersConfig, 'tile');
    this._addLayers(this.map, this.wmsLayersConfig, 'wms');
    this._addControl(named);
  }

  async render() {}

  /**
   * @param {Map} map
   * @param {[LayerConfig]} configs  
   * @param {string} layerType 
   * @returns {{[name: string]: object}} the named overlays' Leaflet layers
   */
  _addLayers(map, configs, layerType) {
    const named = {};
    (configs ?? []).forEach((l) => {
      if (l.historyProperty) {
        new LayerWithHistory(layerType, l, map, this.urlResolver, this.linkedEntityService, this.dateRangeManager).render();
        return;
      }
      const layer = new Layer(layerType, l, map, this.urlResolver);
      if (!l.name) {
        layer.render();
        return;
      }
      // The viewer's own choice wins over the dashboard's `show`.
      const stored = storedOverlayChoice(l.name, this.storage);
      named[l.name] = layer.render(stored ?? l.show !== false);
    });
    return named;
  }

  /**
   * A layer control with one checkbox per named overlay, top right, always
   * open (no icon to hover). Each change is remembered in the viewer's own
   * browser. Nothing is added when no overlay is named.
   * @param {{[name: string]: object}} named
   */
  _addControl(named) {
    if (!named || Object.keys(named).length === 0) return;
    this.control = new L.Control.Layers(null, named, { collapsed: false, position: "topright" });
    this.control.addTo(this.map);
    const byLayer = new globalThis.Map(Object.entries(named).map(([n, layer]) => [layer, n]));
    const remember = (shown) => (e) => {
      const n = byLayer.get(e.layer);
      if (n) storeOverlayChoice(n, shown, this.storage);
    };
    this.map.on("overlayadd", remember(true));
    this.map.on("overlayremove", remember(false));
  }
}
