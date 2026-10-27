/**
 * The hover box: what the instant Leaflet tooltip says about a marker.
 *
 * The emitters publish physics and names (06_MAP_CONTRACT.md D4b); the
 * words are the card's. Lee, 2026-10-02 and 2026-10-03:
 *
 *   aircraft   CALLSIGN                      AAL435
 *              ORIGIN-DESTINATION ETA        KPHX-KORD in 12 min
 *   train      LINE NAME                     Union Pacific Northwest
 *              NEXT STATION ETA              Irving Park in 4 min
 *
 * The train number is NOT repeated: it is on the marker being hovered.
 * Under one minute: "Arriving Irving Park", "KPHX-KORD arriving". A station
 * with no time: "Next: Irving Park". A time with no station says nothing.
 * A route the integration judged implausible (no leg on file fits where the
 * aircraft is) reads "New route < 24hrs old" in place of the route, with no
 * ETA, no names and no source (backlog 281, Lee 2026-10-06; built 2026-10-22).
 * It keys on route_check alone, so it holds if the integration later stops
 * publishing the codes of a leg it rejected.
 * Anything else keeps the text it had (friendly name, "<person> is at ...").
 *
 * Under an aircraft's route (backlog 293, 2026-10-22), the airport names as
 * the integration publishes them (`origin_name`, `destination_name`; the card
 * keeps no airport table), then where the route came from (`route_source`),
 * smaller:
 *
 *              South Bend International Airport
 *              to Purdue University Airport
 *              FiledRoutesDB
 *
 * One name alone reads "From <name>" or "To <name>". An unknown route_source
 * says nothing rather than guess.
 */

/** How often an OPEN hover box is redrawn, ms. */
export const HOVER_REFRESH_MS = 5000;

/**
 * Escape text for HTML. A Leaflet tooltip given a string sets innerHTML,
 * and every name here is feed text.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A non-blank string, trimmed, or null.
 * @param {*} value
 * @returns {string|null}
 */
