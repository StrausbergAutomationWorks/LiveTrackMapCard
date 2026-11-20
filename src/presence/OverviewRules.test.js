import { describe, it, expect } from "@jest/globals";
import {
  TABS, ACTIVITY_HOURS, ACTIVITY_MAX_ENTRIES, ACTIVITY_INITIAL_ENTRIES, FOCUS_MAX_ZOOM, FOCUS_CLEARANCE_PX, OVERVIEW_GAP,
  OVERVIEW_WIDTH, OVERVIEW_SINGLE_TAB_WIDTH, PHONE_MAX_WIDTH, SELECTED_MARKER_SCALE, NOMINAL_ACCURACY, SELECTABLE_DOMAINS,
  SELECTED_PARAM, HALF_VIEWPORT_SHARE, SWIPE_VELOCITY, MOVEMENT_TIME_MS, TOUCH_SLOP_PX,
  personActivity, zoneActivity, entityName, isMe, peopleOf, devicesOf, zonesOf, tabsWithItems, shownTab, hiddenByTab,
  showsRadius, accuracyShown, focusZoom, overviewPadding, navigationUrl, zoneTrackerState, firstActiveZone, zoneOfEntry,
  selectUnit, relativeTime, sheetStops, stopAfterDrag, swipeDirection, inPanelView, overviewShown, selectedFromSearch, searchWith,
} from "./OverviewRules.js";

// Step 2 (Lee 2026-11-19): Home Assistant's overview rules, read from home-assistant/frontend @ 4d8eca2.
// Constants are written as literals here so a changed value fails a test.

const zone = (id, name, extra = {}) => ({ entity_id: id, state: "0", attributes: { friendly_name: name, latitude: 1, longitude: 2, ...extra } });
const person = (id, name, extra = {}) => ({ entity_id: id, state: "home", attributes: { friendly_name: name, latitude: 1, longitude: 2, ...extra } });

describe("constants are HA's", () => {
  it("as read from hui-map-overview, map-activity, hui-map-card, ha-entity-marker, ha-map and ha-snap-bottom-sheet", () => {
    expect(TABS).toEqual(["people", "devices", "zones"]);
    expect([ACTIVITY_HOURS, ACTIVITY_MAX_ENTRIES, ACTIVITY_INITIAL_ENTRIES]).toEqual([24, 20, 5]);
    expect([FOCUS_MAX_ZOOM, FOCUS_CLEARANCE_PX, OVERVIEW_GAP]).toEqual([17, 80, 12]);
    expect([OVERVIEW_WIDTH, OVERVIEW_SINGLE_TAB_WIDTH, PHONE_MAX_WIDTH]).toEqual([360, 300, 600]);
    expect([SELECTED_MARKER_SCALE, NOMINAL_ACCURACY]).toEqual([1.25, 2.5]);
    expect(SELECTABLE_DOMAINS).toEqual(["person", "device_tracker", "zone"]);
    expect(SELECTED_PARAM).toBe("entity_id");
    expect([HALF_VIEWPORT_SHARE, SWIPE_VELOCITY, MOVEMENT_TIME_MS, TOUCH_SLOP_PX]).toEqual([0.5, 0.5, 100, 4]);
  });
});

describe("personActivity", () => {
  const since = 1000 * 1000;
  it("newest first; the window's first state is not an event; repeats and no-location samples are skipped", () => {
    const h = [
      { s: "home", lu: 900 }, // before the window: seeds the previous state
      { s: "home", lu: 1100 }, // no change
      { s: "unavailable", lu: 1150 }, // a dropout, skipped
      { s: "home", lu: 1160 }, // still no change, the dropout did not count
      { s: "not_home", a: { in_zones: [] }, lu: 1200 },
      { s: "unknown", lu: 1250 },
      { s: "Work", a: { in_zones: ["zone.work"] }, lu: 1300 },
    ];
    const r = personActivity(h, since);
    expect(r.map((e) => e.state)).toEqual(["Work", "not_home"]);
    expect(r[0].inZones).toEqual(["zone.work"]);
    expect(r[0].when).toEqual(new Date(1300 * 1000));
  });
  it("a change before the window is not listed; one exactly at its start is", () => {
    expect(personActivity([{ s: "a", lu: 999 }, { s: "b", lu: 1000 }], since).map((e) => e.state)).toEqual(["b"]);
    expect(personActivity([{ s: "a", lu: 998 }, { s: "b", lu: 999 }], since)).toEqual([]);
  });
  it("at most 20, the newest", () => {
    const h = Array.from({ length: 30 }, (_, i) => ({ s: `s${i}`, lu: 1000 + i }));
    const r = personActivity(h, since);
    expect(r).toHaveLength(20);
    expect(r[0].state).toBe("s29");
    expect(r[19].state).toBe("s10");
  });
  it("no history: nothing", () => {
    expect(personActivity(undefined, since)).toEqual([]);
  });
});

