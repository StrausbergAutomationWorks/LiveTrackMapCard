import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

// Lit's build is not run under Jest here (as in the card's other tests): a plain element stands in.
// The panel's rendering is checked on the look page (bin\ltmc280_look\index_overview.html); this file
// checks its logic: activity, strings, events and the sheet's drag.
jest.mock("lit", () => ({
  LitElement: class LitElement extends EventTarget {
    static get properties() { return {}; }
    requestUpdate() {}
    connectedCallback() {}
    disconnectedCallback() {}
    toggleAttribute() {}
    getBoundingClientRect() { return { width: 0, height: 0 }; }
    get updateComplete() { return Promise.resolve(true); }
  },
  html: (strings) => strings.join(""),
  css: (strings) => strings.join(""),
  nothing: undefined,
}));

import { LtmcMapOverview, OVERVIEW_TAG } from "./LtmcMapOverview.js";

const NOW = new Date(2026, 10, 19, 23, 30).getTime();
let el, hass;

const st = (id, state, attrs = {}) => ({ entity_id: id, state, last_updated: new Date(NOW - 600000).toISOString(), attributes: { latitude: 1, longitude: 2, ...attrs } });

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  hass = {
    states: {
      "person.ana": st("person.ana", "home", { friendly_name: "Ana Lopez", user_id: "u1", in_zones: ["zone.home"] }),
      "person.ben": st("person.ben", "not_home", { friendly_name: "Ben" }),
      "device_tracker.bens_ipad": st("device_tracker.bens_ipad", "home", { friendly_name: "Ben's iPad" }),
      "zone.home": st("zone.home", "1", { friendly_name: "Home" }),
    },
    user: { id: "u1", is_admin: true },
    callWS: jest.fn(),
  };
  el = new LtmcMapOverview();
  el.hass = hass;
  el.entityIds = ["person.ana", "person.ben", "device_tracker.bens_ipad"];
});
afterEach(() => jest.restoreAllMocks());

const heard = (type) => {
  const f = jest.fn();
  el.addEventListener(type, (e) => f(e.detail));
  return f;
};

describe("the element", () => {
  it("is named ltmc-map-overview", () => {
    expect(OVERVIEW_TAG).toBe("ltmc-map-overview");
  });
  it("starts on People, nothing selected, the sheet at half", () => {
    expect([el.tab, el.selected, el._position]).toEqual(["people", undefined, "half"]);
  });
});

describe("strings", () => {
  it("Home Assistant's translation when it has one, else English", () => {
    hass.localize = (k) => (k === "ui.panel.lovelace.cards.map.overview.people" ? "Personer" : "");
    expect(el._t("people")).toBe("Personer");
    expect(el._t("devices")).toBe("Devices");
    hass.localize = () => { throw new Error("broken"); };
    expect(el._t("zones")).toBe("Zones");
  });
  it("people in a zone, in English when untranslated", () => {
    expect([0, 1, 4].map((count) => el._t("people_in_zone", { count }))).toEqual(["No one here", "1 person", "4 people"]);
    hass.localize = (k, v) => (k.endsWith("people_in_zone") ? `${v.count} personer` : "");
    expect(el._t("people_in_zone", { count: 2 })).toBe("2 personer");
  });
  it("the viewer is 'Me'; others by name", () => {
    expect(el._personName(hass.states["person.ana"])).toBe("Me");
    expect(el._personName(hass.states["person.ben"])).toBe("Ben");
  });
  it("states through HA's formatter when it has one", () => {
    expect(el._state(hass.states["person.ben"])).toBe("not_home");
    hass.formatEntityState = (s, v) => ((v ?? s.state) === "not_home" ? "Away" : "Home");
    expect(el._state(hass.states["person.ben"])).toBe("Away");
    expect(el._state(hass.states["person.ben"], "home")).toBe("Home");
  });
  it("times in 12 or 24 hours as the viewer chose", () => {
    const t = new Date(2026, 10, 19, 21, 5);
    hass.locale = { language: "en", time_format: "24" };
    expect(el._time(t)).toBe("21:05");
    hass.locale = { language: "en", time_format: "12" };
    expect(el._time(t)).toBe("9:05 PM");
  });
});

