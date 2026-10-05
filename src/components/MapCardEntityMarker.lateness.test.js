import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "", unsafeCSS: (s) => s };
});

import MapCardEntityMarker, { LABEL_OUTLINE, arrowSize, badgeMinWidth } from "./MapCardEntityMarker.js";
import { LATE_COLOR, VERY_LATE_COLOR, LATENESS_CSS } from "../util/Lateness.js";

// Backlog 275: "835 +12" on the label, amber 6-14, red 15+; a slow pulse on a
// late, stalled train; the fill and the halo never change.

const render = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 28, title: "835", prefix: "", suffix: "", label: "", color: "#0B3B8C",
    ringColor: "#1E90FF", ringWidth: "2", rotationTransition: "3", arrow: "",
    delayBadge: "", delayLevel: "", pulse: "", ...props });
  return m.render();
};
const disc = (out) => out.match(/<div\s+class="marker[^"]*"\s+style="([^"]*)"/)[1];

describe("delay badge", () => {
  it("amber: the badge follows the label, in amber with the dark outline", () => {
    const out = render({ delayBadge: "+12", delayLevel: "amber" });
    expect(out).toContain(`<span class="label-with-badge" style="min-width: 28px;">835<span class="delay-badge" style="color: ${LATE_COLOR}; text-shadow: ${LABEL_OUTLINE};">+12</span></span>`);
  });

  it("the label's box is at least the disc's width, so the badge never lands on the fill", () => {
    // NICTD 515 live, 2026-10-04: a label narrower than the disc put "+6" on the orange.
    expect(render({ size: 40, title: "51", delayBadge: "+6", delayLevel: "amber" }))
      .toContain('<span class="label-with-badge" style="min-width: 40px;">51<span class="delay-badge"');
  });

  it("with an arrow the box also clears the arrow's reach on both sides", () => {
    // NICTD 515 eastbound: the badge sat on the arrow. Size 40: arrow 18 x 14,
    // ring 1 drawn 1 px: 40 + 2 x (14 + 1) = 70.
    expect(render({ size: 40, title: "515", arrow: "90", ringWidth: "", delayBadge: "+6", delayLevel: "amber" }))
      .toContain('<span class="label-with-badge" style="min-width: 70px;">515<');
    // Size 28, ring 2: arrow 13 x 10; 28 + 2 x (10 + 2) = 52.
    expect(render({ arrow: "0", delayBadge: "+12", delayLevel: "amber" }))
      .toContain('<span class="label-with-badge" style="min-width: 52px;">835<');
  });

  it("badgeMinWidth: no arrow, no reach", () => {
    expect(badgeMinWidth(28, false, "2")).toBe(28);
    expect(badgeMinWidth(28, true, "2")).toBe(52);
  });

  it("the arrow and the badge share one size rule", () => {
    expect(arrowSize(28)).toEqual({ w: 13, h: 10 });
    expect(arrowSize(40)).toEqual({ w: 18, h: 14 });
    expect(arrowSize(10)).toEqual({ w: 8, h: 6 });
    const svg = render({ size: 40, arrow: "90" }).match(/<svg class="arrow" width="(\d+)" height="(\d+)"/);
    expect([Number(svg[1]), Number(svg[2])]).toEqual([18, 14]);
  });

  it("red", () => {
    expect(render({ delayBadge: "+21", delayLevel: "red" })).toContain(`style="color: ${VERY_LATE_COLOR}; text-shadow: ${LABEL_OUTLINE};">+21<`);
  });

  it("keeps the DEFAULT outline whatever the emitter's label outline", () => {
    const out = render({ delayBadge: "+12", delayLevel: "amber", labelOutline: "#EF8322" });
    expect(out).toContain(`text-shadow: ${LABEL_OUTLINE};">+12`);
  });

  it("with a prefix and suffix the whole label carries the badge", () => {
    const out = render({ prefix: "P", suffix: "S", delayBadge: "+7", delayLevel: "amber" });
    expect(out).toMatch(/<span class="label-with-badge" style="min-width: 28px;">[\s\S]*class="prefix"[\s\S]*835[\s\S]*class="suffix"[\s\S]*<span class="delay-badge"[^>]*>\+7<\/span><\/span>/);
  });

  it.each([
    ["no badge text", { delayBadge: "", delayLevel: "amber" }],
    ["blank badge text", { delayBadge: "  ", delayLevel: "red" }],
    ["no level", { delayBadge: "+12", delayLevel: "" }],
    ["a stray level", { delayBadge: "+12", delayLevel: "orange" }],
    ["undefined", { delayBadge: undefined, delayLevel: undefined }],
  ])("%s: nothing drawn", (_, props) => {
    const out = render(props);
    expect(out).not.toContain("delay-badge");
    expect(out).not.toContain("label-with-badge");
  });

  it("on time (all three empty) renders exactly as a marker never given them", () => {
    const before = new MapCardEntityMarker();
    Object.assign(before, { size: 28, title: "835", prefix: "", suffix: "", label: "", color: "#0B3B8C",
      ringColor: "#1E90FF", ringWidth: "2", rotationTransition: "3", arrow: "" });
    expect(render({})).toBe(before.render());
  });

  it("the fill and the halo do not change, late or pulsing", () => {
    const base = disc(render({}));
    expect(disc(render({ delayBadge: "+12", delayLevel: "amber" }))).toBe(base);
    expect(disc(render({ delayBadge: "+21", delayLevel: "red", pulse: "true" }))).toBe(base);
  });
});

describe("stall pulse", () => {
  const ring = (out) => (out.match(/<div class="stall-pulse" style="([^"]*)"><\/div>/) ?? [])[1];

  it("a late, stalled train pulses in its lateness colour, outside the drawn halo", () => {
    // ring-width 2 draws 2 px at DPR 1: the pulse starts 2 px beyond it.
    expect(ring(render({ delayBadge: "+12", delayLevel: "amber", pulse: "true" }))).toBe(`inset: -4px; border-color: ${LATE_COLOR};`);
    expect(ring(render({ delayBadge: "+21", delayLevel: "red", pulse: "true", ringWidth: "" }))).toBe(`inset: -3px; border-color: ${VERY_LATE_COLOR};`);
  });

  it.each([
    ["not stalled", { delayBadge: "+12", delayLevel: "amber", pulse: "" }],
    ["stalled, not late", { delayBadge: "", delayLevel: "", pulse: "true" }],
    ["pulse not exactly 'true'", { delayBadge: "+12", delayLevel: "amber", pulse: "1" }],
    ["a picture marker, which clips", { delayBadge: "+12", delayLevel: "amber", pulse: "true", picture: "/p.svg" }],
  ])("%s: no pulse", (_, props) => {
    expect(render(props)).not.toContain("stall-pulse");
  });
});

describe("styles", () => {
  it("carry the lateness CSS, reduced motion included", () => {
    const styles = MapCardEntityMarker.styles;
    expect(Array.isArray(styles)).toBe(true);
    expect(styles).toContain(LATENESS_CSS);
  });
});
