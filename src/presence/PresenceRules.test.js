import { describe, expect, it } from "@jest/globals";
import {
  drawnAsPresence, isPresenceDomain, zoneInitials, markerLabel, hashIndex, paletteIndex, paletteVar,
  colorIndex, zoneColorVar, parseColor, contrastingContent, drawnZones, zoneContaining, zoneOf,
  locationOf, groupMarkers, bubbles, staysTogether, bubbleLayout, pinFootprint, mergeOverlapping,
  distanceMeters,
} from "./PresenceRules.js";

// Literals, not the module's constants: a test that imports the value under
// test cannot catch a change to it (card SSOT, 2026-11-19 credits entry).

describe("which entities are drawn the new way", () => {
  it("person, device_tracker and zone only", () => {
    expect(isPresenceDomain("person.ana")).toBe(true);
    expect(isPresenceDomain("device_tracker.ipad")).toBe(true);
    expect(isPresenceDomain("zone.home")).toBe(true);
    expect(isPresenceDomain("geo_location.flight")).toBe(false);
    expect(isPresenceDomain("sensor.x")).toBe(false);
  });
  it("display unset, marker or pill: yes; any other display: no; option off: no", () => {
    expect(drawnAsPresence({ id: "person.a" }, true)).toBe(true);
    expect(drawnAsPresence({ id: "person.a", display: "marker" }, true)).toBe(true);
    expect(drawnAsPresence({ id: "person.a", display: "pill" }, true)).toBe(true);
    expect(drawnAsPresence({ id: "person.a", display: "icon" }, true)).toBe(false);
    expect(drawnAsPresence({ id: "person.a", display: "state" }, true)).toBe(false);
    expect(drawnAsPresence({ id: "person.a" }, false)).toBe(false);
    expect(drawnAsPresence({ id: "geo_location.x" }, true)).toBe(false);
    expect(drawnAsPresence(null, true)).toBe(false);
  });
});

describe("labels", () => {
  it("zone initials: first letter of each word, at most two", () => {
    expect(zoneInitials("Union Station")).toBe("US");
    expect(zoneInitials("Home")).toBe("H");
  });
  it("a pin without a picture: first letter of each word, at most three (Ben's iPad -> Bi)", () => {
    expect(markerLabel("Ben's iPad")).toBe("Bi");
    expect(markerLabel("Ana Lopez")).toBe("AL");
    expect(markerLabel("A B C D")).toBe("ABC");
  });
});

