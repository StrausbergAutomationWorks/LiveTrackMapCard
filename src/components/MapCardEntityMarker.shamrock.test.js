import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  const join = (v) => (Array.isArray(v) ? v.join("") : String(v ?? ""));
  const tpl = (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? join(values[i]) : ""), "");
  return { LitElement: class {}, html: tpl, svg: tpl, css: () => "", unsafeCSS: () => "", _plain: html };
});

import MapCardEntityMarker, {
  SHAMROCK_LEAF_ANGLES, SHAMROCK_LOBE, SHAMROCK_STEM, innerRingStyle, shamrockEdgePx, shamrockParts,
} from "./MapCardEntityMarker.js";
import { MARKER_SHAPES, parseMarkerShape } from "../configs/EntityConfig.js";

// Irish Rail (Lee 2026-11-09 00:53, Intercity SSOT 8.10): InterCity a shamrock filled #009444, outlined and labelled
// #fbaf41, reversed toward Dublin; the Enterprise a silver disc, magenta ring and number, a thin red inner ring.
const GREEN = "#009444", ORANGE = "#FBAF41", SILVER = "#B0BDC0", MAGENTA = "#C10181", RED = "#F9031D";
const render = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 46, title: "700", prefix: "", suffix: "", label: "", color: GREEN, ringColor: ORANGE,
    ringWidth: "", innerRingColor: "", innerRingWidth: "", labelColor: ORANGE, labelOutline: "none", shape: "shamrock",
    symbol: "", labelPlacement: "", symbolColor: "", symbolOutline: "", rotationTransition: "3", arrow: "90",
    arrowColor: GREEN, arrowOutline: ORANGE, delayBadge: "", delayLevel: "", ...props });
  return m.render();
};
const shape = (out) => (out.match(/<svg class="shamrock-shape"[\s\S]*?<\/svg>/) || [""])[0];

describe("the shamrock", () => {
  it("is a contract shape, read exactly", () => {
    expect(MARKER_SHAPES).toContain("shamrock");
    expect(parseMarkerShape("shamrock")).toBe("shamrock");
    expect(parseMarkerShape("Shamrock")).toBeNull();
    expect(parseMarkerShape(" shamrock")).toBeNull();
  });

  it("three leaves (up, lower left, lower right), two lobes and a wedge each, inside the box", () => {
    expect(SHAMROCK_LEAF_ANGLES).toEqual([-90, 150, 30]);
    const parts = shamrockParts();
    expect(parts.filter((p) => p.circle)).toHaveLength(6);
    expect(parts.filter((p) => p.polygon)).toHaveLength(3);
    const { along, across, r } = SHAMROCK_LOBE;
    const reach = Math.hypot(along, across) + r;
    expect(reach).toBeLessThan(90);
    // The top leaf's lobes are straight above the centre.
    expect(parts[0].circle).toEqual([22, -50, 28]);
    expect(parts[1].circle).toEqual([-22, -50, 28]);
    for (const p of parts.filter((q) => q.circle)) expect(Math.hypot(p.circle[0], p.circle[1]) + p.circle[2]).toBeCloseTo(reach, 1);
  });

  it("filled with the fill, outlined in the ring colour: the outline pass first, the fill pass on top", () => {
    const s = shape(render({}));
    expect(s).toContain('viewBox="-100 -100 200 200"');
    const firstFill = s.indexOf(`fill="${GREEN}"`);
    const firstEdge = s.indexOf(`fill="${ORANGE}" stroke="${ORANGE}"`);
    expect(firstEdge).toBeGreaterThan(-1);
    expect(firstFill).toBeGreaterThan(firstEdge);
    expect(s).toContain(`d="${SHAMROCK_STEM}"`);
    expect((s.match(/<circle /g) || []).length).toBe(12);
  });

  it("toward Dublin the emitter swaps: orange fill, green outline", () => {
    const s = shape(render({ color: ORANGE, ringColor: GREEN, labelColor: GREEN }));
    expect(s.indexOf(`fill="${GREEN}" stroke="${GREEN}"`)).toBeLessThan(s.indexOf(`fill="${ORANGE}" stroke="none"`));
  });

  it("no ring colour: outlined in the fill (unseen), as the star", () => {
    expect(shape(render({ ringColor: "" }))).toContain(`fill="${GREEN}" stroke="${GREEN}"`);
  });

  it("the label across the centre in the label colour, no outline; arrow and delay badge as any marker", () => {
    const out = render({ delayBadge: "+12", delayLevel: "amber" });
    expect(out).toMatch(/class="marker shamrock /);
    expect(out).toContain(`color: ${ORANGE}; text-shadow: none;`);
    expect(out).toMatch(/700/);
    expect(out).toContain('class="arrow-frame"');
    expect(out).toContain("+12");
    expect(out).not.toContain("star-shape");
    expect(out).not.toContain("background-color:");
  });

  it("the edge: a sixteenth of the size, at least 1.5 px, or the emitter's width", () => {
    expect(shamrockEdgePx(46, "")).toBeCloseTo(2.875);
    expect(shamrockEdgePx(16, undefined)).toBe(1.5);
    expect(shamrockEdgePx(46, "2")).toBe(2);
    expect(shamrockEdgePx(46, "x")).toBeCloseTo(2.875);
    // 2.875 px at 46 px is 12.5 units; the outline pass strokes twice that.
    expect(shape(render({}))).toContain('stroke-width="25"');
  });

  it("a picture or an icon wins", () => {
    expect(render({ picture: "/x.png" })).not.toContain("shamrock-shape");
    expect(render({ icon: "mdi:train" })).not.toContain("shamrock-shape");
  });
});

describe("the disc's inner ring", () => {
  it("an inset ring inside the ring, in its colour and width; nothing without a colour", () => {
    expect(innerRingStyle(RED, "1")).toBe(` box-shadow: inset 0 0 0 1px ${RED};`);
    expect(innerRingStyle(RED, "")).toBe(` box-shadow: inset 0 0 0 1px ${RED};`);
    expect(innerRingStyle(RED, "2.5")).toBe(` box-shadow: inset 0 0 0 2.5px ${RED};`);
    expect(innerRingStyle("", "2")).toBe("");
    expect(innerRingStyle(undefined, "2")).toBe("");
  });

  it("the Enterprise: silver fill, magenta 3 px ring, red 1 px inner ring", () => {
    const out = render({ shape: "", color: SILVER, ringColor: MAGENTA, ringWidth: "3", innerRingColor: RED,
      innerRingWidth: "1", labelColor: MAGENTA, title: "100" });
    expect(out).toContain(`background-color: ${SILVER}; border-color: ${MAGENTA}; border-width: 3px; box-shadow: inset 0 0 0 1px ${RED};`);
    expect(out).not.toContain("shamrock-shape");
  });

  it("not on a picture marker, and absent when not sent", () => {
    expect(render({ shape: "", picture: "/x.png", innerRingColor: RED })).not.toContain("box-shadow: inset");
    expect(render({ shape: "", innerRingColor: "" })).not.toContain("box-shadow: inset");
  });
});
