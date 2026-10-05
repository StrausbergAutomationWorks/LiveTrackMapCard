/**
 * Path-following options and the default vector tile sources (item 270
 * part 2, card SSOT 40-41). Kept apart from the tile code so the config
 * layer does not pull in a tile decoder.
 */

export const DEFAULT_MIN_ZOOM = 14;

/**
 * From this zoom a water marker NEVER slides on a chord the card has not
 * checked: when the water tiles for a move are not in yet, it is placed at
 * its fix instead of sliding straight (Lee, 2026-10-05: "4 clicks on + is
 * absolutely mandatory", 14 from the default 10). Below it, from
 * path_min_zoom, water is followed when the tiles are there.
 */
export const DEFAULT_STRICT_ZOOM = 14;

/**
 * Tried in order. OpenStreetMap's own vector tiles are PRIMARY and
 * OpenFreeMap the fail-safe (Lee, 2026-09-29): Shortbread matched full-detail
 * OSM on 1,106 of 1,106 river chords, breakwaters included; OpenMapTiles on
 * 1,095.
 */
export const DEFAULT_SOURCES = Object.freeze([
  Object.freeze({
    id: "openstreetmap",
    tilejson: "https://vector.openstreetmap.org/shortbread_v1/tilejson.json",
    schema: "shortbread",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }),
  Object.freeze({
    id: "openfreemap",
    tilejson: "https://tiles.openfreemap.org/planet",
    schema: "openmaptiles",
    attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
]);

/**
 * Parse the card options. `path_following: false` turns it off (anything
 * else, absent included, leaves it on); `path_min_zoom` moves the gate;
 * `path_tile_sources` replaces the source list, each entry {id, tilejson or
 * tiles, schema ('shortbread' or 'openmaptiles'), attribution}. Entries that
 * do not parse are dropped; none left means the defaults.
 * `path_strict_zoom` moves the zoom from which an unchecked move is placed,
 * never slid (DEFAULT_STRICT_ZOOM).
 * @param {object} input the card's YAML
 * @returns {{enabled: boolean, minZoom: number, strictZoom: number, sources: Array}}
 */
export function parsePathOptions(input = {}) {
  const enabled = input?.path_following !== false;
  const num = (raw) => (raw === undefined || raw === null || raw === "" ? NaN : Number(raw));
  const z = num(input?.path_min_zoom);
  const minZoom = Number.isFinite(z) ? z : DEFAULT_MIN_ZOOM;
  const zs = num(input?.path_strict_zoom);
  const strictZoom = Number.isFinite(zs) ? zs : DEFAULT_STRICT_ZOOM;
  const given = Array.isArray(input?.path_tile_sources) ? input.path_tile_sources : null;
  const sources = given
    ? given.filter((s) => s && typeof s.id === "string"
        && (typeof s.tilejson === "string" || typeof s.tiles === "string")
        && (s.schema === "shortbread" || s.schema === "openmaptiles"))
    : DEFAULT_SOURCES;
  return { enabled, minZoom, strictZoom, sources: sources.length ? sources : DEFAULT_SOURCES };
}
