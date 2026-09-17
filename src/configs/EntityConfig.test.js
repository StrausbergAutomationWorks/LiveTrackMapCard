import EntityConfig, { FALLBACK_MARKER_COLOR, parseMarkerColor } from "./EntityConfig";
import { describe, expect, it } from "@jest/globals";

describe("EntityConfig", () => {

  const defaults = {
    historyStart: null,
    historyEnd: null
  };

  describe("pillCalloutMinZoom", () => {
    it("defaults to 15", () => {
      const entityConfig = new EntityConfig({ entity: "device_tracker.mom" }, defaults);
      expect(entityConfig.pillCalloutMinZoom).toBe(15);
    });

    it("can be overridden via pill_callout_min_zoom", () => {
      const entityConfig = new EntityConfig({ entity: "device_tracker.mom", pill_callout_min_zoom: 12 }, defaults);
      expect(entityConfig.pillCalloutMinZoom).toBe(12);
    });
  });

  describe("color", () => {
    it("is the neutral fallback when none is configured, not a hashed hue", () => {
      const a = new EntityConfig("sensor.random_entity", defaults);
      const b = new EntityConfig({ entity: "geo_location.other" }, defaults);
      expect(a.color).toBe(FALLBACK_MARKER_COLOR);
      expect(b.color).toBe(FALLBACK_MARKER_COLOR);
      expect(a.configuredColor).toBeNull();
      expect(b.configuredColor).toBeNull();
    });

    it("is the configured colour when one is set, and remembers it was set", () => {
      const entityConfig = new EntityConfig({ entity: "sensor.random_entity", color: "red" }, defaults);
      expect(entityConfig.color).toBe("red");
      expect(entityConfig.configuredColor).toBe("red");
    });

    it("counts `transparent` as configured", () => {
      const entityConfig = new EntityConfig({ entity: "geo_location.plane", color: "transparent" }, defaults);
      expect(entityConfig.configuredColor).toBe("transparent");
    });

    it("hands the fallback to the derived circle config and history line", () => {
      const entityConfig = new EntityConfig({ entity: "geo_location.x", circle: { source: "attribute", attribute: "r" } }, defaults);
      expect(entityConfig.circleConfig.color).toBe(FALLBACK_MARKER_COLOR);
      expect(entityConfig.historyLineColor).toBe(FALLBACK_MARKER_COLOR);
    });

    it("is a neutral grey", () => {
      expect(FALLBACK_MARKER_COLOR).toMatch(/^#([0-9A-F]{2})\1\1$/i);
    });
  });

  describe("parseMarkerColor (05_SHARED_LESSONS D4a)", () => {
    it.each(["#299FD5", "#2e8b57", "#AbCdEf", "#000000", "#FFFFFF"])(
      "accepts %s", (v) => {
        expect(parseMarkerColor(v)).toBe(v);
      });

    it.each([
      null, undefined, "", 0, 0x299fd5, true, {}, ["#299FD5"],
      "#abc", "#299FD5FF", "299FD5", "#29 FD5", "#299FDG",
      " #299FD5", "#299FD5 ", "#299FD5\n",
      "red", "transparent", "rgb(1, 2, 3)", "hsl(3, 95%, 35%)",
    ])("rejects %p", (v) => {
      expect(parseMarkerColor(v)).toBeNull();
    });
  });
});
