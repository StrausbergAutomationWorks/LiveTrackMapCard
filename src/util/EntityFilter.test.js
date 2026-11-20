import { describe, expect, it } from "@jest/globals";
import EntityFilter, { parseEntityFilter, textMatcher, matchRule, metresBetween } from "./EntityFilter.js";

// Made-up entities, positions in Lisbon (nowhere near anyone's home).
const st = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
const plane = (id, extra = {}) => st(id, "12.3", { source: "live_track_aircraft", latitude: 38.77, longitude: -9.13, ...extra });
const train = (id, extra = {}) => st(id, "4.1", { source: "live_track_intercity_rail", latitude: 38.71, longitude: -9.12, ...extra });

// railair-map's rules, shortened options (the shape Lee approved 2026-11-20).
const RAILAIR = {
  include: [
    { attributes: { source: "live_track_aircraft" }, options: { size: 60, color: "transparent" } },
    { attributes: { source: "live_track_salt" }, options: { size: 60 } },
    { attributes: { source: "live_track_intercity_rail", operator: "brightline" }, options: { size: 28 } },
    { attributes: { source: "live_track_ships" }, options: { size: 60 } },
    { attributes: { source: "live_track_intercity_rail" }, options: { size: 46 } },
    { domain: "geo_location", not: { attributes: { source: "live_track_aircraft" } }, options: { size: 28 } },
    { domain: "person", options: { size: 44, position_transition: "auto" } },
    { entity_id: "zone.home", options: { size: 36 } },
    { domain: "device_tracker", has_position: true, away_from_person_m: 100, not: { state: "unknown" }, options: { size: 44, position_transition: "auto" } },
  ],
  exclude: [{ state: "unavailable" }],
};

const run = (spec, states) => {
  const f = new EntityFilter(parseEntityFilter(spec));
  f.update(states);
  return f;
};
const ids = (f) => f.entries().map((e) => e.entity);
const byId = (f) => Object.fromEntries(f.entries().map((e) => [e.entity, e]));

describe("textMatcher: auto-entities' forms", () => {
  it("exact", () => {
    const m = textMatcher("geo_location", "x");
    expect(m("geo_location")).toBe(true);
    expect(m("geo_locations")).toBe(false);
    expect(m("xgeo_location")).toBe(false);
  });
  it("* wildcard, anchored, other characters literal", () => {
    const m = textMatcher("sensor.a.*_b", "x");
    expect(m("sensor.a.1_b")).toBe(true);
    expect(m("sensor.a._b")).toBe(true);
    expect(m("sensor.aX1_b")).toBe(false);
    expect(m("sensor.a.1_bc")).toBe(false);
    expect(m("zsensor.a.1_b")).toBe(false);
  });
  it("/regex/ with flags", () => {
    expect(textMatcher("/^live_track_/", "x")("live_track_ships")).toBe(true);
    expect(textMatcher("/^live_track_/", "x")("x_live_track_ships")).toBe(false);
    expect(textMatcher("/SHIPS$/i", "x")("live_track_ships")).toBe(true);
  });
  it("numbers and booleans as their text", () => {
    expect(textMatcher(5, "x")("5")).toBe(true);
    expect(textMatcher(true, "x")("true")).toBe(true);
  });
  it("refuses anything else", () => {
    expect(() => textMatcher({ a: 1 }, "include[0].state")).toThrow(/include\[0\]\.state/);
    expect(() => textMatcher(null, "x")).toThrow();
    expect(() => textMatcher("/(/", "x")).toThrow(/regex/);
  });
});