describe("zoneActivity", () => {
  const since = 1000 * 1000;
  it("arrivals and departures by person, newest first across people", () => {
    const h = {
      "person.a": [
        { s: "home", a: { in_zones: ["zone.home"] }, lu: 900 }, // in at the start: not an event
        { s: "not_home", a: { in_zones: [] }, lu: 1100 }, // left
        { s: "unavailable", lu: 1150 }, // skipped
        { s: "home", a: { in_zones: ["zone.home"] }, lu: 1300 }, // entered
      ],
      "person.b": [
        { s: "not_home", a: { in_zones: [] }, lu: 900 },
        { s: "home", a: { in_zones: ["zone.home"] }, lu: 1200 }, // entered
      ],
    };
    const r = zoneActivity(h, ["person.a", "person.b"], "zone.home", since);
    expect(r.map((e) => `${e.personId} ${e.arrived ? "in" : "out"} ${e.when.getTime() / 1000}`))
      .toEqual(["person.a in 1300", "person.b in 1200", "person.a out 1100"]);
  });
  it("a dropout while inside the zone is neither a departure nor an arrival (mutation 2026-11-19)", () => {
    const h = { p: [
      { s: "home", a: { in_zones: ["z"] }, lu: 900 },
      { s: "unavailable", a: {}, lu: 1100 },
      { s: "unknown", lu: 1150 },
      { s: "home", a: { in_zones: ["z"] }, lu: 1200 },
    ] };
    expect(zoneActivity(h, ["p"], "z", since)).toEqual([]);
  });
  it("a first sample inside the window is an event only if it is an arrival", () => {
    expect(zoneActivity({ p: [{ s: "home", a: { in_zones: ["z"] }, lu: 1100 }] }, ["p"], "z", since)).toHaveLength(1);
    expect(zoneActivity({ p: [{ s: "x", a: { in_zones: [] }, lu: 1100 }] }, ["p"], "z", since)).toHaveLength(0);
  });
  it("events before the window are dropped but still set the state", () => {
    const r = zoneActivity({ p: [{ s: "a", a: { in_zones: ["z"] }, lu: 500 }, { s: "b", a: { in_zones: [] }, lu: 600 }, { s: "c", a: { in_zones: [] }, lu: 1100 }] }, ["p"], "z", since);
    expect(r).toEqual([]);
  });
  it("no in_zones counts as outside; at most 20", () => {
    const h = { p: Array.from({ length: 50 }, (_, i) => ({ s: "x", a: i % 2 ? { in_zones: ["z"] } : {}, lu: 1000 + i })) };
    const r = zoneActivity(h, ["p"], "z", since);
    expect(r).toHaveLength(20);
    expect(r[0].when.getTime()).toBe(1049 * 1000);
  });
  it("no history: nothing", () => {
    expect(zoneActivity(undefined, ["p"], "z", since)).toEqual([]);
  });
});

