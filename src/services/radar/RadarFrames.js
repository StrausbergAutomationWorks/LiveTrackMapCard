/**
 * The weather radar overlay's frames (D13 "Frames"): the newest frame of each
 * source, one frame, no animation. Pure parsers and clocks; the service
 * fetches and schedules.
 *
 * A frame is {key, time, ...}: `key` is what goes in the tile URL (an ISO
 * time for WMS, a path for RainViewer, a basetime for JMA), `time` its moment
 * in epoch ms, used for the stale rule.
 */

/** A frame older than this is treated as down; its tiles fall to the next source (D13). */
export const STALE_MS = 30 * 60 * 1000;

/** How often each listed source's frame list is read (D13). */
export const POLL_MS = Object.freeze({
  rainviewer: 5 * 60 * 1000,
  jma: 5 * 60 * 1000,
  geomet: 6 * 60 * 1000,
  nowcoast: 5 * 60 * 1000,
});

/**
 * @param {*} v
 * @returns {boolean}
 */
function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * RainViewer `weather-maps.json`: the newest past frame.
 * @param {*} json
 * @returns {?{key: string, host: string, path: string, time: number}}
 */
export function parseRainViewer(json) {
  if (!isObj(json) || typeof json.host !== "string" || !/^https:\/\//.test(json.host)) return null;
  const past = isObj(json.radar) && Array.isArray(json.radar.past) ? json.radar.past : [];
  const last = past[past.length - 1];
  if (!isObj(last) || typeof last.path !== "string" || !/^\/[\w/.-]+$/.test(last.path) || !Number.isFinite(last.time)) return null;
  return { key: last.path, host: json.host, path: last.path, time: last.time * 1000 };
}

/**
 * "20261006072500" (UTC) as epoch ms; NaN when malformed.
 * @param {string} s
 * @returns {number}
 */
export function jmaTime(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/**
 * JMA `targetTimes_N1.json`: the first entry, basetime = validtime (D13).
 * @param {*} json
 * @returns {?{key: string, basetime: string, validtime: string, time: number}}
 */
export function parseJma(json) {
  if (!Array.isArray(json)) return null;
  for (const e of json) {
    if (!isObj(e)) continue;
    if (typeof e.basetime !== "string" || e.basetime !== e.validtime) continue;
    const time = jmaTime(e.basetime);
    if (!Number.isFinite(time)) continue;
    if (Array.isArray(e.elements) && !e.elements.includes("hrpns")) continue;
    return { key: e.basetime, basetime: e.basetime, validtime: e.validtime, time };
  }
  return null;
}

/**
 * An ISO time as WMS lists it ("2026-10-06T06:48:00Z", or with .000Z).
 * @param {string} s
 * @returns {number} epoch ms, NaN when malformed
 */
export function isoTime(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s)) return NaN;
  return Date.parse(s);
}

/**
 * The `time` Dimension elements of a capabilities document, each with its
 * `default` attribute.
 * @param {string} text
 * @returns {string[]} the defaults found, as written
 */
export function timeDefaults(text) {
  const out = [];
  if (typeof text !== "string") return out;
  const re = /<(?:\w+:)?Dimension\b([^>]*)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    if (!/\bname="time"/.test(attrs)) continue;
    const d = /\bdefault="([^"]+)"/.exec(attrs);
    if (d) out.push(d[1]);
  }
  return out;
}

/**
 * GeoMet's per-layer capabilities: the time Dimension's `default` is the
 * newest frame, and the ONLY kind of time it accepts is one on its grid
 * (an off-grid time answers HTTP 200 with an XML exception, D13). So the
 * listed value is used exactly as written.
 * @param {string} text
 * @returns {?{key: string, time: number}}
 */
export function parseGeoMetCaps(text) {
  for (const d of timeDefaults(text)) {
    const t = isoTime(d);
    if (Number.isFinite(t)) return { key: d, time: t };
  }
  return null;
}

/**
 * nowCOAST's capabilities. MEASURED 2026-10-06: `base_reflectivity_mosaic`
 * is a layer GROUP with no time list of its own; each of its five regional
 * sublayers carries one (`nearestValue="1"`). The newest default across them
 * is the frame; a region whose own newest is a moment older snaps to it.
 * @param {string} text
 * @returns {?{key: string, time: number}}
 */
export function parseNowCoastCaps(text) {
  let best = null;
  for (const d of timeDefaults(text)) {
    const t = isoTime(d);
    if (Number.isFinite(t) && (best === null || t > best.time)) best = { key: d, time: t };
  }
  return best;
}

/**
 * FMI and DWD: COMPUTED, never fetched (their capabilities are 425 KB and
 * 811 KB, D13). floor(now - 5 min) on the 5-minute UTC grid.
 * @param {number} now epoch ms
 * @returns {{key: string, time: number}}
 */
export function computedFiveMinute(now) {
  const step = 5 * 60 * 1000;
  const t = Math.floor((now - step) / step) * step;
  return { key: new Date(t).toISOString().replace(".000Z", "Z"), time: t };
}

/**
 * @param {?{time: number}} frame
 * @param {number} now
 * @returns {boolean} whether the frame can be drawn (present and no older than STALE_MS)
 */
export function isFresh(frame, now) {
  return !!frame && Number.isFinite(frame.time) && now - frame.time <= STALE_MS;
}
