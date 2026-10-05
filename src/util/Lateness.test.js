import { describe, expect, it } from "@jest/globals";
import { lateness, latenessColor, LATE_MIN, VERY_LATE_MIN, LATE_COLOR, VERY_LATE_COLOR, NO_LATENESS, LATENESS_CSS } from "./Lateness.js";

// Backlog 275, 06_MAP_CONTRACT.md D4c. Late = delay_min >= 6 (Metra's
// standard, the emitter truncates); red from 15; on time or absent shows
// nothing; the pulse only when stalled === true AND late.

const NONE = { "delay-badge": "", "delay-level": "", "pulse": "" };

describe("the thresholds", () => {
  it("are 6 and 15", () => {
    expect(LATE_MIN).toBe(6);
    expect(VERY_LATE_MIN).toBe(15);
  });

  it("the empty value is frozen, and lateness() never hands it out to be mutated", () => {
    expect(Object.isFrozen(NO_LATENESS)).toBe(true);
    const a = lateness({});
    a["delay-badge"] = "x";
    expect(lateness({})).toEqual(NONE);
  });
});

describe("delay_min", () => {
  it.each([-30, -1, 0, 1, 5])("%p minutes: on time or early, nothing at all", (d) => {
    expect(lateness({ delay_min: d })).toEqual(NONE);
    expect(lateness({ delay_min: d, stalled: true })).toEqual(NONE);
  });

  it.each([6, 7, 12, 14])("%p minutes: amber", (d) => {
    expect(lateness({ delay_min: d })).toEqual({ "delay-badge": `+${d}`, "delay-level": "amber", "pulse": "" });
  });

  it.each([15, 16, 21, 90])("%p minutes: red", (d) => {
    expect(lateness({ delay_min: d })).toEqual({ "delay-badge": `+${d}`, "delay-level": "red", "pulse": "" });
  });

  it("the boundaries exactly: 5 nothing, 6 amber, 14 amber, 15 red", () => {
    expect(lateness({ delay_min: 5 })["delay-level"]).toBe("");
    expect(lateness({ delay_min: 6 })["delay-level"]).toBe("amber");
    expect(lateness({ delay_min: 14 })["delay-level"]).toBe("amber");
    expect(lateness({ delay_min: 15 })["delay-level"]).toBe("red");
  });

  it.each(["12", "+12", 12.5, 6.01, true, false, null, NaN, Infinity, [12], { m: 12 }, ""])(
    "%p is not a JSON integer: no badge, and no pulse even when stalled", (d) => {
      expect(lateness({ delay_min: d, stalled: true })).toEqual(NONE);
    });

  it("absent, or no attributes at all: nothing", () => {
    expect(lateness({})).toEqual(NONE);
    expect(lateness({ stalled: true })).toEqual(NONE);
    expect(lateness(undefined)).toEqual(NONE);
    expect(lateness(null)).toEqual(NONE);
  });

  it("is never read from the label", () => {
    expect(lateness({ marker_label: "835 +12" })).toEqual(NONE);
    expect(lateness({ marker_label: "835", delay_min: 12 })["delay-badge"]).toBe("+12");
  });
});

describe("stalled", () => {
  it("pulses a late train that is stalled", () => {
    expect(lateness({ delay_min: 6, stalled: true })).toEqual({ "delay-badge": "+6", "delay-level": "amber", "pulse": "true" });
    expect(lateness({ delay_min: 21, stalled: true })).toEqual({ "delay-badge": "+21", "delay-level": "red", "pulse": "true" });
  });

  it.each(["true", 1, "yes", false, null, {}])("%p is not true: no pulse", (s) => {
    expect(lateness({ delay_min: 12, stalled: s })["pulse"]).toBe("");
  });

  it("re-decided on every call: moves, makes up time, stalls again", () => {
    const a = { delay_min: 8, stalled: true };
    expect(lateness(a)["pulse"]).toBe("true");
    delete a.stalled;
    expect(lateness(a)["pulse"]).toBe("");
    a.stalled = true;
    a.delay_min = 5;
    expect(lateness(a)).toEqual(NONE);
    a.delay_min = 6;
    expect(lateness(a)["pulse"]).toBe("true");
  });
});

describe("latenessColor", () => {
  it("maps the two levels and nothing else", () => {
    expect(latenessColor("amber")).toBe(LATE_COLOR);
    expect(latenessColor("red")).toBe(VERY_LATE_COLOR);
    for (const v of ["", undefined, null, "Red", "orange", "late"]) expect(latenessColor(v)).toBe("");
  });

  it("the two colours differ", () => {
    expect(LATE_COLOR).not.toBe(VERY_LATE_COLOR);
  });
});

describe("the pulse CSS", () => {
  it("animates slowly", () => {
    expect(LATENESS_CSS).toMatch(/\.stall-pulse\s*\{[^}]*animation:\s*ltmc-stall-pulse 3s/);
    expect(LATENESS_CSS).toContain("@keyframes ltmc-stall-pulse");
  });

  it("holds still under prefers-reduced-motion, as a static ring", () => {
    const m = LATENESS_CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/\.stall-pulse\s*\{[^}]*animation:\s*none;/);
    expect(m[1]).toMatch(/opacity:\s*1;/);
  });

  it("the static ring is dashed and set clear of the disc, so it cannot read as the halo", () => {
    const m = LATENESS_CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/);
    expect(m[1]).toMatch(/border-style:\s*dashed;/);
    const s = Number(m[1].match(/transform:\s*scale\(([\d.]+)\)/)[1]);
    expect(s).toBeGreaterThanOrEqual(1.4);
  });

  it("the label's box is a centred inline block, so a min-width can widen it to the disc", () => {
    const m = LATENESS_CSS.match(/\.label-with-badge\s*\{([^}]*)\}/);
    expect(m[1]).toMatch(/display:\s*inline-block;/);
    expect(m[1]).toMatch(/text-align:\s*center;/);
    expect(m[1]).toMatch(/position:\s*relative;/);
  });

  it("the label's box never shrinks inside the disc's flex box, or the label slides under the badge", () => {
    // Seen 2026-10-04: without it "2036" was squeezed to 28 px and "+12" covered its last digit.
    const m = LATENESS_CSS.match(/\.label-with-badge\s*\{([^}]*)\}/);
    expect(m[1]).toMatch(/flex-shrink:\s*0;/);
  });

  it("never touches the disc's fill or halo", () => {
    expect(LATENESS_CSS).not.toMatch(/\.marker\b/);
    expect(LATENESS_CSS).not.toMatch(/background/);
  });
});
