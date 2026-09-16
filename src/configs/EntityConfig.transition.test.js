import EntityConfig from "./EntityConfig";
import { describe, expect, it } from "@jest/globals";

// position_transition: seconds a marker takes to slide to a new position,
// or 'auto' to match the entity's own update interval. Off by default.
describe("EntityConfig position_transition", () => {
  const defaults = { historyStart: null, historyEnd: null };
  const make = (extra) => new EntityConfig({ entity: "geo_location.x", ...extra }, defaults);

  it("is off by default", () => {
    expect(make({}).positionTransition).toBe(0);
  });

  it("reads seconds", () => {
    expect(make({ position_transition: 60 }).positionTransition).toBe(60);
    expect(make({ position_transition: 0.5 }).positionTransition).toBe(0.5);
    expect(make({ position_transition: "3" }).positionTransition).toBe(3);
  });

  it("reads 'auto'", () => {
    expect(make({ position_transition: "auto" }).positionTransition).toBe("auto");
  });

  it("ignores the camelCase spelling", () => {
    expect(make({ positionTransition: 60 }).positionTransition).toBe(0);
  });

  it("treats anything else as off", () => {
    for (const v of [-1, "fast", "AUTO ", null, true, Infinity, {}]) {
      expect(make({ position_transition: v }).positionTransition).toBe(0);
    }
  });
});