describe("colours", () => {
  it("hash index: djb2 mod 2147483647, seed 5381", () => {
    expect(hashIndex("")).toBe(5381);
    expect(hashIndex("a")).toBe((5381 * 33 + 97) % 2147483647);
    expect(hashIndex("zone.tx")).toBe(hashIndex("zone.tx"));
  });
  it("palette: zones by creation (home excluded), persons then trackers", () => {
    const idx = paletteIndex([
      { entity_id: "zone.b", id: "2", created_at: 20 },
      { entity_id: "zone.home", id: "0", created_at: 1 },
      { entity_id: "zone.a", id: "1", created_at: 10 },
      { entity_id: "device_tracker.t", id: "5", created_at: 1 },
      { entity_id: "person.p", id: "4", created_at: 99 },
      { entity_id: "sensor.s", id: "9", created_at: 0 },
    ]);
    expect(idx.byEntityId["zone.a"]).toBe(0);
    expect(idx.byEntityId["zone.b"]).toBe(1);
    expect(idx.byEntityId["zone.home"]).toBeUndefined();
    expect(idx.byEntityId["person.p"]).toBe(0);
    expect(idx.byEntityId["device_tracker.t"]).toBe(1);
    expect(idx.byEntityId["sensor.s"]).toBeUndefined();
    expect(idx.zoneCount).toBe(2);
  });
  it("palette ties broken by registry id", () => {
    const idx = paletteIndex([{ entity_id: "zone.y", id: "b", created_at: 5 }, { entity_id: "zone.x", id: "a", created_at: 5 }]);
    expect(idx.byEntityId["zone.x"]).toBe(0);
    expect(idx.byEntityId["zone.y"]).toBe(1);
  });
  it("palette var wraps at 54", () => {
    expect(paletteVar(0)).toBe("--color-1");
    expect(paletteVar(53)).toBe("--color-54");
    expect(paletteVar(54)).toBe("--color-1");
  });
  it("a zone with no registry entry takes its hash", () => {
    expect(colorIndex("zone.yaml", { byEntityId: {} })).toBe(hashIndex("zone.yaml"));
    expect(colorIndex("zone.yaml", null)).toBe(hashIndex("zone.yaml"));
    expect(colorIndex("zone.a", { byEntityId: { "zone.a": 3 } })).toBe(3);
  });
  it("home is primary, passive muted, others their slot", () => {
    expect(zoneColorVar("zone.home", false, null)).toBe("--primary-color");
    expect(zoneColorVar("zone.x", true, null)).toBe("--secondary-text-color");
    expect(zoneColorVar("zone.a", false, { byEntityId: { "zone.a": 2 } })).toBe("--color-3");
  });
  it("parses #rgb, #rrggbb, #rrggbbaa and rgb()", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("#03A9F4")).toEqual([3, 169, 244]);
    expect(parseColor("#03a9f480")).toEqual([3, 169, 244]);
    expect(parseColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(parseColor("var(--x)")).toBeNull();
  });
  it("content white while it contrasts 3:1 or more, else black; white when unreadable", () => {
    expect(contrastingContent("#000000")).toBe("#ffffff");
    expect(contrastingContent("#ffffff")).toBe("#000000");
    expect(contrastingContent("#ffeb3b")).toBe("#000000");
    expect(contrastingContent("#3f51b5")).toBe("#ffffff");
    // #949494 is 3.03:1 against white: still white; #999999 is 2.85:1: black
    expect(contrastingContent("#949494")).toBe("#ffffff");
    expect(contrastingContent("#999999")).toBe("#000000");
    expect(contrastingContent("nonsense")).toBe("#ffffff");
  });
});

const zoneState = (lat, lng, extra = {}) => ({ state: "0", attributes: { latitude: lat, longitude: lng, radius: 100, friendly_name: "Z", ...extra } });

describe("zones", () => {
  it("draws every non-passive zone with a position", () => {
    const states = {
      "zone.home": zoneState(41.9, -88.0, { icon: "mdi:home", friendly_name: "Home" }),
      "zone.announce": zoneState(41.9, -88.0, { passive: true }),
      "zone.nopos": { state: "0", attributes: { friendly_name: "x" } },
      "person.p": { state: "home", attributes: { latitude: 1, longitude: 2 } },
    };
    const z = drawnZones(states);
    expect(z.map((x) => x.id)).toEqual(["zone.home"]);
    expect(z[0]).toMatchObject({ icon: "mdi:home", name: "Home", radius: 100 });
  });
  it("a zone without radius draws no circle (radius null)", () => {
    expect(drawnZones({ "zone.r": zoneState(1, 2, { radius: 0 }) })[0].radius).toBeNull();
  });
  it("zoneContaining: smallest zone whose radius covers the position within its accuracy", () => {
    const zones = [
      { id: "zone.big", lat: 0, lng: 0, radius: 1000 },
      { id: "zone.small", lat: 0, lng: 0, radius: 100 },
    ];
    expect(zoneContaining({ lat: 0, lng: 0 }, 0, zones)).toBe("zone.small");
    const d150 = { lat: 0.00135, lng: 0 }; // ~150 m north
    expect(Math.round(distanceMeters({ lat: 0, lng: 0 }, d150))).toBe(150);
    expect(zoneContaining(d150, 0, zones)).toBe("zone.big");
    expect(zoneContaining(d150, 60, zones)).toBe("zone.small");
    expect(zoneContaining({ lat: 1, lng: 1 }, 0, zones)).toBeUndefined();
    // the smallest wins whatever the order (the first mutation run had only big-then-small)
    expect(zoneContaining({ lat: 0, lng: 0 }, 0, [zones[1], zones[0]])).toBe("zone.small");
  });
  it("zoneContaining: equal radii, the nearer centre", () => {
    const zones = [{ id: "zone.near", lat: 0, lng: 0, radius: 500 }, { id: "zone.far", lat: 0.001, lng: 0, radius: 500 }];
    expect(zoneContaining({ lat: 0.0001, lng: 0 }, 0, zones)).toBe("zone.near");
    expect(zoneContaining({ lat: 0.0001, lng: 0 }, 0, [zones[1], zones[0]])).toBe("zone.near");
  });
});

