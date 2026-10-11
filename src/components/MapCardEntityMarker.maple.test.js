import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "", unsafeCSS: () => "" };
});

import MapCardEntityMarker, {
  headingTag, mapleBandPx, LABEL_OUTLINE, MAPLE_BAND, MAPLE_EDGE_COLOR, MAPLE_LEAF_COLOR, MAPLE_LEAF_OUTLINE,
  MAPLE_LEAF_PATH, MAPLE_LEAF_SIZE, MAPLE_LEAF_VIEWBOX, TAG_DEFAULT_ANGLE, TAG_FONT, TAG_GAP, tagInk,
} from "./MapCardEntityMarker.js";

// VIA Rail's marker (Lee 2026-10-11 00:02, 00:18, 00:33): a yellow disc with a
// red maple leaf outlined black, a wide band in the route group's colour; the
// train number as an upright tag on the side it is heading, in the band colour.
const YELLOW = "#FFCC00", OQ = "#323198", WHITE = "#FFFFFF";
const render = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 40, title: "61", prefix: "", suffix: "", label: "", color: YELLOW,
    ringColor: OQ, labelColor: "", labelOutline: "", shape: "maple", labelPlacement: "heading",
    symbolColor: "", symbolOutline: "", rotationTransition: "3", arrow: "90", ...props });
  return m.render();
};
const circles = (out) => [...out.matchAll(/<circle [^>]*>/g)].map((m) => m[0]);
const tagOf = (out) => (out.match(/<div class="heading-tag" style="([^"]*)">([^<]*)<\/div>/) || []);

