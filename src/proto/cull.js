// PROTOTYPE ONLY (map capacity, 2026-10-25). Off-screen DOM markers are taken off the map.
//
// A culled marker keeps its object, position and stored DivIcon html; Leaflet rebuilds its
// element from that html when it comes back, the same path a marker leaving a cluster takes,
// so attribute writes made while it was off (Entity._setMarkerAttribute) are not lost.
import { Marker } from "leaflet";
import { stats } from "./flags.js";

/** How far beyond the view a marker stays on the map, as a fraction of the view. */
export const CULL_PAD = 0.3;

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
    const on = Boolean(m._map);
    if (want && !on) { Marker.prototype.addTo.call(m, map); stats.culledIn++; }
    else if (!want && on) { Marker.prototype.remove.call(m); stats.culledOut++; }
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
    if (m._map) Marker.prototype.remove.call(m);
    return m;
  };
  m.setLatLng = function (ll) { setLL.call(m, ll); if (m.__ltmcWanted) reg.check(m); return m; };
  m.__ltmcCulled = true;
  return m;
}
