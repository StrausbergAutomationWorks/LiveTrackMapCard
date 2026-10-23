/**
 * The weather radar overlay's frames (D13 "Frames"): the newest frame of each
 * source, and (backlog 285, D13 "Motion") the source's whole list on it as
 * `list`, oldest first, for the 30-minute loop. The list comes from the SAME
 * answer: nothing more is fetched for it. Pure parsers and clocks; the
 * service fetches and schedules.
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
  const list = past
    .filter((p) => isObj(p) && typeof p.path === "string" && /^\/[\w/.-]+$/.test(p.path) && Number.isFinite(p.time))
    .map((p) => ({ key: p.path, host: json.host, path: p.path, time: p.time * 1000 }))
    .sort((a, b) => a.time - b.time);
  return { key: last.path, host: json.host, path: last.path, time: last.time * 1000, list };
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
  const list = [];
  for (const e of json) {
    if (!isObj(e)) continue;
    if (typeof e.basetime !== "string" || e.basetime !== e.validtime) continue;
    const time = jmaTime(e.basetime);
    if (!Number.isFinite(time)) continue;
    if (Array.isArray(e.elements) && !e.elements.includes("hrpns")) continue;
    if (!list.some((f) => f.key === e.basetime)) list.push({ key: e.basetime, basetime: e.basetime, validtime: e.validtime, time });
  }
  if (!list.length) return null;
  const first = list[0];
  list.sort((a, b) => a.time - b.time);
  return { ...first, list };
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

/** A WMS time list is never expanded past this many frames. */
export const MAX_LIST = 500;

/**
 * An ISO 8601 duration of hours, minutes and seconds ("PT6M", "PT1H30M") in ms; NaN otherwise.
 * @param {string} s
 * @returns {number}
 */
export function isoDurationMs(s) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(s));
  if (!m || (!m[1] && !m[2] && !m[3])) return NaN;
  return ((+(m[1] ?? 0) * 60 + +(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 1000;
}

/**
 * A WMS time Dimension's values as frames, oldest first: a comma list, each
 * item a time or a `start/end/period` interval. A listed time is kept
 * EXACTLY as written (D13: request exactly a listed time); an interval's
 * times are written as its start is (with or without fractions).
 * @param {string} body the Dimension's text
 * @returns {{key: string, time: number}[]}
 */
export function wmsTimeList(body) {
  const out = [];
  if (typeof body !== "string") return out;
  for (const raw of body.split(",")) {
    const item = raw.trim();
    if (!item) continue;
    const parts = item.split("/");
    if (parts.length === 1) {
      const t = isoTime(item);
      if (Number.isFinite(t)) out.push({ key: item, time: t });
    } else if (parts.length === 3) {
      const a = isoTime(parts[0]);
      const z = isoTime(parts[1]);
      const step = isoDurationMs(parts[2]);
      if (!Number.isFinite(a) || !Number.isFinite(z) || !(step > 0) || z < a) continue;
      const frac = /\.\d+Z$/.test(parts[0]);
      const first = Math.max(a, z - (MAX_LIST - 1) * step);
      for (let t = a + Math.ceil((first - a) / step) * step; t <= z; t += step) {
        const iso = new Date(t).toISOString();
        out.push({ key: frac ? iso : iso.replace(/\.\d+Z$/, "Z"), time: t });
      }
    }
    if (out.length > 4 * MAX_LIST) break;
  }
  const seen = new Set();
  return out.sort((x, y) => x.time - y.time).filter((f) => !seen.has(f.time) && seen.add(f.time)).slice(-MAX_LIST);
}

/**
 * The `time` Dimensions of a capabilities document: each one's `default`
 * and its values text.
 * @param {string} text
 * @returns {{default: ?string, values: string}[]}
 */
export function timeDimensions(text) {
  const out = [];
  if (typeof text !== "string") return out;
  const re = /<(?:\w+:)?Dimension\b([^>]*)>([^<]*)</g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!/\bname="time"/.test(m[1])) continue;
    const d = /\bdefault="([^"]+)"/.exec(m[1]);
    out.push({ default: d ? d[1] : null, values: m[2] });
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
  for (const dim of timeDimensions(text)) {
    const t = isoTime(dim.default);
    if (!Number.isFinite(t)) continue;
    const list = wmsTimeList(dim.values).filter((f) => f.time <= t);
    return { key: dim.default, time: t, list: list.length ? list : [{ key: dim.default, time: t }] };
  }
  return null;
}

/**
 * nowCOAST's capabilities, per REGIONAL layer (D13, backlog 285): the group
 * `base_reflectivity_mosaic` has no time list; each regional layer
 * (`conus_base_reflectivity_mosaic`, ...) carries its own, and the regions'
 * newest times differ by seconds. MEASURED 2026-10-23: each layer's `<Name>`
 * is followed by its time Dimension before the next `<Name>` (a style's).
 * Each regional layer is requested as itself at its own `default`.
 * @param {string} text
 * @returns {Map<string, {key: string, time: number}>} frame by layer name; empty when none
 */
export function parseNowCoastRegions(text) {
  const out = new Map();
  if (typeof text !== "string") return out;
  const names = [...text.matchAll(/<Name>([^<]+)<\/Name>/g)];
  for (let k = 0; k < names.length; k++) {
    const name = names[k][1].trim();
    if (!/^[a-z]+_base_reflectivity_mosaic$/.test(name)) continue;
    const end = k + 1 < names.length ? names[k + 1].index : text.length;
    const dim = timeDimensions(text.slice(names[k].index, end))[0];
    const d = dim?.default;
    const t = isoTime(d);
    if (!Number.isFinite(t) || out.has(name)) continue;
    const list = wmsTimeList(dim.values).filter((f) => f.time <= t);
    out.set(name, { key: d, time: t, list: list.length ? list : [{ key: d, time: t }] });
  }
  return out;
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
 * FMI and DWD's frames back from the computed newest, oldest first. Never
 * one after it (D13: DWD answered an image for a time past its newest).
 * @param {number} now epoch ms
 * @param {number} [count]
 * @returns {{key: string, time: number}[]}
 */
export function computedList(now, count = 13) {
  const newest = computedFiveMinute(now);
  const out = [];
  for (let k = count - 1; k >= 0; k--) {
    const t = newest.time - k * 5 * 60 * 1000;
    out.push({ key: new Date(t).toISOString().replace(".000Z", "Z"), time: t });
  }
  return out;
}

/**
 * @param {?{time: number}} frame
 * @param {number} now
 * @returns {boolean} whether the frame can be drawn (present and no older than STALE_MS)
 */
export function isFresh(frame, now) {
  return !!frame && Number.isFinite(frame.time) && now - frame.time <= STALE_MS;
}
