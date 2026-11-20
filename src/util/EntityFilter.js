/**
 * `entity_filter` (Lee, 2026-11-20): the card picks its own entities, so a dashboard no longer needs
 * auto-entities around it. The syntax is auto-entities' own include / exclude form, so moving a
 * dashboard over is a paste of its `filter:` block:
 *
 *   entity_filter:
 *     include:
 *       - attributes: {source: live_track_aircraft}
 *         options: {size: 60}
 *       - domain: geo_location
 *         not: {attributes: {source: live_track_aircraft}}
 *         options: {size: 28}
 *       - domain: device_tracker
 *         has_position: true
 *         away_from_person_m: 100
 *     exclude:
 *       - state: unavailable
 *
 * Rules:
 * - An entity takes the FIRST include rule it matches, and that rule's `options`. Every key in one
 *   rule must match. An entity any exclude rule matches is left out.
 * - `domain`, `entity_id`, `state` and each `attributes` value match as text: exact, `*` as a
 *   wildcard, or `/regex/` (auto-entities' forms). A missing attribute matches nothing.
 * - `not:` holds a rule; it matches when that rule does not.
 * - `has_position: true` needs numeric `latitude` and `longitude` attributes (`false`: neither).
 * - `away_from_person_m: N` leaves out an entity a person lists in its `device_trackers` while it
 *   is within N metres of that person (who has a position): the person's own marker covers it.
 * - No sort: the list is in rule order, then by entity id. The map stacks markers by layer and
 *   screen position, never by list order, and a sort by a changing state would hand the card a
 *   new list on nearly every update.
 * - Any other rule key is refused with an error naming it, never ignored (06_MAP_CONTRACT.md
 *   D6a-ii: a silently ignored key and a broken feature look the same).
 *
 * The work is incremental: Home Assistant's frontend replaces only the state objects that changed,
 * so an entity is matched again only when its own state object changed, or, for
 * `away_from_person_m`, when a person carrying it changed. The list (and `version`) changes only
 * when an entity arrives, leaves or moves to another rule.
 */

const RULE_KEYS = Object.freeze(["domain", "entity_id", "state", "attributes", "not", "options", "has_position", "away_from_person_m"]);
const FILTER_KEYS = Object.freeze(["include", "exclude"]);

/**
 * A text matcher in auto-entities' forms: `/regex/flags`, a `*` wildcard, or the exact text.
 * Numbers and booleans are compared as their text, as a YAML value may be either.
 * @param {*} value as written
 * @param {string} where for the error
 * @returns {(s: string) => boolean}
 */
export function textMatcher(value, where) {
  if (typeof value === "number" || typeof value === "boolean") value = String(value);
  if (typeof value !== "string") throw new Error(`entity_filter: ${where} must be text, a * wildcard or a /regex/`);
  const re = /^\/(.+)\/([a-z]*)$/.exec(value);
  if (re) {
    let rx;
    try { rx = new RegExp(re[1], re[2]); } catch { throw new Error(`entity_filter: ${where} is not a valid regex: ${value}`); }
    return (s) => rx.test(s);
  }
  if (value.includes("*")) {
    const rx = new RegExp("^" + value.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return (s) => rx.test(s);
  }
  return (s) => s === value;
}

/**
 * @param {*} raw one rule as written
 * @param {string} where for errors
 * @param {boolean} withOptions whether `options` is allowed (include rules)
 * @returns {object} the compiled rule
 */
function compileRule(raw, where, withOptions) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`entity_filter: ${where} must be a mapping`);
  const rule = {};
  for (const key of Object.keys(raw)) {
    if (!RULE_KEYS.includes(key)) throw new Error(`entity_filter: ${where} has "${key}", which is not supported (supported: ${RULE_KEYS.join(", ")})`);
  }
  if (raw.domain !== undefined) rule.domain = textMatcher(raw.domain, `${where}.domain`);
  if (raw.entity_id !== undefined) rule.entityId = textMatcher(raw.entity_id, `${where}.entity_id`);
  if (raw.state !== undefined) rule.state = textMatcher(raw.state, `${where}.state`);
  if (raw.attributes !== undefined) {
    const a = raw.attributes;
    if (a == null || typeof a !== "object" || Array.isArray(a)) throw new Error(`entity_filter: ${where}.attributes must be a mapping`);
    rule.attributes = Object.keys(a).map((k) => [k, textMatcher(a[k], `${where}.attributes.${k}`)]);
  }
  if (raw.has_position !== undefined) {
    if (typeof raw.has_position !== "boolean") throw new Error(`entity_filter: ${where}.has_position must be true or false`);
    rule.hasPosition = raw.has_position;
  }
  if (raw.away_from_person_m !== undefined) {
    const m = raw.away_from_person_m;
    if (typeof m !== "number" || !Number.isFinite(m) || m <= 0) throw new Error(`entity_filter: ${where}.away_from_person_m must be a number of metres above 0`);
    rule.awayM = m;
  }
  if (raw.not !== undefined) rule.not = compileRule(raw.not, `${where}.not`, false);
  if (raw.options !== undefined) {
    if (!withOptions) throw new Error(`entity_filter: ${where} cannot have options`);
    const o = raw.options;
    if (o == null || typeof o !== "object" || Array.isArray(o)) throw new Error(`entity_filter: ${where}.options must be a mapping`);
    rule.options = o;
  } else {
    rule.options = {};
  }
  rule.usesPersons = rule.awayM !== undefined || Boolean(rule.not?.usesPersons);
  return rule;
}

