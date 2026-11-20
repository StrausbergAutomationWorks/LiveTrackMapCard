// The overview beside the map: People, Devices and Zones (step 2, Lee 2026-11-19).
//
// The rules Home Assistant's own map card applies, rewritten from its source:
// home-assistant/frontend @ 4d8eca2229633c545926fd0a1cec32f35768949d,
// src/panels/lovelace/cards/map/hui-map-overview.ts and map-activity.ts,
// src/panels/lovelace/cards/hui-map-card.ts, src/components/ha-snap-bottom-sheet.ts,
// src/common/util/select-unit.ts and swipe-gesture-recognizer.ts, src/common/map/navigation-url.ts
// (Apache-2.0; the notice is in THIRD_PARTY_NOTICES.md). Pure functions only: the panel is
// LtmcMapOverview.js, the map side PresenceRenderService.js and MapCard.js.
import { domainOf, HOME_ZONE, locationOf } from "./PresenceRules.js";

/** The tabs, in HA's order. */
export const TABS = Object.freeze(["people", "devices", "zones"]);
/** The activity window, hours. */
export const ACTIVITY_HOURS = 24;
/** At most this many activity lines. */
export const ACTIVITY_MAX_ENTRIES = 20;
/** Shown before "Show more". */
export const ACTIVITY_INITIAL_ENTRIES = 5;
/** A focus zooms in no further than this. */
export const FOCUS_MAX_ZOOM = 17;
/** ... and only as far as clears the nearest other marker by this many pixels. */
export const FOCUS_CLEARANCE_PX = 80;
/** Margin around the panel, px (--ha-space-3). */
export const OVERVIEW_GAP = 12;
/** The floating panel's width, px; with a single tab, narrower. */
export const OVERVIEW_WIDTH = 360;
export const OVERVIEW_SINGLE_TAB_WIDTH = 300;
/** At or under this width the panel is a bottom sheet. */
export const PHONE_MAX_WIDTH = 600;
/** A selected marker's frame is this much larger. */
export const SELECTED_MARKER_SCALE = 1.25;
/** Accuracy circle radius, metres, for a selected marker that reports none. */
export const NOMINAL_ACCURACY = 2.5;
/** What can be selected. */
export const SELECTABLE_DOMAINS = Object.freeze(["person", "device_tracker", "zone"]);
/** The URL search parameter that holds the selection. */
export const SELECTED_PARAM = "entity_id";
/** The bottom sheet's half stop, share of the viewport height. */
export const HALF_VIEWPORT_SHARE = 0.5;
/** A swipe: faster than this, px/ms, with a move in the last MOVEMENT_TIME_MS. */
export const SWIPE_VELOCITY = 0.5;
export const MOVEMENT_TIME_MS = 100;
/** A touch moves this far before its direction decides what it drags. */
export const TOUCH_SLOP_PX = 4;

