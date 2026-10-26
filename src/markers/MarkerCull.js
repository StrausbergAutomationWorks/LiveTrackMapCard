// Off-screen DOM markers are taken off the map (map capacity, card SSOT 2026-10-25).
//
// A culled marker keeps its object, position and stored DivIcon html; Leaflet rebuilds its
// element from that html when it comes back, the same path a marker leaving a cluster takes,
// so attribute writes made while it was off (Entity._setMarkerAttribute) are not lost.
// Not used with clustering on: the cluster group decides what is on the map.
import { Marker, Util } from "leaflet";
import { stats } from "./MarkerStats.js";

/** How far beyond the view a marker stays on the map, as a fraction of the view. */
export const CULL_PAD = 0.3;

/**
 * Take a marker off the map. One only queued (added before the map's first view, so never
 * drawn) is dropped from the map's layer table instead: Leaflet's remove() would run
 * onRemove for an icon that was never built and throw. Leaflet's deferred add checks
 * hasLayer first, so the dropped marker is not added afterwards.
 * @param {Marker} m
 * @param {object} map
 */
function takeOff(m, map) {
  if (m._map) { Marker.prototype.remove.call(m); return; }
  delete map._layers[Util.stamp(m)];
  m._mapToAdd = null;
}

/**
 * The map's culling registry, made on first use: the culled markers and the padded view.
 * @param {object} map
 * @returns {{set: Set<Marker>, bounds: object|null, refresh: () => void, check: (m: Marker) => void, checkAll: () => void}}
 */
function registry(map) {
  if (map.__ltmcCull) return map.__ltmcCull;
  const reg = { set: new Set(), bounds: null };
  // A map with no view yet (the card builds its entities before its initial view) has no
  // bounds: getBounds() throws "Set map center and zoom first". Everything is kept on it
  // until it loads, then checked.
  reg.refresh = () => { reg.bounds = map._loaded ? map.getBounds().pad(CULL_PAD) : null; };
  reg.check = (m) => {
    if (!reg.bounds) reg.refresh();
    const ll = m.getLatLng();
    const want = Boolean(ll) && (!reg.bounds || reg.bounds.contains(ll));
    // On the map, or queued for it: Leaflet defers an add made before the map's first view
    // (map.whenReady), so the marker has `_mapToAdd` and no `_map` until then. Counting
    // only `_map` let every marker added before the first view through the first check and
    // onto the map, off screen or not (found by MarkerCull.test.js, 2026-10-25).
    const on = Boolean(m._map || m._mapToAdd);
    if (want && !on) { Marker.prototype.addTo.call(m, map); stats.culledIn++; }
    else if (!want && on) { takeOff(m, map); stats.culledOut++; }
  };
  reg.checkAll = () => { reg.refresh(); for (const m of reg.set) reg.check(m); };
  map.on("load moveend zoomend resize viewreset", reg.checkAll);
  map.__ltmcCull = reg;
  return reg;
}

/**
 * Make a Leaflet marker cull itself: addTo/remove/setLatLng go through the registry.
 * @param {Marker} m
 * @param {object} map Leaflet map
 * @returns {Marker} the same marker
 */
export function cullMarker(m, map) {
  if (m.__ltmcCulled) return m;
  const reg = registry(map);
  const setLL = m.setLatLng;
  m.addTo = function () { reg.set.add(m); m.__ltmcWanted = true; reg.check(m); return m; };
  m.remove = function () {
    reg.set.delete(m); m.__ltmcWanted = false;
    if (m._map || m._mapToAdd) takeOff(m, map);
    return m;
  };
  m.setLatLng = function (ll) { setLL.call(m, ll); if (m.__ltmcWanted) reg.check(m); return m; };
  m.__ltmcCulled = true;
  return m;
}
