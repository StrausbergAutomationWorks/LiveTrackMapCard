// Test-only. leaflet.markercluster's UMD build extends the GLOBAL `L`; the
// bundle provides one, jsdom does not. Import this before the plugin.
import L from 'leaflet';

window.L = L;

export default L;
