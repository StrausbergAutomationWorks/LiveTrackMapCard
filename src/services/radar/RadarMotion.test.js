import { describe, expect, it } from "@jest/globals";
import {
  MOTION_STEPS, MOTION_STEP_MS, STEP_DWELL_MS, NEWEST_DWELL_MS,
  loopSteps, frameAt, sourceList, stepFrames, loopSignature, stepTiming, shownStep,
} from "./RadarMotion.js";
import { computedFiveMinute } from "./RadarFrames.js";

// Backlog 285 part 2, 06_MAP_CONTRACT_OVERLAYS.md D13 "Motion".

const T = (h, m) => Date.UTC(2026, 9, 6, h, m);
const F = (h, m) => ({ key: `k${h}:${m}`, time: T(h, m) });

describe("the loop's constants (D13)", () => {
  it("seven steps five minutes apart: thirty minutes", () => {
    expect(MOTION_STEPS).toBe(7);
    expect(MOTION_STEP_MS).toBe(300000);
    expect((MOTION_STEPS - 1) * MOTION_STEP_MS).toBe(30 * 60 * 1000);
    expect(STEP_DWELL_MS).toBe(600);
    expect(NEWEST_DWELL_MS).toBe(2000);
  });
});

describe("loopSteps: ONE clock", () => {
  it("E is the newest among the DRAWING sources only; seven steps back from it, oldest first", () => {
    const usable = new Map([["a", F(7, 20)], ["b", F(7, 24)], ["off", F(7, 29)]]);
    const s = loopSteps(new Set(["a", "b"]), usable);
    expect(s).toEqual([T(6, 54), T(6, 59), T(7, 4), T(7, 9), T(7, 14), T(7, 19), T(7, 24)]);
  });
  it("null when no drawing source has a frame", () => {
    expect(loopSteps(new Set(["x"]), new Map())).toBeNull();
    expect(loopSteps(new Set(), new Map([["a", F(7, 0)]]))).toBeNull();
    expect(loopSteps(null, new Map())).toBeNull();
    expect(loopSteps(["a"], new Map([["a", { key: "k", time: NaN }]]))).toBeNull();
  });
});

describe("frameAt: never a frame after the step", () => {
  const list = [F(7, 0), F(7, 6), F(7, 12)];
  it("the newest at or before the step", () => {
    expect(frameAt(list, T(7, 6))).toBe(list[1]);
    expect(frameAt(list, T(7, 11))).toBe(list[1]);
    expect(frameAt(list, T(7, 30))).toBe(list[2]);
  });
  it("before the oldest: the oldest", () => {
    expect(frameAt(list, T(6, 30))).toBe(list[0]);
  });
  it("no list: null", () => {
    expect(frameAt([], T(7, 0))).toBeNull();
    expect(frameAt(undefined, T(7, 0))).toBeNull();
  });
});

describe("sourceList", () => {
  it("FMI/DWD are computed back from now, never past their newest", () => {
    const now = T(7, 31);
    const newest = computedFiveMinute(now);
    const l = sourceList({ frame: "computed5" }, newest, now);
    expect(l.at(-1)).toEqual(newest);
    expect(l).toHaveLength(13);
    const older = { ...newest, time: newest.time - 10 * 60000 };
    expect(sourceList({ frame: "computed5" }, older, now).at(-1).time).toBe(older.time);
  });
  it("a listed source: its list up to its newest", () => {
    const newest = { ...F(7, 12), list: [F(7, 0), F(7, 6), F(7, 12), F(7, 18)] };
    expect(sourceList({}, newest, 0).map((f) => f.key)).toEqual(["k7:0", "k7:6", "k7:12"]);
  });
  it("a relay, or a source with no list: only its newest", () => {
    const n = F(7, 12);
    expect(sourceList({ kind: "relay" }, n, 0)).toEqual([n]);
    expect(sourceList({}, { ...n, list: [] }, 0)).toEqual([{ ...n, list: [] }]);
    expect(sourceList({}, null, 0)).toEqual([]);
  });
});

describe("stepFrames", () => {
  it("one Map per step, each usable source at its own frame at or before the step; an unusable source absent all loop", () => {
    const sources = [{ id: "g" }, { id: "r" }, { id: "gone" }];
    const usable = new Map([
      ["g", { ...F(7, 24), list: [F(6, 54), F(7, 0), F(7, 6), F(7, 12), F(7, 18), F(7, 24)] }],
      ["r", { ...F(7, 20), list: [F(6, 50), F(7, 0), F(7, 10), F(7, 20)] }],
    ]);
    const steps = loopSteps(["g", "r"], usable);
    const frames = stepFrames(sources, usable, steps, T(7, 30));
    expect(frames).toHaveLength(7);
    expect(frames.map((m) => m.get("g").key)).toEqual(["k6:54", "k6:54", "k7:0", "k7:6", "k7:12", "k7:18", "k7:24"]);
    expect(frames.map((m) => m.get("r").key)).toEqual(["k6:50", "k6:50", "k7:0", "k7:0", "k7:10", "k7:10", "k7:20"]);
    expect(frames.every((m) => !m.has("gone"))).toBe(true);
  });
});

describe("loopSignature", () => {
  const a = [new Map([["x", F(7, 0)], ["y", F(7, 1)], ["off", F(7, 2)]])];
  it("the drawing sources' keys per step, in id order; an off-screen source does not count", () => {
    expect(loopSignature(a, ["y", "x"])).toBe("x=k7:0,y=k7:1");
    const b = [new Map([["x", F(7, 0)], ["y", F(7, 1)], ["off", F(7, 9)]])];
    expect(loopSignature(b, ["x", "y"])).toBe(loopSignature(a, ["x", "y"]));
  });
  it("changes when a step's frame changes or a source drops out", () => {
    const b = [new Map([["x", F(7, 5)], ["y", F(7, 1)]])];
    expect(loopSignature(b, ["x", "y"])).not.toBe(loopSignature(a, ["x", "y"]));
    expect(loopSignature([new Map([["y", F(7, 1)]])], ["x", "y"])).toBe("x=,y=k7:1");
    expect(loopSignature([new Map(), new Map()], null)).toBe("|");
  });
});

describe("stepTiming", () => {
  it("each step 0.6 s, the newest held 2 s, then round to the oldest", () => {
    expect(stepTiming(0)).toEqual({ next: 1, dwell: STEP_DWELL_MS });
    expect(stepTiming(5)).toEqual({ next: 6, dwell: STEP_DWELL_MS });
    expect(stepTiming(6)).toEqual({ next: 0, dwell: NEWEST_DWELL_MS });
    expect(stepTiming(9)).toEqual({ next: 0, dwell: NEWEST_DWELL_MS });
  });
});

describe("shownStep: a failed frame holds the previous step", () => {
  it("its own when loaded", () => {
    expect(shownStep(2, [true, true, true])).toBe(2);
  });
  it("else the nearest loaded before it, round the loop", () => {
    expect(shownStep(2, [true, true, false])).toBe(1);
    expect(shownStep(1, [false, null, true])).toBe(2);
    expect(shownStep(0, [null, true, false])).toBe(1);
  });
  it("-1 when nothing loaded", () => {
    expect(shownStep(0, [null, false])).toBe(-1);
    expect(shownStep(0, [])).toBe(-1);
  });
});
