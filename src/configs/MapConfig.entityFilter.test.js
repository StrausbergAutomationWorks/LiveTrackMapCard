import { describe, expect, it } from "@jest/globals";
import MapConfig from "./MapConfig.js";

describe("MapConfig: entity_filter (Lee 2026-11-20)", () => {
  const filter = { include: [{ domain: "geo_location", options: { size: 28 } }] };

  it("absent: no filter, entities as before", () => {
    const c = new MapConfig({ x: 38.7, y: -9.1, entities: ["geo_location.a"] });
    expect(c.entityFilter).toBeNull();
    expect(c.entities.map((e) => e.id)).toEqual(["geo_location.a"]);
  });
  it("parsed; a malformed one is refused like any invalid config", () => {
    expect(new MapConfig({ x: 38.7, y: -9.1, entity_filter: filter }).entityFilter.include).toHaveLength(1);
    expect(() => new MapConfig({ x: 38.7, y: -9.1, entity_filter: { include: [{ area: "x" }] } })).toThrow(/area/);
  });
  it("a filter alone is enough: no x/y, no entities", () => {
    expect(() => new MapConfig({ entity_filter: filter })).not.toThrow();
    expect(() => new MapConfig({})).toThrow();
  });
  it("setFilteredEntries: the dashboard's own entities first, and they win", () => {
    const c = new MapConfig({ x: 38.7, y: -9.1, entities: [{ entity: "geo_location.b", color: "#123456" }] });
    c.setFilteredEntries([{ entity: "geo_location.a", size: 28 }, { entity: "geo_location.b", size: 28 }]);
    expect(c.entities.map((e) => e.id)).toEqual(["geo_location.b", "geo_location.a"]);
    expect(c.entities[0].color).toBe("#123456");
  });
  it("one EntityConfig per entry object, reused", () => {
    const c = new MapConfig({ x: 38.7, y: -9.1 });
    const e = { entity: "geo_location.a", size: 28 };
    c.setFilteredEntries([e]);
    const first = c.entities[0];
    c.setFilteredEntries([e, { entity: "geo_location.c" }]);
    expect(c.entities[0]).toBe(first);
    c.setFilteredEntries([{ entity: "geo_location.a", size: 28 }]);
    expect(c.entities[0]).not.toBe(first);
    expect(c.entities[0].fingerprint).toBe(first.fingerprint);
  });
  it("the filter's entries get the card's history defaults", () => {
    const c = new MapConfig({ x: 38.7, y: -9.1, history_start: "2 hours ago" });
    c.setFilteredEntries([{ entity: "geo_location.a" }]);
    expect(c.entities[0].historyStart).toBeInstanceOf(Date);
    const plain = new MapConfig({ x: 38.7, y: -9.1 });
    plain.setFilteredEntries([{ entity: "geo_location.a" }]);
    expect(plain.entities[0].historyStart).toBeNull();
  });
});
