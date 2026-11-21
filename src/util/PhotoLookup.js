/**
 * A marker's photo, looked up when the viewer first hovers it (06_MAP_CONTRACT.md D4i `marker_photo_lookup`,
 * backlog 361).
 *
 * The integration does not hold the photo; it publishes WHERE to ask, a path under `/api/` (D4h's rule), and the
 * card asks it once with the viewer's own sign-in (hass.callApi) the first time the hover box opens. The answer is
 * `{photo: <D4g marker_photo> | null}`; a photo then draws and links exactly as D4g. Answers are kept for the page,
 * at most LOOKUP_KEEP_MS, 12 h: an integration may keep its own answer 12 h too, so what a viewer sees is never
 * older than the 24 h a source such as Planespotters allows. A failed ask is tried again after LOOKUP_RETRY_MS.
 * One cache for every marker on the page, so two cards asking for one aircraft ask once.
 */
import { trackOf, apiPath } from "./TrackLine.js";
import { photoOf } from "./MarkerExtras.js";

export const LOOKUP_KEEP_MS = 12 * 3600 * 1000;
export const LOOKUP_RETRY_MS = 5 * 60 * 1000;
export const LOOKUP_MAX = 2000;

/** path -> {at: epoch ms, photo: ?object, failed: boolean} or {pending: Promise} */
const cache = new Map();

/**
 * `marker_photo_lookup` -> the API path, or null (the same rule as D4h's `marker_track`).
 * @param {*} v
 * @returns {?string}
 */
export function lookupOf(v) {
  return trackOf(v);
}

/**
 * The photo already looked up for this path: a checked photo, null when the answer was "none", undefined when
 * nothing usable is held (never asked, asking, failed, or too old).
 * @param {string} path a checked lookup path
 * @param {number} [now]
 * @returns {?object|undefined}
 */
export function lookedUp(path, now = Date.now()) {
  const e = cache.get(path);
  if (!e || e.pending || e.failed || now - e.at > LOOKUP_KEEP_MS) return undefined;
  return e.photo;
}

/**
 * Ask for this path unless an answer is held, an ask is in flight, or a failure is under LOOKUP_RETRY_MS old.
 * @param {object} hass Home Assistant's object, with callApi
 * @param {string} path a checked lookup path
 * @param {number} [now]
 * @returns {?Promise<boolean>} resolves true when a usable answer (photo or none) arrived; null when nothing was asked
 */
export function askPhoto(hass, path, now = Date.now()) {
  if (typeof hass?.callApi !== "function") return null;
  const e = cache.get(path);
  if (e?.pending) return null;
  if (e && !e.failed && now - e.at <= LOOKUP_KEEP_MS) return null;
  if (e?.failed && now - e.at < LOOKUP_RETRY_MS) return null;
  const pending = (async () => {
    try {
      const answer = await hass.callApi("GET", apiPath(path));
      remember(path, { at: Date.now(), photo: photoOf(answer?.photo), failed: false });
      return true;
    } catch {
      remember(path, { at: Date.now(), photo: null, failed: true });
      return false;
    }
  })();
  cache.set(path, { pending });
  return pending;
}

/**
 * @param {string} path
 * @param {object} entry
 */
function remember(path, entry) {
  cache.delete(path);
  cache.set(path, entry);
  while (cache.size > LOOKUP_MAX) cache.delete(cache.keys().next().value);
}

/** Tests only: forget every answer. */
export function resetLookups() {
  cache.clear();
}
