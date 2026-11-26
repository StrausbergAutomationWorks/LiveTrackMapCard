/**
 * HTML escaping for text that reaches the page as markup (LiveTrackMapCard#1, backlog 368). Leaflet writes a DivIcon's
 * html, a tooltip or popup given as a string, a layers-control label and an attribution with innerHTML, and every
 * name, state and attribute this card draws can come from another integration or straight from a public feed.
 */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Text escaped for HTML: element content or a quoted attribute value, either quote. null and undefined are "".
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * A marker attribute value: exactly what a template literal would have written (undefined stays "undefined", as
 * the marker and the canvas expect), escaped.
 * @param {*} value
 * @returns {string}
 */
export function attr(value) {
  return escapeHtml(`${value}`);
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * The text an escaped attribute value stands for, as the browser reads it: the five named entities and numeric
 * ones. Anything else is left as it is.
 * @param {*} value
 * @returns {string}
 */
export function unescapeHtml(value) {
  return String(value ?? "").replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    const k = e.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : whole;
  });
}
