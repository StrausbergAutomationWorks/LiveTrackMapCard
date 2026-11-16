/**
 * A marker's photo and its links out (06_MAP_CONTRACT.md D4g, backlog 346): the photo in the hover box, and on a
 * click a popup with the photo, its credit and licence, the links, and "Details" for Home Assistant's own dialog.
 *
 * Nothing an integration sends is read as HTML: every text is escaped, and only https URLs are used. A photo is
 * drawn only with its credit beside it (the licences Commons photos carry ask for it; a ShipSpotting thumbnail,
 * if that comes, requires it).
 */
import { escapeHtml } from "./InfoPopup.js";

export const PHOTO_WIDTH_HOVER = 160;
export const PHOTO_WIDTH_POPUP = 280;
export const LINKS_MAX = 4;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const https = (v) => (typeof v === "string" && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : null);
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v) => (Number.isInteger(v) && v > 0 && v < 10000 ? v : null);

/**
 * `marker_photo` -> a checked photo, or null. Needs an https `url` (the thumbnail), an https `page` (the photo's
 * own page) and a `credit`; `licence`, `licence_url`, `source`, `width`, `height` are optional.
 * @param {*} v
 * @returns {?{url: string, page: string, credit: string, licence: ?string, licence_url: ?string, source: ?string, width: ?number, height: ?number}}
 */
export function photoOf(v) {
  if (!isObj(v)) return null;
  const url = https(v.url), page = https(v.page), credit = str(v.credit, 120);
  if (!url || !page || !credit) return null;
  return {
    url, page, credit,
    licence: str(v.licence, 60),
    licence_url: https(v.licence_url),
    source: str(v.source, 60),
    width: int(v.width),
    height: int(v.height),
  };
}

/**
 * `marker_links` -> up to LINKS_MAX checked links, each an https `url` with a `label`.
 * @param {*} v
 * @returns {{label: string, url: string}[]}
 */
export function linksOf(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const l of v) {
    const url = https(l?.url), label = str(l?.label, 40);
    if (url && label) out.push({ label, url });
    if (out.length === LINKS_MAX) break;
  }
  return out;
}

/**
 * The credit line as text: "Photo: Solomon203, CC BY-SA 4.0, Wikimedia Commons".
 * @param {object} p a checked photo
 * @returns {string}
 */
export function creditText(p) {
  return ["Photo: " + p.credit, p.licence, p.source].filter(Boolean).join(", ");
}

/**
 * @param {object} p
 * @param {number} width
 * @returns {string} width and height attributes keeping the photo's proportions
 */
function size(p, width) {
  const h = p.width && p.height ? Math.round((p.height * width) / p.width) : null;
  return `width="${width}"${h ? ` height="${h}"` : ""}`;
}

/**
 * The hover box's photo: the thumbnail and its credit, both escaped. Empty without a photo.
 * @param {object} attrs
 * @returns {string}
 */
export function hoverPhotoHtml(attrs) {
  const p = photoOf(attrs?.marker_photo);
  if (!p) return "";
  return `<div class="hover-photo"><img src="${escapeHtml(p.url)}" ${size(p, PHOTO_WIDTH_HOVER)} alt="" `
    + `referrerpolicy="no-referrer"><div class="hover-credit">${escapeHtml(creditText(p))}</div></div>`;
}

/**
 * Does this marker carry a photo or a link? (Entity also opens the popup for D4e's `marker_info`.)
 * @param {object} attrs
 * @returns {boolean}
 */
export function hasExtras(attrs) {
  return photoOf(attrs?.marker_photo) !== null || linksOf(attrs?.marker_links).length > 0;
}

/**
 * The click popup's photo, credit and links, escaped; "Details" is a button the card wires to the entity dialog.
 * @param {object} attrs
 * @param {string} [title] the marker's name, plain text, as the hover box's first line; none when D4e's text heads it
 * @returns {string}
 */
export function extrasHtml(attrs, title) {
  const p = photoOf(attrs?.marker_photo);
  const links = linksOf(attrs?.marker_links);
  let html = typeof title === "string" && title.trim() ? `<div class="ltmc-title">${escapeHtml(title.trim())}</div>` : "";
  if (p) {
    const lic = p.licence
      ? (p.licence_url ? `<a href="${escapeHtml(p.licence_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.licence)}</a>` : escapeHtml(p.licence))
      : "";
    html += `<a class="ltmc-photo" href="${escapeHtml(p.page)}" target="_blank" rel="noopener noreferrer">`
      + `<img src="${escapeHtml(p.url)}" ${size(p, PHOTO_WIDTH_POPUP)} alt="" referrerpolicy="no-referrer"></a>`
      + `<div class="ltmc-credit">Photo: <a href="${escapeHtml(p.page)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.credit)}</a>`
      + (lic ? `, ${lic}` : "") + (p.source ? `, ${escapeHtml(p.source)}` : "") + `</div>`;
  }
  if (links.length) {
    html += `<div class="ltmc-links">` + links.map((l) =>
      `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a>`).join(" · ") + `</div>`;
  }
  html += `<div class="ltmc-details"><button type="button" class="ltmc-details-button">Details</button></div>`;
  return `<div class="ltmc-extras">${html}</div>`;
}