describe("names and the viewer", () => {
  it("the dashboard's name wins, then HA's formatter, then friendly_name, then the object id", () => {
    const s = person("person.ana_lopez", "Ana Lopez");
    expect(entityName(s, new Map([["person.ana_lopez", "Mom"]]), {})).toBe("Mom");
    expect(entityName(s, new Map(), { formatEntityName: () => "Ana L." })).toBe("Ana L.");
    expect(entityName(s, new Map(), { formatEntityName: () => "" })).toBe("Ana Lopez");
    expect(entityName(s, undefined, { formatEntityName: () => { throw new Error("old"); } })).toBe("Ana Lopez");
    expect(entityName({ entity_id: "device_tracker.bens_ipad", attributes: {} })).toBe("bens ipad");
  });
  it("the viewer is the person whose user_id is the logged-in user's; never a tracker", () => {
    expect(isMe(person("person.a", "A", { user_id: "u1" }), { id: "u1" })).toBe(true);
    expect(isMe(person("person.a", "A", { user_id: "u1" }), { id: "u2" })).toBe(false);
    expect(isMe({ entity_id: "device_tracker.a", attributes: { user_id: "u1" } }, { id: "u1" })).toBe(false);
    expect(isMe(person("person.a", "A", { user_id: undefined }), { id: undefined })).toBe(false);
    expect(isMe(person("person.a", "A"), undefined)).toBe(false);
  });
});

describe("the tabs' lists", () => {
  const name = (s) => s.attributes.friendly_name;
  it("people: the viewer first, then located, then by name; trackers left out", () => {
    const states = {
      "person.zed": person("person.zed", "Zed"),
      "person.amy": person("person.amy", "Amy", { latitude: undefined, longitude: undefined }),
      "person.bob": person("person.bob", "Bob"),
      "person.me": person("person.me", "Yves", { user_id: "u" }),
      "device_tracker.t": person("device_tracker.t", "T"),
    };
    const ids = Object.keys(states).concat("person.gone");
    expect(peopleOf(ids, states, { user: { id: "u" }, name }).map((s) => s.entity_id))
      .toEqual(["person.me", "person.bob", "person.zed", "person.amy"]);
  });
  it("a person located only through an active zone counts as located", () => {
    const states = {
      "zone.home": zone("zone.home", "Home"),
      "person.amy": person("person.amy", "Amy", { latitude: undefined, longitude: undefined, in_zones: ["zone.home"] }),
      "person.aaron": person("person.aaron", "Aaron", { latitude: undefined, longitude: undefined }),
    };
    expect(peopleOf(["person.aaron", "person.amy"], states, { name }).map((s) => s.entity_id)).toEqual(["person.amy", "person.aaron"]);
  });
  it("devices: located trackers only, by name", () => {
    const states = {
      "device_tracker.b": person("device_tracker.b", "B"),
      "device_tracker.a": person("device_tracker.a", "A"),
      "device_tracker.n": person("device_tracker.n", "N", { latitude: undefined }),
      "person.p": person("person.p", "P"),
    };
    expect(devicesOf(Object.keys(states), states, { name }).map((s) => s.entity_id)).toEqual(["device_tracker.a", "device_tracker.b"]);
  });
  it("zones: every positioned, non-passive zone, Home first, then by name", () => {
    const states = {
      "zone.work": zone("zone.work", "Work"),
      "zone.home": zone("zone.home", "Home"),
      "zone.annex": zone("zone.annex", "Annex"),
      "zone.quiet": zone("zone.quiet", "Quiet", { passive: true }),
      "zone.nowhere": zone("zone.nowhere", "Nowhere", { latitude: "1" }),
      "person.p": person("person.p", "P"),
    };
    expect(zonesOf(states, { name }).map((s) => s.entity_id)).toEqual(["zone.home", "zone.annex", "zone.work"]);
    expect(zonesOf(undefined, { name })).toEqual([]);
  });
  it("tabs with items in HA's order; the tab shown falls back to the first", () => {
    const tabs = tabsWithItems([1], [], [2]);
    expect(tabs.map(([t]) => t)).toEqual(["people", "zones"]);
    expect(shownTab("zones", tabs)).toBe("zones");
    expect(shownTab("devices", tabs)).toBe("people");
    expect(shownTab("people", [])).toBeUndefined();
  });
});

