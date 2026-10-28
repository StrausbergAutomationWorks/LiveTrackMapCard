/**
 * A clicked object's text in a Leaflet popup: shapes carrying `info` (06_MAP_CONTRACT_OVERLAYS.md D12 as amended
 * for Live Track Weather item 310) and markers carrying `marker_info` (06_MAP_CONTRACT.md D4e). Plain text only:
 * nothing a publisher sends is read as HTML.
 */

/**
 * @param {*} v
 * @returns {boolean} a plain object, not an array or null
 */
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The longest title and text an `info` may show; longer is cut. */
export const INFO_TITLE_MAX = 200;
export const INFO_TEXT_MAX = 4000;

/**
 * A shape's `info` (D12 as amended for item 310): plain-text `title` and `text`, either may be absent but not
 * both. Anything else is no info, and the shape stays non-interactive.
 * @param {*} info
 * @returns {?{title: string, text: string}}
 */
export function infoOf(info) {
  if (!isPlainObject(info)) return null;
  const s = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const title = s(info.title, INFO_TITLE_MAX);
  const text = s(info.text, INFO_TEXT_MAX);
  return title || text ? { title, text } : null;
}

/**
 * @param {string} s
 * @returns {string} s with HTML's special characters escaped
 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * The popup for a clicked shape: the title in bold, the text's lines as lines. Never HTML from the publisher.
 * @param {{title: string, text: string}} info
 * @returns {string}
 */
export function infoHtml(info) {
  const title = info.title ? `<b>${escapeHtml(info.title)}</b>` : "";
  const text = info.text ? escapeHtml(info.text).replace(/\n/g, "<br>") : "";
  return `<div class="ltmc-shape-info">${title}${title && text ? "<br>" : ""}${text}</div>`;
}

/** A clicked shape's popup: Leaflet options. */
export const INFO_POPUP = Object.freeze({ maxWidth: 360, maxHeight: 320, autoPanPadding: [16, 16] });

