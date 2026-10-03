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
 * A route the integration judged implausible is shown with a "?".
 * Anything else keeps the text it had (friendly name, "<person> is at ...").
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

/**
 * "<ORIG>-<DEST>", "?" appended when route_check is implausible; or null.
 * IATA when published, else ICAO (Lee: codes until names exist).
 * @param {object} a attributes
 * @returns {string|null}
 */
export function routeText(a) {
  const o = text(a?.origin_iata) ?? text(a?.origin_icao);
  const d = text(a?.destination_iata) ?? text(a?.destination_icao);
  if (!o || !d) return null;
  return `${o}-${d}${a.route_check === "implausible" ? "?" : ""}`;
}

/**
 * The second line, plain text, or null.
 * @param {object} a attributes
 * @param {number} nowMs epoch milliseconds
 * @returns {string|null}
 */
export function detailLine(a, nowMs) {
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
 * The whole box as HTML, both lines escaped.
 * @param {object} a attributes
 * @param {string} fallback the first line when there is nothing better
 * @param {number} nowMs epoch milliseconds
 * @returns {string}
 */
export function hoverHtml(a, fallback, nowMs) {
  const first = escapeHtml(titleLine(a, fallback));
  const second = detailLine(a, nowMs);
  return second ? `${first}<br>${escapeHtml(second)}` : first;
}