describe("what the map shows with the overview", () => {
  it("People hides trackers, Devices hides persons, Zones hides both; the selection and other domains never", () => {
    expect(hiddenByTab("device_tracker.t", "people")).toBe(true);
    expect(hiddenByTab("person.p", "people")).toBe(false);
    expect(hiddenByTab("person.p", "devices")).toBe(true);
    expect(hiddenByTab("device_tracker.t", "devices")).toBe(false);
    expect(hiddenByTab("person.p", "zones")).toBe(true);
    expect(hiddenByTab("device_tracker.t", "zones")).toBe(true);
    expect(hiddenByTab("person.p", "devices", "person.p")).toBe(false);
    expect(hiddenByTab("geo_location.aircraft", "devices")).toBe(false);
    expect(hiddenByTab("zone.home", "people")).toBe(false);
  });
  it("a zone's radius: when selected, or every zone on the Zones tab", () => {
    expect(showsRadius("zone.a", "zone.a", "people")).toBe(true);
    expect(showsRadius("zone.a", "zone.b", "people")).toBe(false);
    expect(showsRadius("zone.a", undefined, "zones")).toBe(true);
  });
  it("accuracy: without the overview every reported one; with it, only the selection, nominal when none", () => {
    expect(accuracyShown(30, false, false)).toBe(30);
    expect(accuracyShown(0, false, false)).toBe(0);
    expect(accuracyShown(30, false, true)).toBe(0);
    expect(accuracyShown(30, true, true)).toBe(30);
    expect(accuracyShown(0, true, true)).toBe(2.5);
    expect(accuracyShown(undefined, true, true)).toBe(2.5);
    expect(accuracyShown(-4, false, false)).toBe(0);
    expect(accuracyShown(NaN, true, true)).toBe(2.5);
  });
});

describe("focus and padding", () => {
  it("zooms in only as far as clears the nearest other marker by 80 px, never out, never past 17", () => {
    expect(focusZoom(12, 40)).toBe(13);
    expect(focusZoom(12, 10)).toBe(15);
    expect(focusZoom(12, 160)).toBe(12);
    expect(focusZoom(12, Infinity)).toBe(12);
    expect(focusZoom(16, 1)).toBe(17);
    expect(focusZoom(18, 1)).toBe(18);
  });
  it("the panel's side on desktop (width + 24, the reading direction's start), its half height + 12 on a phone", () => {
    expect(overviewPadding(false, 360)).toEqual({ left: 384 });
    expect(overviewPadding(false, 360, true)).toEqual({ right: 384 });
    expect(overviewPadding(true, 370)).toEqual({ bottom: 382 });
    expect(overviewPadding(false, 0)).toBeUndefined();
  });
});

describe("directions", () => {
  it("Apple Maps on iOS (and iPadOS that says Macintosh with touch), geo: on Android, OpenStreetMap elsewhere", () => {
    expect(navigationUrl(1.5, -2.25, { userAgent: "Mozilla (iPhone; CPU iPhone OS 17)" })).toBe("https://maps.apple.com/?daddr=1.5,-2.25");
    expect(navigationUrl(1.5, -2.25, { userAgent: "Mozilla (Macintosh; Intel Mac OS X)", maxTouchPoints: 5 })).toBe("https://maps.apple.com/?daddr=1.5,-2.25");
    expect(navigationUrl(1.5, -2.25, { userAgent: "Mozilla (Linux; Android 14)" })).toBe("geo:1.5,-2.25?q=1.5,-2.25");
    expect(navigationUrl(1.5, -2.25, { userAgent: "Mozilla (Macintosh; Intel Mac OS X)", maxTouchPoints: 0 }))
      .toBe("https://www.openstreetmap.org/directions?to=1.5%2C-2.25#map=15/1.5/-2.25");
    expect(navigationUrl(1, 2, {})).toBe("https://www.openstreetmap.org/directions?to=1%2C2#map=15/1/2");
  });
});