/**
 * Parse `entity_filter` as written.
 * @param {*} raw
 * @returns {{include: object[], exclude: object[], usesPersons: boolean}|null} null when absent
 */
export function parseEntityFilter(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("entity_filter must be a mapping with include (and exclude)");
  for (const key of Object.keys(raw)) {
    if (!FILTER_KEYS.includes(key)) throw new Error(`entity_filter has "${key}", which is not supported (supported: ${FILTER_KEYS.join(", ")})`);
  }
  const list = (v, name) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new Error(`entity_filter.${name} must be a list of rules`);
    return v;
  };
  const include = list(raw.include, "include").map((r, i) => compileRule(r, `include[${i}]`, true));
  const exclude = list(raw.exclude, "exclude").map((r, i) => compileRule(r, `exclude[${i}]`, false));
  if (include.length === 0) throw new Error("entity_filter.include needs at least one rule");
  return { include, exclude, usesPersons: [...include, ...exclude].some((r) => r.usesPersons) };
}

/**
 * @param {object} st a state object
 * @returns {boolean} whether the state carries numeric latitude and longitude
 */
function hasPosition(st) {
  const a = st?.attributes;
  return typeof a?.latitude === "number" && Number.isFinite(a.latitude)
    && typeof a?.longitude === "number" && Number.isFinite(a.longitude);
}

/**
 * Great-circle distance in metres (haversine, mean Earth radius).
 * @param {number} lat1 degrees
 * @param {number} lon1 degrees
 * @param {number} lat2 degrees
 * @param {number} lon2 degrees
 * @returns {number}
 */
