import EntityConfig from "./EntityConfig";
import { describe, expect, it } from "@jest/globals";

// rotation_attribute / rotation_transition: turn a picture marker by an
// entity attribute. snake_case in YAML, camelCase on the object - an unknown
// key is silently ignored, so the mapping is pinned here.
describe("EntityConfig rotation", () => {
  const defaults = { historyStart: null, historyEnd: null };
  const make = (extra) => new EntityConfig({ entity: "geo_location.x", ...extra }, defaults);

  it("is off by default", () => {
    const c = make({});
    expect(c.rotationAttribute).toBeNull();
    expect(c.rotationTransition).toBe(0);
  });

  it("reads rotation_attribute", () => {
    expect(make({ rotation_attribute: "icon_rotation_deg" }).rotationAttribute).toBe("icon_rotation_deg");
  });

  it("ignores the camelCase spelling", () => {
    expect(make({ rotationAttribute: "icon_rotation_deg" }).rotationAttribute).toBeNull();
  });

  it("treats an empty or non-string rotation_attribute as off", () => {
    expect(make({ rotation_attribute: "" }).rotationAttribute).toBeNull();
    expect(make({ rotation_attribute: "   " }).rotationAttribute).toBeNull();
    expect(make({ rotation_attribute: 5 }).rotationAttribute).toBeNull();
  });

  it("reads rotation_transition in seconds", () => {
    expect(make({ rotation_transition: 2 }).rotationTransition).toBe(2);
    expect(make({ rotation_transition: 0.5 }).rotationTransition).toBe(0.5);
    expect(make({ rotation_transition: "3" }).rotationTransition).toBe(3);
  });

  it("falls back to 0 for a negative or unusable rotation_transition", () => {
    expect(make({ rotation_transition: -1 }).rotationTransition).toBe(0);
    expect(make({ rotation_transition: "slow" }).rotationTransition).toBe(0);
    expect(make({ rotation_transition: null }).rotationTransition).toBe(0);
    expect(make({ rotation_transition: Infinity }).rotationTransition).toBe(0);
  });
});