describe("zones in the activity", () => {
  const states = {
    "zone.home": zone("zone.home", "Home"),
    "zone.work": zone("zone.work", "Work"),
    "zone.lab": { entity_id: "zone.lab", state: "0", attributes: { latitude: 1, longitude: 2 } },
    "zone.quiet": zone("zone.quiet", "Quiet", { passive: true }),
  };
  it("a tracker in Home reports 'home'; elsewhere the zone's name, or its object id", () => {
    expect(zoneTrackerState(states["zone.home"])).toBe("home");
    expect(zoneTrackerState(states["zone.work"])).toBe("Work");
    expect(zoneTrackerState({ entity_id: "zone.big_lab", attributes: {} })).toBe("big lab");
  });
  it("the first active zone: not passive, positioned", () => {
    expect(firstActiveZone(["zone.quiet", "zone.gone", "zone.work"], states).entity_id).toBe("zone.work");
    expect(firstActiveZone(["zone.quiet"], states)).toBeUndefined();
    expect(firstActiveZone(undefined, states)).toBeUndefined();
  });
  it("an entry's zone: its in_zones first, else the zone its state names; away and unknown have none", () => {
    expect(zoneOfEntry({ state: "x", inZones: ["zone.work"] }, states).entity_id).toBe("zone.work");
    expect(zoneOfEntry({ state: "home" }, states).entity_id).toBe("zone.home");
    expect(zoneOfEntry({ state: "Work", inZones: [] }, states).entity_id).toBe("zone.work");
    expect(zoneOfEntry({ state: "lab" }, states).entity_id).toBe("zone.lab");
    expect(zoneOfEntry({ state: "not_home" }, states)).toBeUndefined();
    expect(zoneOfEntry({ state: "unknown" }, states)).toBeUndefined();
    expect(zoneOfEntry({ state: "Mars" }, states)).toBeUndefined();
  });
  it("away and unknown have no zone even when a zone carries that name (mutation 2026-11-19)", () => {
    const odd = { ...states, "zone.unknown": { entity_id: "zone.unknown", state: "0", attributes: { latitude: 1, longitude: 2 } },
      "zone.away": zone("zone.away", "not_home") };
    expect(zoneOfEntry({ state: "unknown" }, odd)).toBeUndefined();
    expect(zoneOfEntry({ state: "not_home" }, odd)).toBeUndefined();
  });
});

describe("relative time (HA's selectUnit)", () => {
  const now = new Date(2026, 10, 19, 23, 30, 0).getTime(); // a Thursday
  const ago = (ms) => selectUnit(now - ms, now);
  it("seconds under 59, minutes under 59, hours under 22", () => {
    expect(ago(30 * 1000)).toEqual({ value: -30, unit: "second" });
    expect(ago(58.4 * 1000)).toEqual({ value: -58, unit: "second" });
    expect(ago(59 * 1000)).toEqual({ value: -1, unit: "minute" });
    expect(ago(14 * 60000)).toEqual({ value: -14, unit: "minute" });
    expect(ago(59 * 60000)).toEqual({ value: -1, unit: "hour" });
    expect(ago(21 * 3600000)).toEqual({ value: -21, unit: "hour" });
  });
  it("22 hours or more: calendar days (hours again when the same day), under 5", () => {
    expect(selectUnit(new Date(2026, 10, 19, 0, 30).getTime(), new Date(2026, 10, 19, 23, 30).getTime())).toEqual({ value: -23, unit: "hour" });
    expect(ago(23 * 3600000)).toEqual({ value: -23, unit: "hour" }); // 00:30 the same day
    expect(ago(25 * 3600000)).toEqual({ value: -1, unit: "day" });
    expect(ago(4 * 86400000)).toEqual({ value: -4, unit: "day" });
  });
  it("22 to 24 hours ago on the previous calendar day is a day, not hours (mutation 2026-11-19)", () => {
    const morning = new Date(2026, 10, 20, 10, 0).getTime();
    expect(selectUnit(morning - 23 * 3600000, morning)).toEqual({ value: -1, unit: "day" });
    expect(selectUnit(morning - 22 * 3600000, morning)).toEqual({ value: -1, unit: "day" });
  });
  it("then weeks (days again in the same week), months, years", () => {
    expect(ago(6 * 86400000)).toEqual({ value: -1, unit: "week" });
    expect(ago(13 * 86400000)).toEqual({ value: -2, unit: "week" });
    expect(ago(40 * 86400000)).toEqual({ value: -1, unit: "month" });
    expect(ago(400 * 86400000)).toEqual({ value: -1, unit: "year" });
    const sat = new Date(2026, 10, 21, 12).getTime(), mon = new Date(2026, 10, 16, 12).getTime();
    expect(selectUnit(mon, sat)).toEqual({ value: -5, unit: "day" });
    expect(selectUnit(mon, sat, 1)).toEqual({ value: -5, unit: "day" });
  });
  it("formatted in the viewer's language; an unknown language falls back to English", () => {
    expect(relativeTime(now - 14 * 60000, { now, language: "en" })).toBe("14 minutes ago");
    expect(relativeTime(now - 14 * 60000, { now, language: "en", style: "short" })).toBe("14 min. ago");
    expect(relativeTime(now - 3600000, { now, language: "da" })).toBe("for 1 time siden");
    expect(relativeTime(now - 60000, { now, language: "not a language!" })).toBe("1 minute ago");
    expect(relativeTime("not a date", { now })).toBe("");
  });
});