describe("parseEntityFilter", () => {
  it("absent is null", () => {
    expect(parseEntityFilter(undefined)).toBeNull();
    expect(parseEntityFilter(null)).toBeNull();
  });
  it("railair-map's rules parse", () => {
    const p = parseEntityFilter(RAILAIR);
    expect(p.include).toHaveLength(9);
    expect(p.exclude).toHaveLength(1);
    expect(p.usesPersons).toBe(true);
  });
  it("usesPersons only with away_from_person_m, also inside not", () => {
    expect(parseEntityFilter({ include: [{ domain: "person" }] }).usesPersons).toBe(false);
    expect(parseEntityFilter({ include: [{ domain: "x", not: { away_from_person_m: 5 } }] }).usesPersons).toBe(true);
    expect(parseEntityFilter({ include: [{ domain: "x" }], exclude: [{ away_from_person_m: 5 }] }).usesPersons).toBe(true);
  });
  it.each([
    ["a list", []],
    ["text", "geo_location"],
    ["an unknown top key", { include: [{ domain: "a" }], sort: { method: "state" } }],
    ["no include", { exclude: [{ state: "unavailable" }] }],
    ["an empty include", { include: [] }],
    ["include not a list", { include: { domain: "a" } }],
    ["exclude not a list", { include: [{ domain: "a" }], exclude: { state: "x" } }],
    ["a rule that is text", { include: ["geo_location"] }],
    ["an unknown rule key", { include: [{ area: "kitchen" }] }],
    ["an unknown key inside not", { include: [{ domain: "a", not: { label: "x" } }] }],
    ["options on an exclude rule", { include: [{ domain: "a" }], exclude: [{ state: "x", options: { size: 1 } }] }],
    ["options inside not", { include: [{ domain: "a", not: { state: "x", options: {} } }] }],
    ["options not a mapping", { include: [{ domain: "a", options: [1] }] }],
    ["attributes not a mapping", { include: [{ attributes: ["source"] }] }],
    ["has_position not boolean", { include: [{ has_position: "yes" }] }],
    ["away_from_person_m zero", { include: [{ away_from_person_m: 0 }] }],
    ["away_from_person_m text", { include: [{ away_from_person_m: "100" }] }],
    ["away_from_person_m infinite", { include: [{ away_from_person_m: Infinity }] }],
  ])("refuses %s", (_, raw) => {
    expect(() => parseEntityFilter(raw)).toThrow(/entity_filter/);
  });
  it("names the unsupported key and the rule", () => {
    expect(() => parseEntityFilter({ include: [{ domain: "a" }, { area: "kitchen" }] })).toThrow(/include\[1\] has "area"/);
  });
});

describe("matchRule", () => {
  const p = parseEntityFilter(RAILAIR);
  const rule = (i) => p.include[i];
  it("attributes must all match, a missing one matches nothing", () => {
    const bl = train("geo_location.bl_1", { operator: "brightline" });
    expect(matchRule(rule(2), bl.entity_id, bl, {}, new Map())).toBe(true);
    const amtrak = train("geo_location.am_1", { operator: "amtrak" });
    expect(matchRule(rule(2), amtrak.entity_id, amtrak, {}, new Map())).toBe(false);
    const none = train("geo_location.x_1");
    expect(matchRule(rule(2), none.entity_id, none, {}, new Map())).toBe(false);
  });
  it("not: matches when its rule does not; a missing attribute is not a match", () => {
    const ship = st("geo_location.ship_1", "3", { source: "live_track_ships" });
    const anon = st("geo_location.quake_1", "3", {});
    const pl = plane("geo_location.pl_1");
    expect(matchRule(rule(5), ship.entity_id, ship, {}, new Map())).toBe(true);
    expect(matchRule(rule(5), anon.entity_id, anon, {}, new Map())).toBe(true);
    expect(matchRule(rule(5), pl.entity_id, pl, {}, new Map())).toBe(false);
  });
  it("domain is the part before the first dot", () => {
    const pers = st("person.ana_lopez", "not_home", {});
    expect(matchRule(rule(6), pers.entity_id, pers, {}, new Map())).toBe(true);
    const dotted = st("person.ana.lopez", "not_home", {});
    expect(matchRule(rule(6), dotted.entity_id, dotted, {}, new Map())).toBe(true);
    const ppl = st("persons.x", "home", {});
    expect(matchRule(rule(6), ppl.entity_id, ppl, {}, new Map())).toBe(false);
  });
  it("has_position true and false", () => {
    const r = parseEntityFilter({ include: [{ has_position: true }, { has_position: false }] }).include;
    const placed = st("device_tracker.bens_ipad", "away", { latitude: 38.7, longitude: -9.1 });
    const textual = st("device_tracker.bens_ipad", "away", { latitude: "38.7", longitude: -9.1 });
    const nan = st("device_tracker.bens_ipad", "away", { latitude: NaN, longitude: -9.1 });
    const lonOnly = st("device_tracker.bens_ipad", "away", { longitude: -9.1 });
    const latOnly = st("device_tracker.bens_ipad", "away", { latitude: 38.7 });
    const lonText = st("device_tracker.bens_ipad", "away", { latitude: 38.7, longitude: "-9.1" });
    expect(matchRule(r[0], latOnly.entity_id, latOnly, {}, new Map())).toBe(false);
    expect(matchRule(r[0], lonText.entity_id, lonText, {}, new Map())).toBe(false);
    expect(matchRule(r[0], placed.entity_id, placed, {}, new Map())).toBe(true);
    expect(matchRule(r[0], textual.entity_id, textual, {}, new Map())).toBe(false);
    expect(matchRule(r[0], nan.entity_id, nan, {}, new Map())).toBe(false);
    expect(matchRule(r[0], lonOnly.entity_id, lonOnly, {}, new Map())).toBe(false);
    expect(matchRule(r[1], lonOnly.entity_id, lonOnly, {}, new Map())).toBe(true);
    expect(matchRule(r[1], placed.entity_id, placed, {}, new Map())).toBe(false);
  });
  it("state matches as text", () => {
    const r = parseEntityFilter({ include: [{ state: "12.5" }] }).include[0];
    expect(matchRule(r, "geo_location.a", st("geo_location.a", 12.5), {}, new Map())).toBe(true);
  });
});

