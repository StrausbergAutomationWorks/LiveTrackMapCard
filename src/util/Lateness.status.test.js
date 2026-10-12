import { describe, expect, it } from "@jest/globals";
import { lateness, latenessColor, parseMarkerStatus, STATUS_COLOR, STATUS_MAX } from "./Lateness.js";

// 06_MAP_CONTRACT.md D4c-status (Lee 2026-10-11 20:23): "Customs" in the
// delay badge's place while a train is held at a border.

describe("marker_status", () => {
  it("is drawn in the badge's place, white, never pulsing", () => {
    expect(lateness({ marker_status: "Customs" })).toEqual(
      { "delay-badge": "Customs", "delay-level": "status", "pulse": "" });
    expect(latenessColor("status")).toBe(STATUS_COLOR);
    expect(STATUS_COLOR).toBe("#FFFFFF");
  });

  it("wins over a delay and a stall", () => {
    expect(lateness({ marker_status: "Customs", delay_min: 40, stalled: true })).toEqual(
      { "delay-badge": "Customs", "delay-level": "status", "pulse": "" });
  });

  it("is trimmed, up to ten characters", () => {
    expect(STATUS_MAX).toBe(10);
    expect(parseMarkerStatus("  Customs ")).toBe("Customs");
    expect(parseMarkerStatus("ABCDEFGHIJ")).toBe("ABCDEFGHIJ");
    expect(parseMarkerStatus("ABCDEFGHIJK")).toBeNull();
  });

  it.each([undefined, null, "", "   ", 7, true, ["Customs"], { text: "Customs" }])("nothing for %p: lateness as before", (v) => {
    expect(parseMarkerStatus(v)).toBeNull();
    expect(lateness({ marker_status: v, delay_min: 20 })["delay-badge"]).toBe("+20");
    expect(lateness({ marker_status: v })).toEqual({ "delay-badge": "", "delay-level": "", "pulse": "" });
  });
});