describe("the lists", () => {
  it("people, devices and zones, and only the tabs that have something", () => {
    const l = el._lists();
    expect(l.people.map((s) => s.entity_id)).toEqual(["person.ana", "person.ben"]);
    expect(l.devices.map((s) => s.entity_id)).toEqual(["device_tracker.bens_ipad"]);
    expect(l.zones.map((s) => s.entity_id)).toEqual(["zone.home"]);
    expect(l.tabs.map(([t]) => t)).toEqual(["people", "devices", "zones"]);
    el.entityIds = [];
    expect(el._lists().tabs.map(([t]) => t)).toEqual(["zones"]);
  });
});

describe("activity", () => {
  it("a person's last 24 h from Home Assistant's history, with attributes", async () => {
    // HA's history opens with the state at the window's start, timestamped when it began (before the window).
    hass.callWS.mockResolvedValue({ "person.ben": [{ s: "home", lu: NOW / 1000 - 30 * 3600 }, { s: "not_home", lu: NOW / 1000 - 600 }] });
    el._activityRequest = 3;
    await el.loadActivity("person.ben", 3);
    const msg = hass.callWS.mock.calls[0][0];
    expect(msg).toEqual({
      type: "history/history_during_period", entity_ids: ["person.ben"], minimal_response: false, no_attributes: false,
      start_time: new Date(NOW - 24 * 3600 * 1000).toISOString(), end_time: new Date(NOW).toISOString(),
    });
    expect(el._activity.map((e) => e.state)).toEqual(["not_home"]);
    expect(el._activityFailed).toBe(false);
  });
  it("a zone's arrivals and departures, asked for the map's people", async () => {
    hass.callWS.mockResolvedValue({ "person.ana": [{ s: "not_home", a: { in_zones: [] }, lu: NOW / 1000 - 7200 }, { s: "home", a: { in_zones: ["zone.home"] }, lu: NOW / 1000 - 60 }] });
    el._activityRequest = 1;
    await el.loadActivity("zone.home", 1);
    expect(hass.callWS.mock.calls[0][0].entity_ids).toEqual(["person.ana", "person.ben"]);
    expect(el._activity).toHaveLength(1);
    expect(el._activity[0]).toMatchObject({ personId: "person.ana", arrived: true });
  });
  it("a zone with no people on the map asks nothing", async () => {
    el.entityIds = [];
    el._activityRequest = 1;
    await el.loadActivity("zone.home", 1);
    expect(hass.callWS).not.toHaveBeenCalled();
    expect(el._activity).toEqual([]);
  });
  it("history unreadable: shown as unavailable", async () => {
    hass.callWS.mockRejectedValue(new Error("no history"));
    el._activityRequest = 1;
    await el.loadActivity("person.ben", 1);
    expect(el._activityFailed).toBe(true);
    expect(el._activity).toEqual([]);
  });
  it("an older request that answers late is ignored", async () => {
    hass.callWS.mockResolvedValue({});
    el._activityRequest = 5;
    el._activity = "kept";
    await el.loadActivity("person.ben", 4);
    expect(el._activity).toBe("kept");
  });
  it("a new selection clears the old activity and asks again", () => {
    const load = jest.spyOn(el, "loadActivity").mockResolvedValue();
    el._activity = [1];
    el._activityExpanded = true;
    el.selected = "person.ben";
    el.willUpdate(new Map([["selected", undefined]]));
    expect([el._activity, el._activityExpanded, el._activityFailed]).toEqual([undefined, false, false]);
    expect(load).toHaveBeenCalledWith("person.ben", el._activityRequest);
    el.selected = undefined;
    el.willUpdate(new Map([["selected", "person.ben"]]));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("events", () => {
  it("a row selects, back clears, a tab asks for its tab", () => {
    const select = heard("ltmc-overview-select");
    const tab = heard("ltmc-overview-tab");
    el._onRow({ currentTarget: { dataset: { entityId: "person.ben" } } });
    el._onRow({ currentTarget: { dataset: {} } });
    el._onBack();
    el._onTabClick({ currentTarget: { dataset: { tab: "zones" } } });
    expect(select.mock.calls.map((c) => c[0])).toEqual([{ entityId: "person.ben" }, { entityId: undefined }]);
    expect(tab).toHaveBeenCalledWith({ tab: "zones" });
  });
  it("events bubble out of the shadow root", () => {
    const seen = [];
    el.dispatchEvent = (e) => { seen.push([e.type, e.bubbles, e.composed]); return true; };
    el._onBack();
    expect(seen).toEqual([["ltmc-overview-select", true, true]]);
  });
  it("settings opens the selection's more-info settings", () => {
    const more = heard("hass-more-info");
    el._onSettings();
    expect(more).not.toHaveBeenCalled();
    el.selected = "person.ben";
    el._onSettings();
    expect(more).toHaveBeenCalledWith({ entityId: "person.ben", view: "settings" });
  });
  it("directions open a map app for a located selection only", () => {
    const open = jest.fn();
    globalThis.open = open;
    el.selected = "person.ben";
    el._onDirections();
    expect(open.mock.calls[0][0]).toMatch(/1,2|1%2C2/);
    expect(open.mock.calls[0].slice(1)).toEqual(["_blank", "noreferrer"]);
    hass.states["person.ben"].attributes = {};
    el._onDirections();
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("a tab that has gone is replaced by the first that has items", () => {
    const tab = heard("ltmc-overview-tab");
    el.tab = "devices";
    el.entityIds = ["person.ana"];
    el.updated(new Map());
    expect(tab).toHaveBeenCalledWith({ tab: "people" });
  });
});

describe("the sheet's drag", () => {
  beforeEach(() => {
    el._stops = () => [{ position: "collapsed", height: 80 }, { position: "half", height: 370 }, { position: "full", height: 690 }];
  });
  const drag = (startHeight, y0, y1, ms) => {
    Date.now.mockReturnValue(NOW);
    el._startDrag(y0);
    el._drag.startHeight = startHeight;
    Date.now.mockReturnValue(NOW + ms);
    el._moveDrag(y1);
    el._endDrag();
    return el._position;
  };
  it("a slow drag settles on the nearest stop", () => {
    expect(drag(370, 400, 120, 1000)).toBe("full");
    expect(drag(370, 400, 600, 1000)).toBe("collapsed");
    expect(drag(370, 400, 450, 1000)).toBe("half");
  });
  it("a quick swipe goes on to the next stop its way", () => {
    expect(drag(370, 400, 360, 50)).toBe("full");
    expect(drag(370, 400, 440, 50)).toBe("collapsed");
  });
  it("never drags below the lowest stop", () => {
    el._startDrag(100);
    el._drag.startHeight = 120;
    el._moveDrag(400);
    expect(el._dragHeight).toBe(80);
  });
  it("letting go clears the drag height", () => {
    drag(370, 400, 300, 1000);
    expect(el._dragHeight).toBeUndefined();
    expect(el._drag).toBeNull();
  });
  it("a touch on the handle drags at once; a touch on the content waits for 4 px and a vertical move", () => {
    const handle = { classList: { contains: (c) => c === "handle" } };
    const pd = jest.fn();
    el._onTouchStart({ touches: [{ clientX: 10, clientY: 500 }], composedPath: () => [handle], preventDefault: pd });
    expect(pd).toHaveBeenCalled();
    expect(el._drag).not.toBeNull();
    el._onTouchEnd();
    el._onTouchStart({ touches: [{ clientX: 10, clientY: 500 }], composedPath: () => [] });
    expect(el._drag).toBeNull();
    el._onTouchMove({ touches: [{ clientX: 11, clientY: 502 }], cancelable: true, preventDefault: jest.fn() });
    expect(el._drag).toBeNull();
    el._onTouchMove({ touches: [{ clientX: 30, clientY: 505 }], cancelable: true, preventDefault: jest.fn() });
    expect(el._drag).toBeNull();
    el._onTouchStart({ touches: [{ clientX: 10, clientY: 500 }], composedPath: () => [] });
    el._onTouchMove({ touches: [{ clientX: 10, clientY: 480 }], cancelable: true, preventDefault: jest.fn() });
    expect(el._drag).not.toBeNull();
  });
  it("at full height, scrolling up stays with the content", () => {
    el._position = "full";
    el._onTouchStart({ touches: [{ clientX: 10, clientY: 500 }], composedPath: () => [] });
    el._onTouchMove({ touches: [{ clientX: 10, clientY: 480 }], cancelable: true, preventDefault: jest.fn() });
    expect(el._drag).toBeNull();
  });
  it("two fingers do nothing", () => {
    el._onTouchStart({ touches: [{}, {}], composedPath: () => [] });
    expect(el._pendingTouch).toBeNull();
  });
});
