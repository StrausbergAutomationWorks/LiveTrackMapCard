/**
 * Credits in the map's attribution box for the data the map is drawing
 * (backlog 228; Lee 2026-09-18, wording decided 2026-10-22 23:42).
 *
 * Every Live Track entity carries Home Assistant's plain-text `attribution`.
 * The box shows each distinct one ONCE, and only while an entity carrying it
 * is drawn:
 *
 *   - only the credit part, up to the first full stop; the whole string is
 *     on hover (the span's `title`);
 *   - any URL or bare domain in it becomes a link (a domain links to https).
 *
 * "Data: Renfe (data.renfe.com), CC BY 4.0, modified. This integration is not
 * sponsored by ..." shows as "Data: Renfe (data.renfe.com), CC BY 4.0,
 * modified" with data.renfe.com linked. A full stop is a "." followed by
 * white space or the end, so "4.0" and "renfe.com" are not stops.
 */

/**
 * Escape text for HTML: Leaflet's attribution control sets innerHTML.
 * @param {*} value
 * @returns {string}
 */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A URL, or a bare domain whose last label is 2 to 24 letters. */
const LINK = /\bhttps?:\/\/[^\s,;()<>"']+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\b/gi;

/** A full stop: a "." followed by white space or the end. */
const STOP = /\.(?=\s|$)/;

/**
 * The credit part and the rest, or null for anything but a non-blank string.
 * @param {*} text
 * @returns {{short: string, rest: string, full: string}|null}
 */
export function creditParts(text) {
  if (typeof text !== "string") return null;
  const full = text.trim().replace(/\s+/g, " ");
  if (!full) return null;
  const m = STOP.exec(full);
  if (!m) return { short: full, rest: "", full };
  const short = full.slice(0, m.index).trim();
  const rest = full.slice(m.index + 1).trim();
  return short ? { short, rest, full } : { short: full, rest: "", full };
}

/**
 * Text as HTML with every URL and bare domain made a link.
 * @param {string} text
 * @returns {string}
 */
export function linkify(text) {
  const s = String(text ?? "");
  let out = "";
  let at = 0;
  for (const m of s.matchAll(LINK)) {
    let word = m[0];
    const trail = /[.!?:]+$/.exec(word);           // "https://x.org." ends a sentence
    if (trail) word = word.slice(0, trail.index);
    if (!word) continue;
    const href = /^https?:\/\//i.test(word) ? word : `https://${word}`;
    out += esc(s.slice(at, m.index));
    out += `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(word)}</a>`;
    at = m.index + word.length;
  }
  return out + esc(s.slice(at));
}

/**
 * One credit as it goes in the box, or null when there is none to show.
 * @param {*} text an entity's `attribution`
 * @returns {string|null}
 */
export function creditHtml(text) {
  const p = creditParts(text);
  if (!p) return null;
  return `<span class="ltmc-credit" title="${esc(p.full)}">${linkify(p.short)}</span>`;
}