const NO_LOCATION_STATES = ["unavailable", "unknown"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * A person's state changes inside the window, newest first; no-location samples are skipped so a
 * dropout is not an event, and the first sample (the state at the window's start) is not one either.
 * @param {Array<{s: string, a?: object, lu: number}>|undefined} history compressed history, oldest first
 * @param {number} since window start, ms
 * @returns {Array<{state: string, inZones?: string[], when: Date}>}
 */
export function personActivity(history, since) {
  const entries = [];
  let previous;
  for (const entry of history ?? []) {
    if (NO_LOCATION_STATES.includes(entry.s)) continue;
    const changed = entry.s !== previous;
    previous = entry.s;
    if (!changed || entry.lu * 1000 < since) continue;
    entries.push({ state: entry.s, inZones: entry.a?.in_zones, when: new Date(entry.lu * 1000) });
  }
  return entries.reverse().slice(0, ACTIVITY_MAX_ENTRIES);
}

/**
 * Arrivals at and departures from a zone by the given persons, newest first.
 * @param {{[entityId: string]: Array<{s: string, a?: object, lu: number}>}|undefined} history
 * @param {string[]} personIds
 * @param {string} zoneId
 * @param {number} since window start, ms
 * @returns {Array<{state: string, personId: string, arrived: boolean, when: Date}>}
 */
export function zoneActivity(history, personIds, zoneId, since) {
  const entries = [];
  for (const personId of personIds) {
    let wasInZone;
    for (const entry of history?.[personId] ?? []) {
      if (NO_LOCATION_STATES.includes(entry.s)) continue;
      const inZone = entry.a?.in_zones?.includes(zoneId) ?? false;
      // The first sample is an event only if it is an in-window arrival.
      const isEvent = wasInZone === undefined ? inZone : inZone !== wasInZone;
      if (isEvent && entry.lu * 1000 >= since) {
        entries.push({ state: entry.s, personId, arrived: inZone, when: new Date(entry.lu * 1000) });
      }
      wasInZone = inZone;
    }
  }
  entries.sort((a, b) => b.when.getTime() - a.when.getTime());
  return entries.slice(0, ACTIVITY_MAX_ENTRIES);
}

/**
 * An entity's display name: the dashboard's `name`, else Home Assistant's formatted name, else
 * its friendly_name, else the object id with spaces.
 * @param {object} stateObj
 * @param {Map<string, string>} [configured] dashboard names by entity id
 * @param {object} [hass]
 * @returns {string}
 */
export function entityName(stateObj, configured, hass) {
  const id = stateObj?.entity_id ?? "";
  const own = configured?.get(id);
  if (own) return own;
  try {
    const f = hass?.formatEntityName?.(stateObj);
    if (typeof f === "string" && f !== "") return f;
  } catch { /* an older Home Assistant */ }
  return stateObj?.attributes?.friendly_name ?? id.split(".").slice(1).join(".").replace(/_/g, " ");
}

/**
 * Is this the viewer's own person?
 * @param {object} stateObj
 * @param {{id?: string}|undefined} user hass.user
 * @returns {boolean}
 */
export const isMe = (stateObj, user) =>
  Boolean(user?.id) && domainOf(stateObj?.entity_id) === "person" && stateObj.attributes?.user_id === user.id;

const byName = (name, locale) => (a, b) => name(a).localeCompare(name(b), locale);

/**
 * The People tab: the viewer first, then those with a location, then by name.
 * @param {string[]} ids the map's person and tracker ids
 * @param {object} states hass.states
 * @param {{user?: object, name: (s: object) => string, locale?: string}} o
 * @returns {object[]} state objects
 */
export function peopleOf(ids, states, { user, name, locale }) {
  return ids.map((id) => states?.[id]).filter((s) => s && domainOf(s.entity_id) === "person").sort((a, b) => {
    const aMe = isMe(a, user);
    if (aMe !== isMe(b, user)) return aMe ? -1 : 1;
    const aLoc = Boolean(locationOf(a, states)), bLoc = Boolean(locationOf(b, states));
    if (aLoc !== bLoc) return aLoc ? -1 : 1;
    return byName(name, locale)(a, b);
  });
}

/**
 * The Devices tab: trackers with a location, by name.
 * @param {string[]} ids
 * @param {object} states
 * @param {{name: (s: object) => string, locale?: string}} o
 * @returns {object[]}
 */
export function devicesOf(ids, states, { name, locale }) {
  return ids.map((id) => states?.[id])
    .filter((s) => s && domainOf(s.entity_id) === "device_tracker" && locationOf(s, states))
    .sort(byName(name, locale));
}

/**
 * The Zones tab: every non-passive zone with a position (the card draws them all), Home first, then by name.
 * @param {object} states
 * @param {{name: (s: object) => string, locale?: string}} o
 * @returns {object[]}
 */
export function zonesOf(states, { name, locale }) {
  return Object.values(states ?? {})
    .filter((s) => domainOf(s?.entity_id) === "zone" && !s.attributes?.passive && isNum(s.attributes?.latitude) && isNum(s.attributes?.longitude))
    .sort((a, b) => {
      if ((a.entity_id === HOME_ZONE) !== (b.entity_id === HOME_ZONE)) return a.entity_id === HOME_ZONE ? -1 : 1;
      return byName(name, locale)(a, b);
    });
}

/**
 * The tabs that have something, in order, each with its items.
 * @param {object[]} people
 * @param {object[]} devices
 * @param {object[]} zones
 * @returns {Array<[string, object[]]>}
 */
export const tabsWithItems = (people, devices, zones) =>
  [["people", people], ["devices", devices], ["zones", zones]].filter(([, items]) => items.length > 0);

/**
 * The tab shown: the one asked for if it has items, else the first that does.
 * @param {string} tab
 * @param {Array<[string, object[]]>} tabs
 * @returns {string|undefined}
 */
export const shownTab = (tab, tabs) => (tabs.some(([t]) => t === tab) ? tab : tabs[0]?.[0]);

/**
 * Does the tab hide this marker? People hides trackers, Devices hides persons; the selection and
 * every other domain are never hidden.
 * @param {string} id
 * @param {string} tab
 * @param {string|undefined} selected
 * @returns {boolean}
 */
export function hiddenByTab(id, tab, selected) {
  if (id === selected) return false;
  const d = domainOf(id);
  if (d === "person") return tab !== "people";
  if (d === "device_tracker") return tab !== "devices";
  return false;
}

/**
 * With the overview shown, a zone's radius is drawn when selected, or on the Zones tab.
 * @param {string} zoneId
 * @param {string|undefined} selected
 * @param {string} tab
 * @returns {boolean}
 */
export const showsRadius = (zoneId, selected, tab) => tab === "zones" || zoneId === selected;

/**
 * The accuracy circle's radius for a marker; 0 = none. Without the overview, every free pin that
 * reports one (step 1); with it, only the selection, which gets NOMINAL_ACCURACY if it reports none.
 * @param {number} gpsAccuracy
 * @param {boolean} selected
 * @param {boolean} overview
 * @returns {number}
 */
export function accuracyShown(gpsAccuracy, selected, overview) {
  const acc = isNum(gpsAccuracy) && gpsAccuracy > 0 ? gpsAccuracy : 0;
  if (!overview) return acc;
  return selected ? acc || NOMINAL_ACCURACY : 0;
}

/**
 * Zoom in only as far as it takes to clear the nearest other marker, never out, never past FOCUS_MAX_ZOOM.
 * @param {number} zoom the current zoom
 * @param {number} nearestPx the nearest other marker's distance at that zoom, px (Infinity: none)
 * @returns {number}
 */
export function focusZoom(zoom, nearestPx) {
  return Math.max(zoom, Math.min(FOCUS_MAX_ZOOM, zoom + Math.log2(FOCUS_CLEARANCE_PX / nearestPx)));
}

/**
 * The map padding the panel takes, so a fitted marker lands beside it, not under it.
 * @param {boolean} phone
 * @param {number} size phone: the sheet's half height; else the panel's width
 * @param {boolean} [rtl]
 * @returns {{left?: number, right?: number, bottom?: number}|undefined}
 */
export function overviewPadding(phone, size, rtl = false) {
  if (!size) return undefined;
  if (phone) return { bottom: size + OVERVIEW_GAP };
  const side = size + 2 * OVERVIEW_GAP;
  return rtl ? { right: side } : { left: side };
}

/**
 * A directions link: Apple Maps on iOS, a geo: link on Android, OpenStreetMap elsewhere.
 * @param {number} lat
 * @param {number} lng
 * @param {{userAgent?: string, maxTouchPoints?: number}} [nav]
 * @returns {string}
 */
export function navigationUrl(lat, lng, nav = globalThis.navigator ?? {}) {
  const point = `${lat},${lng}`;
  const ua = nav.userAgent ?? "";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) {
    return `https://maps.apple.com/?daddr=${point}`;
  }
  if (/android/i.test(ua)) return `geo:${point}?q=${point}`;
  return `https://www.openstreetmap.org/directions?to=${encodeURIComponent(point)}#map=15/${lat}/${lng}`;
}

/**
 * The state a tracker in this zone reports: "home" for Home, else the zone's name.
 * @param {object} zone
 * @returns {string}
 */
export const zoneTrackerState = (zone) =>
  zone.entity_id === HOME_ZONE ? "home" : (zone.attributes?.friendly_name ?? zone.entity_id.split(".")[1].replace(/_/g, " "));

/**
 * The first active zone in an in_zones list (not passive, with a position).
 * @param {string[]} inZones
 * @param {object} states
 * @returns {object|undefined}
 */
export function firstActiveZone(inZones, states) {
  for (const id of inZones ?? []) {
    const z = states?.[id];
    if (z && !z.attributes?.passive && isNum(z.attributes?.latitude) && isNum(z.attributes?.longitude)) return z;
  }
  return undefined;
}

/**
 * The zone an activity line belongs to: its in_zones, else the zone whose tracker state it names.
 * @param {{state: string, inZones?: string[]}} entry
 * @param {object} states
 * @returns {object|undefined}
 */
export function zoneOfEntry(entry, states) {
  const z = entry.inZones && firstActiveZone(entry.inZones, states);
  if (z) return z;
  if (entry.state === "not_home" || entry.state === "unknown") return undefined;
  return Object.values(states ?? {}).find((c) => domainOf(c?.entity_id) === "zone" && zoneTrackerState(c) === entry.state);
}

/**
 * The unit and value for a relative time, as HA chooses them (thresholds 59 s, 59 min, 22 h, then
 * calendar days under 5, weeks under 4, months under 11 or within the year, then years).
 * @param {number} from ms
 * @param {number} to ms
 * @param {number} [weekStartsOn] 0 Sunday ... 6
 * @returns {{value: number, unit: string}}
 */
export function selectUnit(from, to, weekStartsOn = 0) {
  const secs = (from - to) / 1000;
  if (Math.abs(secs) < 59) return { value: Math.round(secs), unit: "second" };
  const mins = secs / 60;
  if (Math.abs(mins) < 59) return { value: Math.round(mins), unit: "minute" };
  const hours = secs / 3600;
  if (Math.abs(hours) < 22) return { value: Math.round(hours), unit: "hour" };
  const f = new Date(from), t = new Date(to);
  f.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
  const days = Math.round((f - t) / 86400000);
  if (days === 0) return { value: Math.round(hours), unit: "hour" };
  if (Math.abs(days) < 5) return { value: days, unit: "day" };
  const weekStart = (d) => { const c = new Date(d); c.setDate(c.getDate() - ((c.getDay() - weekStartsOn + 7) % 7)); return c; };
  const weeks = Math.round((weekStart(f) - weekStart(t)) / (7 * 86400000));
  if (weeks === 0) return { value: days, unit: "day" };
  if (Math.abs(weeks) < 4) return { value: weeks, unit: "week" };
  const years = f.getFullYear() - t.getFullYear();
  const months = years * 12 + f.getMonth() - t.getMonth();
  if (months === 0) return { value: weeks, unit: "week" };
  if (Math.abs(months) < 11 || years === 0) return { value: months, unit: "month" };
  return { value: years, unit: "year" };
}

/**
 * "14 min. ago" and the like, in the viewer's language.
 * @param {Date|string|number} when
 * @param {{language?: string, style?: string, now?: number, weekStartsOn?: number}} [o]
 * @returns {string}
 */
export function relativeTime(when, { language = "en", style = "long", now = Date.now(), weekStartsOn = 0 } = {}) {
  const t = new Date(when).getTime();
  if (!Number.isFinite(t)) return "";
  const { value, unit } = selectUnit(t, now, weekStartsOn);
  try {
    return new Intl.RelativeTimeFormat(language, { numeric: "auto", style }).format(value, unit);
  } catch {
    return new Intl.RelativeTimeFormat("en", { numeric: "auto", style }).format(value, unit);
  }
}

/**
 * The bottom sheet's stops, lowest first: collapsed (when a strip height is known), half, full.
 * @param {number|undefined} collapsed px
 * @param {number} half px
 * @param {number} full px
 * @returns {Array<{position: string, height: number}>}
 */
export function sheetStops(collapsed, half, full) {
  const stops = [];
  if (isNum(collapsed)) stops.push({ position: "collapsed", height: collapsed });
  stops.push({ position: "half", height: half }, { position: "full", height: full });
  return stops;
}

/**
 * Where a drag ends: a swipe goes on to the next stop in its direction, a slow drag settles on the nearest.
 * @param {Array<{position: string, height: number}>} stops lowest first
 * @param {number} height the sheet's height when let go, px
 * @param {"up"|"down"|undefined} direction a swipe's direction, or none
 * @returns {string} the position
 */
export function stopAfterDrag(stops, height, direction) {
  if (direction === "up") return (stops.find((s) => s.height > height) ?? stops[stops.length - 1]).position;
  if (direction === "down") return ([...stops].reverse().find((s) => s.height < height) ?? stops[0]).position;
  return stops.reduce((n, s) => (Math.abs(s.height - height) < Math.abs(n.height - height) ? s : n)).position;
}

/**
 * Was it a swipe, and which way? Velocity is the whole drag's (px/ms, + down), counted only when the
 * last move was within MOVEMENT_TIME_MS of letting go.
 * @param {{startY: number, startTime: number, lastY: number, lastTime: number}} g
 * @param {number} now ms
 * @returns {"up"|"down"|undefined}
 */
export function swipeDirection(g, now) {
  if (now - g.lastTime >= MOVEMENT_TIME_MS) return undefined;
  const dt = g.lastTime - g.startTime;
  const v = dt > 0 ? (g.lastY - g.startY) / dt : 0;
  if (Math.abs(v) <= SWIPE_VELOCITY) return undefined;
  return v > 0 ? "down" : "up";
}

/**
 * Is the element inside a Lovelace panel view (looking through shadow roots and wrapper cards)?
 * @param {Node} el
 * @returns {boolean}
 */
export function inPanelView(el) {
  let n = el;
  for (let i = 0; n && i < 200; i++) {
    if (n.localName === "hui-panel-view") return true;
    n = n.parentNode ?? n.host ?? null;
  }
  return false;
}

/**
 * Is the overview shown? `overview: true|false` forces it; unset, it follows the panel view, as HA.
 * @param {boolean|undefined} option
 * @param {boolean} panel
 * @returns {boolean}
 */
export const overviewShown = (option, panel) => option === true || (option !== false && panel);

/**
 * The selection a URL names, when it is a person, tracker or zone.
 * @param {string} search location.search
 * @returns {string|undefined}
 */
export function selectedFromSearch(search) {
  try {
    const id = new URLSearchParams(search ?? "").get(SELECTED_PARAM);
    return id && SELECTABLE_DOMAINS.includes(domainOf(id)) ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The search string with the selection set (or removed with `undefined`), other parameters kept.
 * @param {string} search
 * @param {string|undefined} id
 * @returns {string} "" or "?..."
 */
export function searchWith(search, id) {
  const p = new URLSearchParams(search ?? "");
  if (id) p.set(SELECTED_PARAM, id); else p.delete(SELECTED_PARAM);
  const s = p.toString();
  return s ? `?${s}` : "";
}