function text(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

/**
 * Whole minutes from now to the instant, or null when it is not a string
 * that parses. A bare number is refused: Date.parse reads 2026 as a year.
 * @param {*} iso
 * @param {number} nowMs
 * @returns {number|null}
 */
function minutesUntil(iso, nowMs) {
  if (typeof iso !== "string" || !Number.isFinite(nowMs)) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((t - nowMs) / 60000);
}

/**
 * "<n> min" under an hour, then "<h> h" or "<h> h <m> min".
 * @param {number} n whole minutes, 1 or more
 * @returns {string}
 */
function minutesText(n) {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The second line when no leg on file fits the aircraft (backlog 281). */
export const NEW_ROUTE_TEXT = "New route < 24hrs old";

/**
 * Whether the integration judged the route implausible: no leg on file fits.
 * @param {object} a attributes
 * @returns {boolean}
 */
export function isNewRoute(a) {
  return a?.route_check === "implausible";
}

/**
 * "<ORIG>-<DEST>", or null: none without both ends, none for a route the
 * integration judged implausible. IATA when published, else ICAO.
 * @param {object} a attributes
 * @returns {string|null}
 */
export function routeText(a) {
  if (isNewRoute(a)) return null;
  const o = text(a?.origin_iata) ?? text(a?.origin_icao);
  const d = text(a?.destination_iata) ?? text(a?.destination_icao);
  if (!o || !d) return null;
  return `${o}-${d}`;
}

/**
 * The second line, plain text, or null.
 * @param {object} a attributes
 * @param {number} nowMs epoch milliseconds
 * @returns {string|null}
 */
export function detailLine(a, nowMs) {
  if (isNewRoute(a)) return NEW_ROUTE_TEXT;
  const route = routeText(a);
  const n = minutesUntil(a?.arrival_estimated_at, nowMs);
  if (route) {
    if (n === null) return route;
    return n < 1 ? `${route} arriving` : `${route} in ${minutesText(n)}`;
  }
  const station = text(a?.next_stop);
  if (!station) return null;            // a time with no station says nothing
  if (n === null) return `Next: ${station}`;
  return n < 1 ? `Arriving ${station}` : `${station} in ${minutesText(n)}`;
}

/**
 * The first line, plain text: callsign, else line name, else the fallback.
 * @param {object} a attributes
 * @param {string} fallback what the box said before (Entity.tooltip)
 * @returns {string}
 */
export function titleLine(a, fallback) {
  return text(a?.callsign) ?? text(a?.line_name) ?? (fallback ?? "");
}

/**
 * What each published `route_source` is called in the box: the source's
 * own name (Lee, 2026-10-22 22:38). Lee's study
 * `adsb-route-accuracy`: the two are not equally trustworthy, so the box
 * says which one it is.
 */
export const ROUTE_SOURCE_TEXT = Object.freeze({
  saw_filed_routes: "FiledRoutesDB",
  adsbdb: "adsbdb",
});

/**
 * The airport-name lines under a route, plain text: [] unless the box
 * shows a route.
 * @param {object} a attributes
 * @returns {string[]}
 */
export function airportLines(a) {
  if (!routeText(a)) return [];
  const o = text(a.origin_name);
  const d = text(a.destination_name);
  if (o && d) return [o, `to ${d}`];
  if (o) return [`From ${o}`];
  if (d) return [`To ${d}`];
  return [];
}

/**
 * Where the shown route came from, plain text, or null.
 * @param {object} a attributes
 * @returns {string|null}
 */
export function sourceText(a) {
  if (!routeText(a)) return null;
  const s = text(a.route_source);
  return s && Object.prototype.hasOwnProperty.call(ROUTE_SOURCE_TEXT, s) ? ROUTE_SOURCE_TEXT[s] : null;
}

/**
 * The whole box as HTML, every line escaped.
 * @param {object} a attributes
 * @param {string} fallback the first line when there is nothing better
 * @param {number} nowMs epoch milliseconds
 * @returns {string}
 */
export function hoverHtml(a, fallback, nowMs) {
  if (isStorm(a)) return stormHtml(a, fallback);
  const first = escapeHtml(titleLine(a, fallback));
  const second = detailLine(a, nowMs);
  let html = second ? `${first}<br>${escapeHtml(second)}` : first;
  const names = airportLines(a);
  if (names.length) html += `<div class="hover-airports">${names.map(escapeHtml).join("<br>")}</div>`;
  const source = sourceText(a);
  if (source) html += `<div class="hover-source">${escapeHtml(source)}</div>`;
  return html;
}

/**
 * Tropical cyclones (06_MAP_CONTRACT_OVERLAYS.md D15): the entity's name
 * ("Tropical Storm Vance"), the wind in kt with km/h and the pressure, the
 * movement, then, smaller, the source and the advisory.
 */

/** What each published `storm_source` is called in the box. */
export const STORM_SOURCE_TEXT = Object.freeze({
  nhc: "NOAA NHC",
  jtwc_eonet: "JTWC via NASA EONET",
});

const POINTS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/**
 * @param {*} v
 * @returns {number|null} a finite number, else null
 */
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * @param {object} a attributes
 * @returns {boolean} a storm: it names its class
 */
export function isStorm(a) {
  return text(a?.storm_class) !== null;
}

/**
 * The storm's wind and pressure line and its movement line, plain text.
 * @param {object} a attributes
 * @returns {string[]}
 */
export function stormLines(a) {
  const out = [];
  const kmh = num(a?.max_wind_kmh);
  const hpa = num(a?.pressure_hpa);
  const parts = [];
  if (kmh !== null) parts.push(`${Math.round(kmh / 1.852)} kt (${Math.round(kmh)} km/h)`);
  if (hpa !== null) parts.push(`${Math.round(hpa)} hPa`);
  if (parts.length) out.push(parts.join(", "));
  const c = num(a?.course_deg);
  const s = num(a?.speed_kmh);
  if (c !== null && s !== null) {
    const point = POINTS16[Math.round((((c % 360) + 360) % 360) / 22.5) % 16];
    out.push(`Moving ${point} at ${Math.round(s)} km/h`);
  }
  return out;
}

/**
 * The source line, plain text, or null for an unknown source.
 * @param {object} a attributes
 * @returns {string|null}
 */
export function stormSourceText(a) {
  const s = text(a?.storm_source);
  if (!s || !Object.prototype.hasOwnProperty.call(STORM_SOURCE_TEXT, s)) return null;
  const n = num(a?.advisory_number);
  return n !== null ? `${STORM_SOURCE_TEXT[s]}, advisory ${Math.round(n)}` : STORM_SOURCE_TEXT[s];
}

/**
 * @param {object} a attributes
 * @param {string} fallback the entity's name
 * @returns {string} HTML, every line escaped
 */
export function stormHtml(a, fallback) {
  let html = [fallback ?? "", ...stormLines(a)].map(escapeHtml).join("<br>");
  const src = stormSourceText(a);
  if (src) html += `<div class="hover-source">${escapeHtml(src)}</div>`;
  return html;
}
