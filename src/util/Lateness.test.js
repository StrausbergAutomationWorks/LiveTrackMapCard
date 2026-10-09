import { describe, expect, it } from "@jest/globals";
import { lateness, latenessColor, thresholds, LATE_MIN, VERY_LATE_MIN, LATE_COLOR, VERY_LATE_COLOR, NO_LATENESS, LATENESS_CSS } from "./Lateness.js";

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

describe("each railroad's own thresholds (D4c, Lee 2026-10-09)", () => {
  const AMTRAK = { late_threshold_min: 16, very_late_threshold_min: 30 };

  it("Amtrak: 15 minutes is on time, 16 amber, 29 amber, 30 red", () => {
    for (const d of [6, 10, 15]) expect(lateness({ ...AMTRAK, delay_min: d })).toEqual(NONE);
    expect(lateness({ ...AMTRAK, delay_min: 16 })).toEqual({ "delay-badge": "+16", "delay-level": "amber", "pulse": "" });
    expect(lateness({ ...AMTRAK, delay_min: 29 })["delay-level"]).toBe("amber");
    expect(lateness({ ...AMTRAK, delay_min: 30 })["delay-level"]).toBe("red");
  });

  it("the pulse follows the train's own threshold", () => {
    expect(lateness({ ...AMTRAK, delay_min: 12, stalled: true })).toEqual(NONE);
    expect(lateness({ ...AMTRAK, delay_min: 16, stalled: true })["pulse"]).toBe("true");
  });

  it("absent: the defaults, so Metra and South Shore are unchanged", () => {
    expect(thresholds({})).toEqual({ late: LATE_MIN, veryLate: VERY_LATE_MIN });
    expect(thresholds(undefined)).toEqual({ late: 6, veryLate: 15 });
  });

  it.each(["16", 16.5, 0, -3, 1441, true, null, NaN, [16]])("late %p is ignored: the default 6", (v) => {
    expect(thresholds({ late_threshold_min: v }).late).toBe(6);
  });

  it.each(["30", 30.5, 0, 1441, false, null])("very late %p is ignored: the default", (v) => {
    expect(thresholds({ late_threshold_min: 16, very_late_threshold_min: v })).toEqual({ late: 16, veryLate: 16 });
    expect(thresholds({ very_late_threshold_min: v })).toEqual({ late: 6, veryLate: 15 });
  });

  it("very late below late is ignored; a late above 15 with no very late is red from the late", () => {
    expect(thresholds({ late_threshold_min: 16, very_late_threshold_min: 10 })).toEqual({ late: 16, veryLate: 16 });
    expect(thresholds({ late_threshold_min: 20 })).toEqual({ late: 20, veryLate: 20 });
    expect(thresholds({ late_threshold_min: 3 })).toEqual({ late: 3, veryLate: 15 });
  });

  it("bounds: 1 and 1440 are accepted", () => {
    expect(thresholds({ late_threshold_min: 1, very_late_threshold_min: 1440 })).toEqual({ late: 1, veryLate: 1440 });
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

  it("the badge is 1.25x the label, so lateness reads first (Lee, 2026-10-05)", () => {
    const m = LATENESS_CSS.match(/\.delay-badge\s*\{([^}]*)\}/);
    expect(m[1]).toMatch(/font-size:\s*1\.25em;/);
  });

  it("never touches the disc's fill or halo", () => {
    expect(LATENESS_CSS).not.toMatch(/\.marker\b/);
    expect(LATENESS_CSS).not.toMatch(/background/);
  });
});
