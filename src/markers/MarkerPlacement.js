// Where a marker goes: on the canvas or in the DOM, and in which pane.
//
// 06_MAP_CONTRACT.md D10 stacks the map's objects in five classes, fixed < water < rail <
// air_low < air, by a zIndexOffset step of 10000 per class. Leaflet orders DOM markers by
// screen y plus that offset, all in one pane. A canvas cannot be interleaved with DOM
// elements inside one pane, so when the canvas is in use every class gets TWO panes of its
// own, its canvas and then its DOM markers, stacked in class order:
//
//   fixed 601/602, water 603/604, rail 605/606, air_low 607/608, air 609/610
//
// (Leaflet's own markerPane is 600, tooltipPane 650.) D10 then holds across canvas and DOM.
// Inside one class the canvas markers sit under that class's DOM markers rather than being
// ordered by screen y with them: the one difference from the card without a canvas.
//
// With the canvas off, or with clustering on, nothing here applies: every marker stays in
// Leaflet's markerPane exactly as before.
import { Marker } from "leaflet";
import { stats } from "./MarkerStats.js";

/** D10's classes, bottom to top. */
export const BANDS = Object.freeze(["fixed", "water", "rail", "air_low", "air"]);
/** The zIndexOffset step between two classes (EntityConfig.MAP_LAYER_OFFSETS). */
export const BAND_STEP = 10000;
/** The first pane's z-index: one above Leaflet's markerPane. */
export const PANE_BASE = 601;

/**
 * The class a zIndexOffset falls in. A dashboard `z_index_offset` override lands in the
 * class its number falls in; below 0 is `fixed`, above `air` is `air`.
 * @param {number} z
 * @returns {number} 0..4
 */
export function bandOf(z) {
  const n = Math.floor((Number(z) || 0) / BAND_STEP);
  return Math.min(BANDS.length - 1, Math.max(0, n));
}

/** @param {number} b @returns {string} */
export const canvasPane = (b) => `ltmcCanvas_${BANDS[b]}`;
/** @param {number} b @returns {string} */
export const domPane = (b) => `ltmcMarkers_${BANDS[b]}`;

/**
 * Create the ten panes once per map.
 * @param {object} map Leaflet map
 */
export function ensurePanes(map) {
  for (let b = 0; b < BANDS.length; b++) {
    for (const [name, z] of [[canvasPane(b), PANE_BASE + 2 * b], [domPane(b), PANE_BASE + 2 * b + 1]]) {
      if (map.getPane(name)) continue;
      const pane = map.createPane(name);
      pane.style.zIndex = String(z);
      if (name.startsWith("ltmcCanvas")) pane.style.pointerEvents = "none";
    }
  }
}

/**
 * Set how this map's markers are drawn. Called once by EntitiesRenderService.
 * @param {object} map Leaflet map
 * @param {{canvas: boolean, cull: boolean}} how
 */
export function setupPlacement(map, how) {
  if (!map) return;
  map.__ltmcPlacement = { canvas: Boolean(how?.canvas), cull: Boolean(how?.cull) };
  if (map.__ltmcPlacement.canvas && typeof map.createPane === "function") ensurePanes(map);
}

/**
 * @param {object} map
 * @returns {{canvas: boolean, cull: boolean}}
 */
export function placement(map) {
  return map?.__ltmcPlacement ?? { canvas: false, cull: false };
}

/**
 * Put a DOM marker in its class's pane, and keep it there when its offset moves it to
 * another class (a changed map_layer): Leaflet reads `pane` only when it builds the icon,
 * so the marker is taken off and put back. A marker that is off the map (culled, or not
 * yet added) just carries the new pane.
 * @param {Marker} m
 * @param {object} map
 * @returns {Marker} the same marker
 */
export function bandMarker(m, map) {
  if (m.__ltmcBanded) return m;
  m.options.pane = domPane(bandOf(m.options.zIndexOffset));
  const setZ = m.setZIndexOffset;
  m.setZIndexOffset = function (z) {
    const pane = domPane(bandOf(z));
    if (m.options.pane !== pane) {
      const on = Boolean(m._map);
      if (on) Marker.prototype.remove.call(m);
      m.options.pane = pane;
      if (on) Marker.prototype.addTo.call(m, map);
      stats.bandMoves++;
    }
    return setZ.call(m, z);
  };
  m.__ltmcBanded = true;
  return m;
}
