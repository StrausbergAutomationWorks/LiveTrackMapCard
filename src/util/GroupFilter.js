/**
 * Which marker groups a viewer has hidden (06_MAP_CONTRACT.md D4f, backlog 345).
 *
 * An integration names a marker's group in `marker_group` (a short key such
 * as `cargo`); the key that is hidden is `<source>:<marker_group>`, so two
 * integrations may use the same word for different things. The choice is a
 * viewer's, kept in THIS browser's localStorage (Lee 2026-11-15: remembered
 * per browser), made in the filter card on another view of the dashboard and
 * read by the map card. Storage can be missing, full or refused (a private
 * window, a sandboxed frame): every read and write is guarded, and with no
 * storage nothing is hidden.
 *
 * Two pages of one browser learn of a change by the `storage` event; the same
 * page does not get that event, so a write also dispatches GROUPS_EVENT.
 */

export const STORAGE_KEY = "live-track-map-card:hidden-groups";
export const GROUPS_EVENT = "live-track-map-card-groups";

/**
 * @param {object|undefined} attrs an entity's attributes
 * @returns {string|null} `<source>:<marker_group>`, or null when the entity names no group
 */
export function groupKey(attrs) {
  const source = attrs?.source;
  const group = attrs?.marker_group;
  if (typeof source !== "string" || !source || typeof group !== "string" || !group) return null;
  return `${source}:${group}`;
}

/**
 * @param {Window} win
 * @returns {Storage|null} its localStorage, or null when there is none or reading it throws
 */
function storageOf(win) {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;   // reading localStorage itself can throw (sandboxed frame)
  }
}

/**
 * @param {Window} [win]
 * @returns {Set<string>} the hidden keys, empty when nothing is stored or storage fails
 */
export function readHidden(win = globalThis.window) {
  try {
    const raw = storageOf(win)?.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * Store the hidden keys and tell this page.
 * @param {string[]|Set<string>} keys
 * @param {Window} [win]
 * @returns {boolean} whether it was stored
 */
export function writeHidden(keys, win = globalThis.window) {
  const list = [...new Set(keys)].sort();
  let stored = false;
  try {
    const st = storageOf(win);
    if (st) {
      // ⚠ "Show everything" is stored as [] and not as no key: it is a
      // choice, and a filter card's start_hidden must not undo it.
      st.setItem(STORAGE_KEY, JSON.stringify(list));
      stored = true;
    }
  } catch {
    stored = false;
  }
  try {
    win?.dispatchEvent(new CustomEvent(GROUPS_EVENT, { detail: { hidden: list } }));
  } catch { /* never stops the caller */ }
  return stored;
}

/**
 * Has a choice ever been stored in this browser? ("show everything" is stored as [], so it counts)
 * @param {Window} [win]
 * @returns {boolean}
 */
export function hasStoredChoice(win = globalThis.window) {
  try {
    return storageOf(win)?.getItem(STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

/** The map card's view of the choice: answers `hides(attrs)` and follows changes. */
export class GroupFilter {
  /**
   * @param {() => void} [onChange] called after the hidden set changed
   * @param {Window} [win]
   */
  constructor(onChange = () => {}, win = globalThis.window) {
    this.win = win;
    this.onChange = onChange;
    this.hidden = readHidden(win);
    this._onEvent = (e) => {
      if (e?.type === "storage" && e.key !== STORAGE_KEY && e.key !== null) return;
      const next = readHidden(this.win);
      if (next.size === this.hidden.size && [...next].every((k) => this.hidden.has(k))) return;
      this.hidden = next;
      try { this.onChange(); } catch { /* the map draws on its next update anyway */ }
    };
    try {
      win?.addEventListener("storage", this._onEvent);
      win?.addEventListener(GROUPS_EVENT, this._onEvent);
    } catch { /* no window: nothing to follow */ }
  }

  /**
   * @param {object|undefined} attrs
   * @returns {boolean} whether the viewer hid this entity's group
   */
  hides(attrs) {
    if (!this.hidden.size) return false;
    const key = groupKey(attrs);
    return key !== null && this.hidden.has(key);
  }

  dispose() {
    try {
      this.win?.removeEventListener("storage", this._onEvent);
      this.win?.removeEventListener(GROUPS_EVENT, this._onEvent);
    } catch { /* nothing to remove */ }
  }
}

/**
 * `live_track_ships` -> "Live Track Ships"; `type_unknown` -> "Type unknown".
 * @param {string} s
 * @returns {string}
 */
export function prettify(s) {
  const words = String(s ?? "").split(/[_\s]+/).filter(Boolean);
  if (/^live_track_/.test(String(s))) return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  const t = words.join(" ");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

/**
 * What the filter card lists: every group a `geo_location` entity names now
 * (not unavailable), counted, plus every hidden group with nothing on the map
 * (count 0, so it can be shown again). By source, then by the integration's
 * `marker_group_order`, then by label; groups with no order go last.
 * @param {object} states hass.states
 * @param {Set<string>} hidden
 * @param {string[]|null} [sources] only these sources
 * @returns {{source: string, title: string, groups: {key: string, group: string, label: string, order: number, count: number}[]}[]}
 */
export function summarize(states, hidden, sources = null) {
  const wanted = Array.isArray(sources) ? new Set(sources) : null;
  const bySource = new globalThis.Map();
  const add = (source, group, label, order, n) => {
    if (wanted && !wanted.has(source)) return;
    if (!bySource.has(source)) bySource.set(source, new globalThis.Map());
    const groups = bySource.get(source);
    const g = groups.get(group) ?? { key: `${source}:${group}`, group, label: label || prettify(group), order, count: 0 };
    if (label && g.label === prettify(group)) g.label = label;
    if (Number.isFinite(order) && !Number.isFinite(g.order)) g.order = order;
    g.count += n;
    groups.set(group, g);
  };
  for (const [id, st] of Object.entries(states ?? {})) {
    if (!id.startsWith("geo_location.")) continue;
    const a = st?.attributes;
    if (!groupKey(a) || st.state === "unavailable") continue;
    const order = a.marker_group_order == null ? NaN : Number(a.marker_group_order);
    add(a.source, a.marker_group, typeof a.marker_group_label === "string" ? a.marker_group_label : "", order, 1);
  }
  for (const key of hidden ?? []) {
    const i = key.indexOf(":");
    if (i > 0) add(key.slice(0, i), key.slice(i + 1), "", NaN, 0);
  }
  const rank = (g) => (Number.isFinite(g.order) ? g.order : Number.MAX_SAFE_INTEGER);
  return [...bySource.entries()]
    .map(([source, groups]) => ({
      source,
      title: prettify(source),
      groups: [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The hidden set after hiding or showing some keys.
 * @param {Set<string>} hidden
 * @param {string[]} keys
 * @param {boolean} hide
 * @returns {Set<string>}
 */
export function toggled(hidden, keys, hide) {
  const next = new Set(hidden);
  for (const k of keys) hide ? next.add(k) : next.delete(k);
  return next;
}

/**
 * The filter card's `start_hidden`, applied only in a browser that never chose.
 * @param {unknown} start
 * @param {Window} [win]
 * @returns {boolean} whether it was applied
 */
export function applyStartHidden(start, win = globalThis.window) {
  const keys = (Array.isArray(start) ? start : []).filter((k) => typeof k === "string" && k.indexOf(":") > 0);
  if (!keys.length || hasStoredChoice(win)) return false;
  return writeHidden(keys, win);
}
