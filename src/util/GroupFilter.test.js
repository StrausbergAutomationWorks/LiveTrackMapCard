import { groupKey, readHidden, writeHidden, hasStoredChoice, GroupFilter, STORAGE_KEY, GROUPS_EVENT,
  prettify, summarize, toggled, applyStartHidden } from "./GroupFilter.js";

const SHIP = (group) => ({ source: "live_track_ships", marker_group: group });

beforeEach(() => window.localStorage.clear());

describe("groupKey", () => {
  test("source and group", () => {
    expect(groupKey(SHIP("cargo"))).toBe("live_track_ships:cargo");
  });
  test.each([
    [undefined], [null], [{}], [{ source: "live_track_ships" }], [{ marker_group: "cargo" }],
    [{ source: "", marker_group: "cargo" }], [{ source: "x", marker_group: "" }],
    [{ source: "x", marker_group: 3 }], [{ source: 7, marker_group: "cargo" }],
  ])("no key for %p", (a) => {
    expect(groupKey(a)).toBeNull();
  });
});

describe("storage", () => {
  test("nothing stored: nothing hidden, no choice", () => {
    expect(readHidden().size).toBe(0);
    expect(hasStoredChoice()).toBe(false);
  });
  test("write then read, sorted and unique", () => {
    expect(writeHidden(["b:x", "a:y", "b:x"])).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('["a:y","b:x"]');
    expect([...readHidden()]).toEqual(["a:y", "b:x"]);
    expect(hasStoredChoice()).toBe(true);
  });
  test("\"show everything\" is stored as [] and still counts as a choice", () => {
    writeHidden(["a:y"]);
    writeHidden([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("[]");
    expect(readHidden().size).toBe(0);
    expect(hasStoredChoice()).toBe(true);
  });
  test("garbage stored reads as nothing hidden", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readHidden().size).toBe(0);
    window.localStorage.setItem(STORAGE_KEY, '{"a":1}');
    expect(readHidden().size).toBe(0);
    window.localStorage.setItem(STORAGE_KEY, '["a:y", 5, null]');
    expect([...readHidden()]).toEqual(["a:y"]);
  });
  test("storage that throws: nothing hidden, write reports failure but still tells the page", () => {
    const fake = {
      get localStorage() { throw new Error("sandboxed"); },
      dispatchEvent: jest.fn(),
    };
    expect(readHidden(fake).size).toBe(0);
    expect(writeHidden(["a:y"], fake)).toBe(false);
    expect(fake.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(hasStoredChoice(fake)).toBe(false);
  });
  test("setItem refused (quota): false", () => {
    const fake = {
      localStorage: { setItem() { throw new Error("quota"); }, getItem: () => null, removeItem() {} },
      dispatchEvent() {},
    };
    expect(writeHidden(["a:y"], fake)).toBe(false);
  });
  test("a write dispatches the page event with the list", () => {
    const seen = [];
    const h = (e) => seen.push(e.detail.hidden);
    window.addEventListener(GROUPS_EVENT, h);
    writeHidden(["z:1", "a:2"]);
    window.removeEventListener(GROUPS_EVENT, h);
    expect(seen).toEqual([["a:2", "z:1"]]);
  });
});

describe("GroupFilter", () => {
  test("hides only the stored groups of the stored source", () => {
    writeHidden(["live_track_ships:pleasure"]);
    const f = new GroupFilter();
    expect(f.hides(SHIP("pleasure"))).toBe(true);
    expect(f.hides(SHIP("cargo"))).toBe(false);
    expect(f.hides({ source: "live_track_aircraft", marker_group: "pleasure" })).toBe(false);
    expect(f.hides({ source: "live_track_ships" })).toBe(false);
    expect(f.hides(undefined)).toBe(false);
    f.dispose();
  });
  test("follows a write on the same page and calls back once per real change", () => {
    const cb = jest.fn();
    const f = new GroupFilter(cb);
    writeHidden(["live_track_ships:cargo"]);
    expect(f.hides(SHIP("cargo"))).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    writeHidden(["live_track_ships:cargo"]);            // same set: no callback
    expect(cb).toHaveBeenCalledTimes(1);
    writeHidden([]);
    expect(f.hides(SHIP("cargo"))).toBe(false);
    expect(cb).toHaveBeenCalledTimes(2);
    f.dispose();
  });
  test("follows another page's write (storage event), ignores other keys", () => {
    const cb = jest.fn();
    const f = new GroupFilter(cb);
    window.localStorage.setItem(STORAGE_KEY, '["live_track_ships:fishing"]');
    window.dispatchEvent(new StorageEvent("storage", { key: "something-else" }));
    expect(cb).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect(f.hides(SHIP("fishing"))).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));   // clear() sends key null
    expect(f.hides(SHIP("fishing"))).toBe(false);
    f.dispose();
  });
  test("after dispose it no longer follows", () => {
    const cb = jest.fn();
    const f = new GroupFilter(cb);
    f.dispose();
    writeHidden(["live_track_ships:cargo"]);
    expect(cb).not.toHaveBeenCalled();
    expect(f.hides(SHIP("cargo"))).toBe(false);
  });
  test("a callback that throws does not stop the filter", () => {
    const f = new GroupFilter(() => { throw new Error("boom"); });
    expect(() => writeHidden(["live_track_ships:cargo"])).not.toThrow();
    expect(f.hides(SHIP("cargo"))).toBe(true);
    f.dispose();
  });
});