describe("metresBetween", () => {
  it("one degree of latitude is about 111 km; zero is zero", () => {
    expect(metresBetween(38, -9, 39, -9)).toBeGreaterThan(111000);
    expect(metresBetween(38, -9, 39, -9)).toBeLessThan(111400);
    expect(metresBetween(38.7, -9.1, 38.7, -9.1)).toBe(0);
  });
  it("about 100 m east at 38.7 N", () => {
    const d = metresBetween(38.7, -9.1, 38.7, -9.1 + 0.00115);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe("EntityFilter on railair-map's rules", () => {
  const states = () => ({
    "geo_location.pl_1": plane("geo_location.pl_1"),
    "geo_location.salt_1": st("geo_location.salt_1", "8", { source: "live_track_salt" }),
    "geo_location.bl_1": train("geo_location.bl_1", { operator: "brightline" }),
    "geo_location.am_1": train("geo_location.am_1", { operator: "amtrak" }),
    "geo_location.ship_1": st("geo_location.ship_1", "2", { source: "live_track_ships" }),
    "geo_location.metra_1": st("geo_location.metra_1", "9", { source: "live_track_commuter_rail" }),
    "geo_location.gone_1": st("geo_location.gone_1", "unavailable", {}),
    "geo_location.gone_pl": plane("geo_location.gone_pl", {}),
    "person.ana_lopez": st("person.ana_lopez", "not_home", { latitude: 38.7, longitude: -9.1, device_trackers: ["device_tracker.ana_phone"] }),
    "person.ben": st("person.ben", "unavailable", {}),
    "zone.home": st("zone.home", "0", { latitude: 38.6, longitude: -9.2 }),
    "zone.work": st("zone.work", "0", { latitude: 38.65, longitude: -9.2 }),
    "device_tracker.ana_phone": st("device_tracker.ana_phone", "not_home", { latitude: 38.7, longitude: -9.1 + 0.0005 }),
    "device_tracker.bens_ipad": st("device_tracker.bens_ipad", "not_home", { latitude: 38.8, longitude: -9.0 }),
    "device_tracker.router": st("device_tracker.router", "home", {}),
    "device_tracker.lost": st("device_tracker.lost", "unknown", { latitude: 38.8, longitude: -9.0 }),
    "sensor.temp": st("sensor.temp", "21", {}),
  });
  const s0 = states();
  s0["geo_location.gone_pl"] = { ...s0["geo_location.gone_pl"], state: "unavailable" };

  it("first match wins, with that rule's options", () => {
    const f = run(RAILAIR, s0);
    const e = byId(f);
    expect(e["geo_location.pl_1"]).toEqual({ entity: "geo_location.pl_1", size: 60, color: "transparent" });
    expect(e["geo_location.salt_1"].size).toBe(60);
    expect(e["geo_location.bl_1"].size).toBe(28);
    expect(e["geo_location.am_1"].size).toBe(46);
    expect(e["geo_location.ship_1"].size).toBe(60);
    expect(e["geo_location.metra_1"].size).toBe(28);
    expect(e["person.ana_lopez"]).toEqual({ entity: "person.ana_lopez", size: 44, position_transition: "auto" });
    expect(e["zone.home"].size).toBe(36);
    expect(e["device_tracker.bens_ipad"].size).toBe(44);
  });
  it("leaves out what the rules leave out", () => {
    const got = ids(run(RAILAIR, s0));
    for (const out of ["geo_location.gone_1", "geo_location.gone_pl", "person.ben", "zone.work",
      "device_tracker.ana_phone", "device_tracker.router", "device_tracker.lost", "sensor.temp"]) {
      expect(got).not.toContain(out);
    }
    expect(got).toHaveLength(9);
  });
  it("is in rule order, then entity id", () => {
    expect(ids(run(RAILAIR, s0))).toEqual([
      "geo_location.pl_1", "geo_location.salt_1", "geo_location.bl_1", "geo_location.ship_1",
      "geo_location.am_1", "geo_location.metra_1", "person.ana_lopez", "zone.home", "device_tracker.bens_ipad",
    ]);
  });
  it("an entry's options are a copy; the entity id cannot be overridden by options", () => {
    const spec = { include: [{ domain: "geo_location", options: { entity: "geo_location.other", size: 9 } }] };
    const f = run(spec, { "geo_location.a": st("geo_location.a", "1") });
    expect(f.entries()).toEqual([{ entity: "geo_location.a", size: 9 }]);
    f.entries()[0].size = 1;
    expect(parseEntityFilter(spec).include[0].options.size).toBe(9);
  });
});

describe("EntityFilter: incremental", () => {
  const base = () => ({
    "geo_location.pl_1": plane("geo_location.pl_1"),
    "geo_location.am_1": train("geo_location.am_1"),
  });

  it("the same states object: nothing to do", () => {
    const s = base();
    const f = run(RAILAIR, s);
    expect(f.version).toBe(1);
    expect(f.update(s)).toBe(false);
    expect(f.version).toBe(1);
  });
  it("the same states object is not looked through again", () => {
    const s = base();
    const f = run(RAILAIR, s);
    let calls = 0, scans = 0;
    const orig = f._ruleFor.bind(f);
    f._ruleFor = (...a) => { calls++; return orig(...a); };
    const origP = f._personsChanged.bind(f);
    f._personsChanged = (...a) => { scans++; return origP(...a); };
    f.update(s);
    expect(calls).toBe(0);
    expect(scans).toBe(0);
    f.update({ ...s, "geo_location.pl_1": plane("geo_location.pl_1", { latitude: 38.8 }) });
    expect(calls).toBe(1);
  });
  it("a moving entity (new state object, same rule) changes nothing; entries keep their objects", () => {
    const s = base();
    const f = run(RAILAIR, s);
    const before = f.entries();
    const s2 = { ...s, "geo_location.pl_1": plane("geo_location.pl_1", { latitude: 38.8 }) };
    expect(f.update(s2)).toBe(false);
    expect(f.version).toBe(1);
    expect(f.entries()).toBe(before);
    expect(f.entries()[0]).toBe(before[0]);
  });
  it("an arrival, a departure and a rule switch each change the list", () => {
    const s = base();
    const f = run(RAILAIR, s);
    const s2 = { ...s, "geo_location.ship_1": st("geo_location.ship_1", "2", { source: "live_track_ships" }) };
    expect(f.update(s2)).toBe(true);
    expect(ids(f)).toContain("geo_location.ship_1");
    const s3 = { ...s2 };
    delete s3["geo_location.pl_1"];
    expect(f.update(s3)).toBe(true);
    expect(ids(f)).not.toContain("geo_location.pl_1");
    const s4 = { ...s3, "geo_location.am_1": train("geo_location.am_1", { operator: "brightline" }) };
    expect(f.update(s4)).toBe(true);
    expect(byId(f)["geo_location.am_1"].size).toBe(28);
    expect(f.version).toBe(4);
  });
  it("an entity going unavailable leaves, and comes back", () => {
    const s = base();
    const f = run(RAILAIR, s);
    const s2 = { ...s, "geo_location.am_1": { ...s["geo_location.am_1"], state: "unavailable" } };
    expect(f.update(s2)).toBe(true);
    expect(ids(f)).toEqual(["geo_location.pl_1"]);
    const s3 = { ...s2, "geo_location.am_1": train("geo_location.am_1") };
    expect(f.update(s3)).toBe(true);
    expect(ids(f)).toEqual(["geo_location.pl_1", "geo_location.am_1"]);
  });
  it("a new entity nothing matches is no change; its departure is no change either", () => {
    const s = base();
    const f = run(RAILAIR, s);
    const s2 = { ...s, "sensor.x": st("sensor.x", "1") };
    expect(f.update(s2)).toBe(false);
    expect(f.update({ ...s })).toBe(false);
    expect(f.version).toBe(1);
  });
});

describe("EntityFilter: away_from_person_m", () => {
  // Ana carries her phone; Ben's iPad is his own (carried by Ben, who is elsewhere).
  const at = (lon) => ({ latitude: 38.7, longitude: lon });
  const world = (phoneLon, anaLon = -9.1, trackers = ["device_tracker.ana_phone"]) => ({
    "person.ana_lopez": st("person.ana_lopez", "not_home", { ...at(anaLon), device_trackers: trackers }),
    "device_tracker.ana_phone": st("device_tracker.ana_phone", "not_home", at(phoneLon)),
  });
  const spec = { include: [{ domain: "device_tracker", has_position: true, away_from_person_m: 100 }] };

  it("left out within 100 m of the person carrying it, drawn beyond", () => {
    expect(ids(run(spec, world(-9.1 + 0.0005)))).toEqual([]);
    expect(ids(run(spec, world(-9.1 + 0.0020)))).toEqual(["device_tracker.ana_phone"]);
  });
  it("a person without a position carries nothing", () => {
    const w = world(-9.1);
    w["person.ana_lopez"] = st("person.ana_lopez", "unknown", { device_trackers: ["device_tracker.ana_phone"] });
    expect(ids(run(spec, w))).toEqual(["device_tracker.ana_phone"]);
  });
  it("a tracker nobody lists is always drawn", () => {
    expect(ids(run(spec, world(-9.1, -9.1, [])))).toEqual(["device_tracker.ana_phone"]);
  });
  it("the PERSON moving away brings the tracker back, though the tracker's state did not change", () => {
    const s = world(-9.1);
    const f = run(spec, s);
    expect(ids(f)).toEqual([]);
    const s2 = { ...s, "person.ana_lopez": st("person.ana_lopez", "not_home", { ...at(-9.05), device_trackers: ["device_tracker.ana_phone"] }) };
    expect(f.update(s2)).toBe(true);
    expect(ids(f)).toEqual(["device_tracker.ana_phone"]);
  });
  it("the person starting to list a nearby tracker takes it off, though the tracker's state did not change", () => {
    const s = world(-9.1, -9.1, []);
    const f = run(spec, s);
    expect(ids(f)).toEqual(["device_tracker.ana_phone"]);
    const s2 = { ...s, "person.ana_lopez": st("person.ana_lopez", "not_home", { ...at(-9.1), device_trackers: ["device_tracker.ana_phone"] }) };
    expect(f.update(s2)).toBe(true);
    expect(ids(f)).toEqual([]);
  });
  it("a tracker whose coordinates are not numbers is never counted as carried", () => {
    const w = world(-9.1);
    w["device_tracker.ana_phone"] = st("device_tracker.ana_phone", "not_home", { latitude: "38.7", longitude: "-9.1" });
    const loose = { include: [{ domain: "device_tracker", away_from_person_m: 100 }] };
    expect(ids(run(loose, w))).toEqual(["device_tracker.ana_phone"]);
  });
  it("the person dropping the tracker from its list brings it back", () => {
    const s = world(-9.1);
    const f = run(spec, s);
    const s2 = { ...s, "person.ana_lopez": st("person.ana_lopez", "not_home", { ...at(-9.1), device_trackers: [] }) };
    expect(f.update(s2)).toBe(true);
    expect(ids(f)).toEqual(["device_tracker.ana_phone"]);
  });
  it("the person leaving Home Assistant brings it back", () => {
    const s = world(-9.1);
    const f = run(spec, s);
    const s2 = { ...s };
    delete s2["person.ana_lopez"];
    expect(f.update(s2)).toBe(true);
    expect(ids(f)).toEqual(["device_tracker.ana_phone"]);
  });
  it("a second person, close, is enough", () => {
    const s = world(-9.0);
    s["person.ben"] = st("person.ben", "not_home", { ...at(-9.0), device_trackers: ["device_tracker.ana_phone"] });
    expect(ids(run(spec, s))).toEqual([]);
  });
  it("without away_from_person_m, persons are not watched", () => {
    const f = new EntityFilter(parseEntityFilter({ include: [{ domain: "device_tracker" }] }));
    f.update(world(-9.1));
    expect(f._persons.size).toBe(0);
  });
});