describe("which zone a person is in", () => {
  const states = {
    "zone.home": zoneState(41.9, -88.0),
    "zone.announce": zoneState(41.9, -88.0, { passive: true }),
    "zone.unlisted": zoneState(50, 50),
  };
  const zones = drawnZones(states).filter((z) => z.id !== "zone.unlisted");
  it("first active zone of in_zones, if drawn", () => {
    const p = { entity_id: "person.p", state: "home", attributes: { in_zones: ["zone.announce", "zone.home"] } };
    expect(zoneOf(p, { lat: 41.9, lng: -88.0 }, zones, states)).toBe("zone.home");
  });
  it("first active zone not drawn: no zone", () => {
    const p = { entity_id: "person.p", state: "x", attributes: { in_zones: ["zone.unlisted", "zone.home"] } };
    expect(zoneOf(p, { lat: 50, lng: 50 }, zones, states)).toBeUndefined();
  });
  it("no in_zones attribute: by position", () => {
    const p = { entity_id: "device_tracker.t", state: "home", attributes: {} };
    expect(zoneOf(p, { lat: 41.9, lng: -88.0 }, zones, states)).toBe("zone.home");
  });
  it("in_zones empty and away: no zone even inside one", () => {
    const p = { entity_id: "device_tracker.t", state: "not_home", attributes: { in_zones: [] } };
    expect(zoneOf(p, { lat: 41.9, lng: -88.0 }, zones, states)).toBeUndefined();
  });
  it("in_zones empty and not away: by position", () => {
    const p = { entity_id: "device_tracker.t", state: "Somewhere", attributes: { in_zones: [] } };
    expect(zoneOf(p, { lat: 41.9, lng: -88.0 }, zones, states)).toBe("zone.home");
  });
  it("only persons and trackers", () => {
    expect(zoneOf({ entity_id: "geo_location.x", state: "1", attributes: {} }, { lat: 41.9, lng: -88 }, zones, states)).toBeUndefined();
  });
  it("location: own position, else a person's first active zone", () => {
    expect(locationOf({ entity_id: "person.p", attributes: { latitude: 1, longitude: 2, gps_accuracy: 7 } }, states))
      .toEqual({ lat: 1, lng: 2, gpsAccuracy: 7 });
    expect(locationOf({ entity_id: "person.p", attributes: { in_zones: ["zone.announce", "zone.home"] } }, states))
      .toEqual({ lat: 41.9, lng: -88.0, gpsAccuracy: 0 });
    expect(locationOf({ entity_id: "device_tracker.t", attributes: { in_zones: ["zone.home"] } }, states)).toBeNull();
  });
});

const m = (id, x, y, key) => ({ id, x, y, lat: y, lng: x, key });

describe("grouping", () => {
  it("a lone zone occupant still bubbles; a lone free marker does not", () => {
    const g = groupMarkers([m("a", 0, 0, "zone.home"), m("b", 500, 500)]);
    expect(g).toHaveLength(2);
    expect(bubbles(g.find((x) => x.key === "zone.home"))).toBe(true);
    expect(bubbles(g.find((x) => x.key === undefined))).toBe(false);
  });
  it("same-zone members share while they span at most 160 px", () => {
    expect(groupMarkers([m("a", 0, 0, "z"), m("b", 160, 0, "z")])).toHaveLength(1);
    const apart = groupMarkers([m("a", 0, 0, "z"), m("b", 161, 0, "z")]);
    expect(apart).toHaveLength(2);
    expect(apart.every((g) => g.key === undefined)).toBe(true);
  });
  it("free markers merge within 40 px, including into a zone's group", () => {
    expect(groupMarkers([m("a", 0, 0), m("b", 40, 0)])).toHaveLength(1);
    expect(groupMarkers([m("a", 0, 0), m("b", 41, 0)])).toHaveLength(2);
    const g = groupMarkers([m("a", 0, 0, "z"), m("b", 30, 0)]);
    expect(g).toHaveLength(1);
    expect(g[0].key).toBe("z");
  });
  it("centre is the members' mean position", () => {
    expect(groupMarkers([m("a", 0, 0, "z"), m("b", 10, 20, "z")])[0].center).toEqual({ lat: 10, lng: 5 });
  });
  it("stays together at max zoom: keyed within 160, else linked within 40", () => {
    expect(staysTogether([{ x: 0, y: 0 }, { x: 150, y: 0 }], true)).toBe(true);
    expect(staysTogether([{ x: 0, y: 0 }, { x: 150, y: 0 }], false)).toBe(false);
    expect(staysTogether([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }], false)).toBe(true);
  });
});