describe("the maple-leaf marker", () => {
  it("is a band in the ring colour, then the disc in the fill outlined black", () => {
    const [band, disc] = circles(render({}));
    expect(band).toContain('r="20"');
    expect(band).toContain(`fill="${OQ}"`);
    expect(disc).toContain(`fill="${YELLOW}"`);
    expect(disc).toContain(`stroke="${MAPLE_EDGE_COLOR}"`);
    expect(disc).toContain(`r="${+(20 - 40 * MAPLE_BAND).toFixed(2)}"`);
  });

  it("the band is wide enough to show (Lee): 12% of the marker, never under 3 px", () => {
    expect(MAPLE_BAND).toBe(0.12);
    expect(mapleBandPx(40)).toBeCloseTo(4.8, 5);
    expect(mapleBandPx(10)).toBe(3);
    expect(mapleBandPx(undefined)).toBe(3);
  });

  it("the leaf: red outlined black by default, 58% of the marker tall, centred", () => {
    const out = render({});
    expect(out).toContain(`d="${MAPLE_LEAF_PATH}"`);
    expect(out).toContain(`fill="${MAPLE_LEAF_COLOR}" stroke="${MAPLE_LEAF_OUTLINE}"`);
    expect(out).toContain(`viewBox="${MAPLE_LEAF_VIEWBOX}"`);
    expect(out).toContain(`height="${+(40 * MAPLE_LEAF_SIZE).toFixed(2)}"`);
    expect(out).toContain(`y="${+(-40 * MAPLE_LEAF_SIZE / 2).toFixed(2)}"`);
    expect(MAPLE_LEAF_COLOR).toBe("#FF0000");
    expect(MAPLE_LEAF_OUTLINE).toBe("#000000");
    expect(out).toContain('vector-effect="non-scaling-stroke"');
  });

  it("the other direction is the emitter's: route-colour disc, yellow band, white-edged leaf", () => {
    const out = render({ color: OQ, ringColor: YELLOW, symbolOutline: WHITE });
    const [band, disc] = circles(out);
    expect(band).toContain(`fill="${YELLOW}"`);
    expect(disc).toContain(`fill="${OQ}"`);
    expect(out).toContain(`fill="${MAPLE_LEAF_COLOR}" stroke="${WHITE}"`);
  });

  it("the leaf's own colour when the emitter sends one", () => {
    expect(render({ symbolColor: "#00FF00" })).toContain('fill="#00FF00" stroke="#000000"');
  });

  it("with no ring colour the band is the fill", () => {
    expect(circles(render({ ringColor: "" }))[0]).toContain(`fill="${YELLOW}"`);
  });

  it("has no CSS disc: the maple class, no background, no border", () => {
    const out = render({});
    expect(out).toMatch(/class="marker maple /);
    expect(out).not.toContain("background-color: #FFCC00");
    expect(out).not.toContain("border-color:");
  });

  it("a picture or an icon wins over the leaf", () => {
    expect(render({ picture: "/p.png" })).not.toContain("maple-shape");
    expect(render({ icon: "mdi:train" })).not.toContain("maple-shape");
  });

  it.each(["", "Maple", "leaf", undefined])("shape %p is not the leaf", (shape) => {
    expect(render({ shape })).not.toContain("maple-shape");
  });

  it("without the heading placement it keeps the arrow and the label inside", () => {
    const out = render({ labelPlacement: "" });
    expect(out).toContain('<svg class="arrow"');
    expect(out).not.toContain("heading-tag");
    expect(out).toContain("61");
  });
});

describe("the heading tag (Lee 00:18, option 2 at 00:33)", () => {
  it("replaces the arrow and the label inside", () => {
    const out = render({});
    expect(out).not.toContain('<svg class="arrow"');
    expect(out).toContain('<div class="heading-tag"');
    expect(out.match(/61/g)).toHaveLength(1);
  });

  it("is in the band colour, the number black or white by contrast, else the label colour", () => {
    expect(tagOf(render({}))[1]).toContain(`background-color: ${OQ}; color: #FFFFFF;`);
    expect(tagOf(render({ ringColor: YELLOW }))[1]).toContain(`background-color: ${YELLOW}; color: #000000;`);
    expect(tagOf(render({ labelColor: "#123456", ringColor: YELLOW }))[1]).toContain("color: #123456;");
    expect(tagOf(render({ ringColor: "" }))[1]).toContain(`background-color: ${YELLOW}; color: #000000;`);
  });

  it("tagInk: the higher WCAG contrast; VIA's bands as measured", () => {
    // White on the two blues; black on yellow, red, pink, cyan, green, orange.
    for (const c of ["#323198", "#417689", "#000000"]) expect(tagInk(c)).toBe("#FFFFFF");
    for (const c of ["#FFCC00", "#FF0000", "#EA63A4", "#01B5FF", "#2AAC82", "#FF6D00", "#FFFFFF", "#ffcc00"]) {
      expect(tagInk(c)).toBe("#000000");
    }
    for (const c of ["", undefined, "yellow", "#FC0", "#FFCC00FF"]) expect(tagInk(c)).toBe("#FFFFFF");
  });

  it("sits on the side the marker is heading, its box just clear of the edge", () => {
    const east = headingTag(90, 40, "61");
    expect(east.y).toBeCloseTo(0, 5);
    expect(east.x).toBeCloseTo(20 + TAG_GAP + east.w / 2, 5);
    const north = headingTag(0, 40, "61");
    expect(north.x).toBeCloseTo(0, 5);
    expect(north.y).toBeCloseTo(-(20 + TAG_GAP + north.h / 2), 5);
    const sw = headingTag(225, 40, "692");
    expect(sw.x).toBeLessThan(0);
    expect(sw.y).toBeGreaterThan(0);
    expect(tagOf(render({ arrow: "0" }))[1]).toContain(`left: calc(50% + 0px); top: calc(50% + ${north.y}px);`);
  });

  it("an accumulated angle is the same side as its remainder", () => {
    const a = headingTag(450, 40, "61"), b = headingTag(90, 40, "61");
    expect(a.x).toBeCloseTo(b.x, 2);
    expect(a.y).toBeCloseTo(b.y, 2);
    const c = headingTag(-90, 40, "61"), d = headingTag(270, 40, "61");
    expect(c.x).toBeCloseTo(d.x, 2);
  });

  it("is upright: the tag itself is never rotated", () => {
    expect(tagOf(render({ arrow: "123" }))[1]).not.toContain("rotate");
  });

  it("no heading: east, the delay west", () => {
    expect(TAG_DEFAULT_ANGLE).toBe(90);
    for (const arrow of ["", undefined, "abc"]) {
      const g = headingTag(arrow, 40, "61");
      expect(g.x).toBeGreaterThan(0);
      expect(g.y).toBeCloseTo(0, 5);
      expect(tagOf(render({ arrow }))[1]).toContain(`left: calc(50% + ${g.x}px)`);
    }
  });

  it("grows with the number and the marker", () => {
    expect(headingTag(90, 40, "692").w).toBeGreaterThan(headingTag(90, 40, "61").w);
    expect(headingTag(90, 40, "61").font).toBe(Math.round(40 * TAG_FONT));
    expect(headingTag(90, 10, "61").font).toBe(10);
  });

  it("moves round the marker with the arrow's transition time", () => {
    expect(tagOf(render({ rotationTransition: "3" }))[1]).toContain("transition: left 3s linear, top 3s linear;");
    expect(tagOf(render({ rotationTransition: "x" }))[1]).toContain("transition: left 0s linear");
  });

  it("works on the disc and the star too", () => {
    expect(render({ shape: "" })).toContain("heading-tag");
    expect(render({ shape: "star" })).toContain("heading-tag");
    expect(render({ shape: "star" })).not.toContain('<svg class="arrow"');
  });

  it("not on a picture or an icon, and not without a label: the arrow then", () => {
    expect(render({ picture: "/p.png" })).not.toContain("heading-tag");
    expect(render({ icon: "mdi:train" })).not.toContain("heading-tag");
    const out = render({ title: "  " });
    expect(out).not.toContain("heading-tag");
    expect(out).toContain('<svg class="arrow"');
  });

  it.each(["", "Heading", "inside", undefined])("placement %p keeps the label inside", (labelPlacement) => {
    expect(render({ labelPlacement })).not.toContain("heading-tag");
  });
});

describe("the delay in tag mode: opposite the tag (the fix that came with option 2)", () => {
  it("sits on the side opposite the heading, in its level's colour", () => {
    const out = render({ arrow: "90", delayBadge: "+37", delayLevel: "red" });
    const g = headingTag(270, 40, "+37", true);
    expect(g.x).toBeLessThan(0);
    expect(out).toContain(`<span class="heading-delay" style="left: calc(50% + ${g.x}px); top: calc(50% + ${g.y}px);`);
    expect(out).toContain(`text-shadow: ${LABEL_OUTLINE};`);
    expect(out).toContain(">+37</span>");
    expect(out).not.toContain("label-with-badge");
  });

  it("follows the heading round: north-bound, the delay is south", () => {
    const out = render({ arrow: "0", delayBadge: "+8", delayLevel: "amber" });
    const g = headingTag(180, 40, "+8", true);
    expect(g.y).toBeGreaterThan(0);
    expect(out).toContain(`top: calc(50% + ${g.y}px)`);
  });

  it("no heading: the delay west of the east tag", () => {
    const out = render({ arrow: "", delayBadge: "+8", delayLevel: "amber" });
    expect(out).toContain(`left: calc(50% + ${headingTag(270, 40, "+8", true).x}px)`);
  });

  it("nothing on time, nothing for an unknown level", () => {
    expect(render({ delayBadge: "", delayLevel: "" })).not.toContain("heading-delay");
    expect(render({ delayBadge: "+9", delayLevel: "purple" })).not.toContain("heading-delay");
  });

  it("a bare delay has no box: no padding, the font's height", () => {
    const g = headingTag(270, 40, "+37", true);
    expect(g.pad).toBe(0);
    expect(g.h).toBe(g.font);
  });
});