describe("the bottom sheet (ha-snap-bottom-sheet)", () => {
  const stops = sheetStops(100, 400, 700);
  it("stops lowest first; no collapsed stop without a strip height", () => {
    expect(stops.map((s) => s.position)).toEqual(["collapsed", "half", "full"]);
    expect(sheetStops(undefined, 400, 700).map((s) => s.position)).toEqual(["half", "full"]);
  });
  it("a slow drag settles on the nearest stop", () => {
    expect(stopAfterDrag(stops, 240, undefined)).toBe("collapsed");
    expect(stopAfterDrag(stops, 260, undefined)).toBe("half");
    expect(stopAfterDrag(stops, 690, undefined)).toBe("full");
  });
  it("a swipe goes on to the next stop its way, stopping at the ends", () => {
    expect(stopAfterDrag(stops, 410, "up")).toBe("full");
    expect(stopAfterDrag(stops, 390, "up")).toBe("half");
    expect(stopAfterDrag(stops, 800, "up")).toBe("full");
    expect(stopAfterDrag(stops, 390, "down")).toBe("collapsed");
    expect(stopAfterDrag(stops, 410, "down")).toBe("half");
    expect(stopAfterDrag(stops, 50, "down")).toBe("collapsed");
  });
  it("a swipe is faster than 0.5 px/ms over the drag, with a move in the last 100 ms", () => {
    expect(swipeDirection({ startY: 0, startTime: 0, lastY: 60, lastTime: 100 }, 150)).toBe("down");
    expect(swipeDirection({ startY: 60, startTime: 0, lastY: 0, lastTime: 100 }, 150)).toBe("up");
    expect(swipeDirection({ startY: 0, startTime: 0, lastY: 50, lastTime: 100 }, 150)).toBeUndefined();
    expect(swipeDirection({ startY: 0, startTime: 0, lastY: 60, lastTime: 100 }, 200)).toBeUndefined();
    expect(swipeDirection({ startY: 0, startTime: 0, lastY: 60, lastTime: 0 }, 50)).toBeUndefined();
  });
});

describe("when the overview shows, and the URL", () => {
  it("a panel view is found through wrapper cards and shadow roots", () => {
    const view = document.createElement("hui-panel-view");
    const wrapper = document.createElement("auto-entities");
    view.appendChild(wrapper);
    const root = wrapper.attachShadow({ mode: "open" });
    const card = document.createElement("div");
    root.appendChild(card);
    expect(inPanelView(card)).toBe(true);
    expect(inPanelView(document.createElement("div"))).toBe(false);
    expect(inPanelView(null)).toBe(false);
  });
  it("the option forces it either way; unset follows the panel view", () => {
    expect(overviewShown(undefined, true)).toBe(true);
    expect(overviewShown(undefined, false)).toBe(false);
    expect(overviewShown(true, false)).toBe(true);
    expect(overviewShown(false, true)).toBe(false);
  });
  it("the URL names a selection only for a person, tracker or zone", () => {
    expect(selectedFromSearch("?entity_id=person.ana")).toBe("person.ana");
    expect(selectedFromSearch("?a=1&entity_id=zone.home")).toBe("zone.home");
    expect(selectedFromSearch("?entity_id=light.kitchen")).toBeUndefined();
    expect(selectedFromSearch("")).toBeUndefined();
    expect(selectedFromSearch(undefined)).toBeUndefined();
  });
  it("setting and clearing the selection keeps other parameters", () => {
    expect(searchWith("?edit=1", "person.ana")).toBe("?edit=1&entity_id=person.ana");
    expect(searchWith("?edit=1&entity_id=person.ana", undefined)).toBe("?edit=1");
    expect(searchWith("?entity_id=person.ana", undefined)).toBe("");
    expect(searchWith("", "zone.home")).toBe("?entity_id=zone.home");
  });
});