describe("bubble layout", () => {
  it("one avatar: 32 + 12 padding wide, 32 + 12 + 7 tail high, above a zone by 18 + 2", () => {
    const l = bubbleLayout(1, false, 400, true);
    expect(l).toMatchObject({ shownCount: 1, hidden: 0, more: null, width: 44, height: 51 });
    expect(l.anchor).toEqual([22, 71]);
  });
  it("four avatars fit; five show three and +2", () => {
    expect(bubbleLayout(4, false, 400, true)).toMatchObject({ shownCount: 4, hidden: 0, width: 4 * 32 + 3 * 4 + 12 });
    expect(bubbleLayout(5, false, 400, true)).toMatchObject({ shownCount: 3, hidden: 2, more: "+2", width: 3 * 32 + 2 * 4 + 12 + 28 + 4 });
  });
  it("past 99 hidden: 99+", () => {
    expect(bubbleLayout(150, false, 400, false).more).toBe("99+");
  });
  it("not keyed: hangs 9 px above the members (gap 4 + half the 10 px dot)", () => {
    expect(bubbleLayout(2, false, 400, false).anchor[1]).toBe(51 + 9);
  });
  it("expanded: every member, rows wrapping to the map less 12 px margins", () => {
    const l = bubbleLayout(10, true, 200, true);
    // per row: floor((200 - 24 - 12 + 4) / 36) = 4
    expect(l).toMatchObject({ shownCount: 10, hidden: 0, columns: 4, rows: 3 });
    expect(l.height).toBe(3 * 32 + 2 * 4 + 12 + 7);
  });
  it("pin: 48 frame, 8 tail reach, 4 gap, 10 dot; stands on the dot's centre", () => {
    expect(pinFootprint(48)).toEqual({ size: [48, 70], anchor: [24, 65] });
  });
});

describe("merging overlapping bubbles", () => {
  const rect = (g) => ({ left: g.x, top: 0, right: g.x + 50, bottom: 50 });
  it("overlapping bubbles merge; two keys give an unkeyed bubble", () => {
    const a = { members: [{ id: "a", lat: 0, lng: 0 }], key: "z1", x: 0 };
    const b = { members: [{ id: "b", lat: 0, lng: 2 }], key: "z2", x: 30 };
    const out = mergeOverlapping([a, b], (g) => rect(g.x === undefined ? { x: 10 } : g));
    expect(out).toHaveLength(1);
    expect(out[0].key).toBeUndefined();
    expect(out[0].members.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(out[0].center).toEqual({ lat: 0, lng: 1 });
  });
  it("one key survives a merge with an unkeyed bubble", () => {
    const a = { members: [{ id: "a", lat: 0, lng: 0 }], key: "z1", x: 0 };
    const b = { members: [{ id: "b", lat: 0, lng: 0 }, { id: "c", lat: 0, lng: 0 }], x: 30 };
    expect(mergeOverlapping([a, b], (g) => rect(g.x === undefined ? { x: 500 } : g))[0].key).toBe("z1");
  });
  it("touching edges do not merge; lone pins never merge", () => {
    const a = { members: [{ id: "a", lat: 0, lng: 0 }], key: "z1", x: 0 };
    const b = { members: [{ id: "b", lat: 0, lng: 0 }], key: "z2", x: 50 };
    expect(mergeOverlapping([a, b], rect)).toHaveLength(2);
    const pin = { members: [{ id: "p", lat: 0, lng: 0 }], x: 10 };
    expect(mergeOverlapping([a, pin], rect)).toHaveLength(2);
  });
});