export function metresBetween(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * @param {object} rule compiled
 * @param {string} id entity id
 * @param {object} st its state object
 * @param {object} states every state
 * @param {Map<string, string[]>} carriers tracker id -> ids of the persons listing it
 * @returns {boolean}
 */
export function matchRule(rule, id, st, states, carriers) {
  if (rule.domain && !rule.domain(id.slice(0, id.indexOf(".")))) return false;
  if (rule.entityId && !rule.entityId(id)) return false;
  if (rule.state && !rule.state(String(st?.state))) return false;
  if (rule.attributes) {
    for (const [key, m] of rule.attributes) {
      const v = st?.attributes?.[key];
      if (v === undefined || v === null || !m(String(v))) return false;
    }
  }
  if (rule.hasPosition !== undefined && hasPosition(st) !== rule.hasPosition) return false;
  if (rule.awayM !== undefined && carriedWithin(id, st, rule.awayM, states, carriers)) return false;
  if (rule.not && matchRule(rule.not, id, st, states, carriers)) return false;
  return true;
}

/**
 * @param {string} id entity id
 * @param {object} st its state object
 * @param {number} m metres
 * @param {object} states every state
 * @param {Map<string, string[]>} carriers tracker id -> ids of the persons listing it
 * @returns {boolean} whether a person listing this entity, with a position, is within `m` metres of it
 */
function carriedWithin(id, st, m, states, carriers) {
  const persons = carriers?.get(id);
  if (!persons || !hasPosition(st)) return false;
  const a = st.attributes;
  for (const pid of persons) {
    const p = states[pid];
    if (!hasPosition(p)) continue;
    if (metresBetween(p.attributes.latitude, p.attributes.longitude, a.latitude, a.longitude) < m) return true;
  }
  return false;
}

export default class EntityFilter {
  /** @type {number} bumped whenever the list changes */
  version = 0;

  /**
   * @param {{include: object[], exclude: object[], usesPersons: boolean}} spec from parseEntityFilter
   */
  constructor(spec) {
    this.spec = spec;
    /** @type {Map<string, {st: object, rule: number, entry: object|null}>} */
    this._cache = new globalThis.Map();
    this._states = null;
    this._entries = [];
    this._dirtyList = true;
    /** @type {Map<string, object>} person id -> its state object when last seen */
    this._persons = new globalThis.Map();
    /** @type {Map<string, string[]>} tracker id -> persons listing it */
    this._carriers = new globalThis.Map();
  }

  /**
   * The rule index an entity takes, or -1.
   * @param {string} id entity id
   * @param {object} st its state object
   * @param {object} states every state
   * @returns {number}
   */
  _ruleFor(id, st, states) {
    for (const ex of this.spec.exclude) if (matchRule(ex, id, st, states, this._carriers)) return -1;
    const inc = this.spec.include;
    for (let i = 0; i < inc.length; i++) if (matchRule(inc[i], id, st, states, this._carriers)) return i;
    return -1;
  }

  /**
   * Persons changed? Rebuild who carries what, and return every entity whose answer may differ.
   * @param {object} states every state
   * @returns {Set<string>}
   */
  _personsChanged(states) {
    const touched = new Set();
    let changed = false;
    const seen = new Set();
    for (const id in states) {
      if (!id.startsWith("person.")) continue;
      seen.add(id);
      if (this._persons.get(id) !== states[id]) { changed = true; this._persons.set(id, states[id]); }
    }
    for (const id of [...this._persons.keys()]) if (!seen.has(id)) { changed = true; this._persons.delete(id); }
    if (!changed) return touched;
    for (const t of this._carriers.keys()) touched.add(t);
    this._carriers = new globalThis.Map();
    for (const [pid, p] of this._persons) {
      const list = p?.attributes?.device_trackers;
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        if (typeof t !== "string") continue;
        touched.add(t);
        const c = this._carriers.get(t);
        if (c) c.push(pid); else this._carriers.set(t, [pid]);
      }
    }
    return touched;
  }

  /**
   * Bring the result up to date with Home Assistant's states.
   * @param {object} states hass.states
   * @returns {boolean} whether the list changed
   */
  update(states) {
    if (!states || states === this._states) return false;
    this._states = states;
    const recheck = this.spec.usesPersons ? this._personsChanged(states) : null;
    let changed = false;
    let seen = 0;
    for (const id in states) {
      seen++;
      const st = states[id];
      const c = this._cache.get(id);
      if (c && c.st === st && !(recheck && recheck.has(id))) continue;
      const rule = this._ruleFor(id, st, states);
      if (c) {
        c.st = st;
        if (c.rule !== rule) {
          c.rule = rule;
          c.entry = rule < 0 ? null : { ...this.spec.include[rule].options, entity: id };
          changed = true;
        }
      } else {
        this._cache.set(id, { st, rule, entry: rule < 0 ? null : { ...this.spec.include[rule].options, entity: id } });
        if (rule >= 0) changed = true;
      }
    }
    if (this._cache.size > seen) {
      for (const [id, c] of this._cache) {
        if (id in states) continue;
        this._cache.delete(id);
        if (c.rule >= 0) changed = true;
      }
    }
    if (changed) { this.version++; this._dirtyList = true; }
    return changed;
  }

  /**
   * The entries, in rule order then entity id: `{...rule options, entity: id}`. An entry object
   * stays the same while its entity keeps its rule, so a caller can cache what it builds from it.
   * @returns {object[]}
   */
  entries() {
    if (this._dirtyList) {
      const list = [];
      for (const [id, c] of this._cache) if (c.rule >= 0) list.push([c.rule, id, c.entry]);
      list.sort((a, b) => (a[0] - b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
      this._entries = list.map((x) => x[2]);
      this._dirtyList = false;
    }
    return this._entries;
  }
}
