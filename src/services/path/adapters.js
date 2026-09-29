/**
 * Schema adapters (item 270 part 2, card SSOT 41.1): each turns one decoded
 * vector tile into the SAME thing - water polygons, and the structures that
 * stand in the water (piers, breakwaters, groynes) - so the router never
 * knows which source answered.
 *
 * Measured over the Chicago River box, against full-detail OSM water
 * (1,106 moving chords): Shortbread 1,106 of 1,106 land verdicts the same,
 * OpenMapTiles 1,095 (it carries no breakwaters).
 *
 * A tile here is anything with `layers[name]` holding `length`, `extent` and
 * `feature(i)` -> {type, properties, loadGeometry()}, which is the shape of
 * the vector-tile decoder's output (package `@mapbox/vector-tile`). Geometry comes out normalised to extent 1.
 */

const POLYGON = 3;
const LINE = 2;

/** OSMF Shortbread: `water_polygons` kinds kept; glacier and the rest dropped. */
export const SHORTBREAD_WATER_KINDS = new Set(["water", "river", "reservoir", "basin", "dock", "canal"]);
/** OpenMapTiles `water` classes kept; swimming_pool and pond dropped (217 and 54 in the river box). */
export const OPENMAPTILES_WATER_CLASSES = new Set(["river", "lake", "dock", "ocean"]);

/**
 * @param {object} feature
 * @param {number} extent
 * @returns {Array<Array<{x: number, y: number}>>} rings normalised to extent 1
 */
function scaled(feature, extent) {
  return feature.loadGeometry().map((ring) => ring.map((p) => ({ x: p.x / extent, y: p.y / extent })));
}

/**
 * @param {object} tile
 * @param {string} layerName
 * @param {function(object, number): void} fn called with each feature and its layer's extent
 */
function eachFeature(tile, layerName, fn) {
  const layer = tile?.layers?.[layerName];
  if (!layer) return;
  const extent = layer.extent || 4096;
  for (let i = 0; i < layer.length; i++) fn(layer.feature(i), extent);
}

/**
 * @param {object} tile a decoded Shortbread tile
 * @returns {{extent: number, water: Array, structurePolygons: Array, structureLines: Array}}
 */
export function shortbreadGeometry(tile) {
  const out = { extent: 1, water: [], structurePolygons: [], structureLines: [] };
  eachFeature(tile, "ocean", (f, ext) => {
    if (f.type === POLYGON) out.water.push(scaled(f, ext));
  });
  eachFeature(tile, "water_polygons", (f, ext) => {
    if (f.type === POLYGON && SHORTBREAD_WATER_KINDS.has(f.properties?.kind)) out.water.push(scaled(f, ext));
  });
  eachFeature(tile, "pier_polygons", (f, ext) => {
    if (f.type === POLYGON) out.structurePolygons.push(scaled(f, ext));
  });
  eachFeature(tile, "pier_lines", (f, ext) => {
    if (f.type === LINE) out.structureLines.push(...scaled(f, ext));
  });
  return out;
}

/**
 * @param {object} tile a decoded OpenMapTiles tile
 * @returns {{extent: number, water: Array, structurePolygons: Array, structureLines: Array}}
 */
export function openMapTilesGeometry(tile) {
  const out = { extent: 1, water: [], structurePolygons: [], structureLines: [] };
  eachFeature(tile, "water", (f, ext) => {
    if (f.type === POLYGON && OPENMAPTILES_WATER_CLASSES.has(f.properties?.class)) out.water.push(scaled(f, ext));
  });
  eachFeature(tile, "transportation", (f, ext) => {
    if (f.properties?.class !== "pier") return;
    if (f.type === POLYGON) out.structurePolygons.push(scaled(f, ext));
    else if (f.type === LINE) out.structureLines.push(...scaled(f, ext));
  });
  return out;
}

export const ADAPTERS = {
  shortbread: shortbreadGeometry,
  openmaptiles: openMapTilesGeometry,
};