// ---------------------------------------------------------------- the filter card's logic

const vessel = (n, group, label, order, state = "3.2") => [`geo_location.vessel_${n}`, {
  state, attributes: { source: "live_track_ships", marker_group: group, marker_group_label: label, marker_group_order: order },
}];
const STATES = Object.fromEntries([
  vessel(1, "cargo", "Cargo", 1), vessel(2, "cargo", "Cargo", 1),
  vessel(3, "tanker", "Tanker", 2), vessel(4, "pleasure", "Pleasure and sailing", 5),
  vessel(9, "cargo", "Cargo", 1, "unavailable"),
  ["geo_location.aircraft_abc", { state: "1", attributes: { source: "live_track_aircraft" } }],
  ["sensor.ships_in_range", { state: "4", attributes: { source: "live_track_ships", marker_group: "cargo" } }],
  ["geo_location.train_1", { state: "2", attributes: { source: "live_track_commuter_rail", marker_group: "metra" } }],
]);
const flat = (summary) => summary.map((s) => [s.title, s.groups.map((g) => [g.label, g.count])]);

describe("prettify", () => {
  test("a source", () => expect(prettify("live_track_ships")).toBe("Live Track Ships"));
  test("a key", () => expect(prettify("type_unknown")).toBe("Type unknown"));
  test("empty", () => expect(prettify(undefined)).toBe(""));
});

describe("summarize", () => {
  test("by source, in the integration's order, counted; only geo_location that is not unavailable", () => {
    expect(flat(summarize(STATES, new Set()))).toEqual([
      ["Live Track Commuter Rail", [["Metra", 1]]],
      ["Live Track Ships", [["Cargo", 2], ["Tanker", 1], ["Pleasure and sailing", 1]]],
    ]);
  });
  test("keys are source:group", () => {
    const ships = summarize(STATES, new Set()).find((s) => s.source === "live_track_ships");
    expect(ships.groups.map((g) => g.key)).toEqual(["live_track_ships:cargo", "live_track_ships:tanker", "live_track_ships:pleasure"]);
  });
  test("a hidden group with nothing on the map stays listed with 0, after the ordered ones", () => {
    const ships = summarize(STATES, new Set(["live_track_ships:fishing"])).find((s) => s.source === "live_track_ships");
    expect(ships.groups.at(-1)).toMatchObject({ label: "Fishing", count: 0, key: "live_track_ships:fishing" });
  });
  test("a hidden group that is on the map is counted once, with its label", () => {
    const ships = summarize(STATES, new Set(["live_track_ships:tanker"])).find((s) => s.source === "live_track_ships");
    expect(ships.groups.filter((g) => g.group === "tanker")).toEqual([
      { key: "live_track_ships:tanker", group: "tanker", label: "Tanker", order: 2, count: 1 }]);
  });
  test("sources limits the list", () => {
    expect(flat(summarize(STATES, new Set(["live_track_ships:fishing"]), ["live_track_commuter_rail"])))
      .toEqual([["Live Track Commuter Rail", [["Metra", 1]]]]);
  });
  test("no label: the key, prettified; no order: by label after the ordered ones", () => {
    const s = summarize(Object.fromEntries([
      ["geo_location.a", { state: "1", attributes: { source: "x", marker_group: "zed_group" } }],
      ["geo_location.b", { state: "1", attributes: { source: "x", marker_group: "alpha", marker_group_order: 3 } }],
      ["geo_location.c", { state: "1", attributes: { source: "x", marker_group: "beta" } }],
    ]), new Set());
    expect(s[0].groups.map((g) => g.label)).toEqual(["Alpha", "Beta", "Zed group"]);
  });
  test("no states: nothing", () => {
    expect(summarize(undefined, new Set())).toEqual([]);
  });
});

describe("toggled", () => {
  test("hide and show", () => {
    const h = toggled(new Set(["a:1"]), ["a:2", "a:3"], true);
    expect([...h].sort()).toEqual(["a:1", "a:2", "a:3"]);
    expect([...toggled(h, ["a:1", "a:2"], false)]).toEqual(["a:3"]);
  });
  test("does not change the set it was given", () => {
    const h = new Set(["a:1"]);
    toggled(h, ["a:1"], false);
    expect(h.has("a:1")).toBe(true);
  });
});

describe("applyStartHidden", () => {
  test("applies in a browser that never chose", () => {
    expect(applyStartHidden(["live_track_ships:pleasure", "bad", 5])).toBe(true);
    expect([...readHidden()]).toEqual(["live_track_ships:pleasure"]);
  });
  test("never over a stored choice, \"show everything\" included", () => {
    writeHidden([]);
    expect(applyStartHidden(["live_track_ships:pleasure"])).toBe(false);
    expect(readHidden().size).toBe(0);
  });
  test("nothing usable: nothing written", () => {
    expect(applyStartHidden(undefined)).toBe(false);
    expect(applyStartHidden([":x", "nokey"])).toBe(false);
    expect(hasStoredChoice()).toBe(false);
  });
});
