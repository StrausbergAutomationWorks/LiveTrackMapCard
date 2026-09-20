import EntityConfig from "./EntityConfig";
import { describe, expect, it } from "@jest/globals";

// arrow_attribute / label_color (backlog 238). snake_case in YAML, camelCase
// on the object - an unknown key is silently ignored, so the mapping is pinned.
describe("EntityConfig arrow and label colour", () => {
  const defaults = { historyStart: null, historyEnd: null };
  const make = (extra) => new EntityConfig({ entity: "geo_location.x", ...extra }, defaults);

  it("is off by default", () => {
    const c = make({});
    expect(c.arrowAttribute).toBeNull();
    expect(c.configuredLabelColor).toBeNull();
  });

  it("reads arrow_attribute and label_color", () => {
    const c = make({ arrow_attribute: "icon_rotation_deg", label_color: "#7F281F" });
    expect(c.arrowAttribute).toBe("icon_rotation_deg");
    expect(c.configuredLabelColor).toBe("#7F281F");
  });

  it("does not read the camelCase spellings", () => {
    const c = make({ arrowAttribute: "icon_rotation_deg", labelColor: "#7F281F" });
    expect(c.arrowAttribute).toBeNull();
    expect(c.configuredLabelColor).toBeNull();
  });

  it.each(["", "   ", 5, null])("treats %p as off", (v) => {
    const c = make({ arrow_attribute: v, label_color: v });
    expect(c.arrowAttribute).toBeNull();
    expect(c.configuredLabelColor).toBeNull();
  });

  it("does not let an arrow switch on picture rotation, nor the reverse", () => {
    expect(make({ arrow_attribute: "a" }).rotationAttribute).toBeNull();
    expect(make({ rotation_attribute: "a" }).arrowAttribute).toBeNull();
  });
});
