/**
 * The next-station line under a marker's hover label.
 *
 * Emitters publish `next_stop` (a station name) and `arrival_estimated_at`
 * (ISO 8601 with an offset). The words are the card's: integrations emit
 * physics, the card writes display (06_MAP_CONTRACT.md D4). Lee, 2026-10-02:
 * "Irving Park in 4 min"; under one minute, "Arriving Irving Park".
 */

/** How often an OPEN hover label is redrawn, ms. */
export const NEXT_STOP_REFRESH_MS = 5000;

/**
 * Escape text for HTML. A Leaflet tooltip given a string sets innerHTML,
 * and a station name is feed text.
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
 * The plain-text line, or null when there is nothing to say: either
 * attribute missing, a blank name, or a time that does not parse.
 * @param {object} attributes the entity's attributes
 * @param {number} nowMs epoch milliseconds
 * @returns {string|null}
 */
export function nextStopLine(attributes, nowMs) {
  const name = attributes?.next_stop;
  const eta = attributes?.arrival_estimated_at;
  if (typeof name !== "string" || typeof eta !== "string") return null;
  const station = name.trim();
  if (!station) return null;
  const etaMs = Date.parse(eta);
  if (!Number.isFinite(etaMs) || !Number.isFinite(nowMs)) return null;
  const n = Math.round((etaMs - nowMs) / 60000);
  if (n < 1) return `Arriving ${station}`;
  return `${station} in ${minutesText(n)}`;
}
