import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "", unsafeCSS: () => "" };
});

import MapCardEntityMarker, {
  starPoints, starEdgeWidth, starLabelOutline, starLabelStyle, STAR_INNER, STAR_CORE, STAR_EDGE_COLOR,
} from "./MapCardEntityMarker.js";

// The star (06_MAP_CONTRACT.md D4a `marker_shape`; Lee 2026-10-09 16:43):
// Live Track Intercity Rail's odd trains D (blue edge, white inside, red
// number) and even trains C (red edge, white inside, blue number).
const BLUE = "#3C3B6E", RED = "#B22234", WHITE = "#FFFFFF";
const render = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 28, title: "2150", prefix: "", suffix: "", label: "", color: WHITE,
    ringColor: BLUE, labelColor: RED, labelOutline: WHITE, shape: "star",
    rotationTransition: "3", arrow: "90", ...props });
  return m.render();
};
const polygons = (out) => [...out.matchAll(/<polygon [^>]*>/g)].map((m) => m[0]);

describe("starPoints", () => {
  it("is ten points, the first straight up at the outer radius", () => {
    const pts = starPoints(10).split(" ").map((p) => p.split(",").map(Number));
    expect(pts).toHaveLength(10);
    expect(pts[0][0]).toBeCloseTo(0, 2);
    expect(pts[0][1]).toBeCloseTo(-10, 2);
  });

  it("alternates the outer radius and the inner one", () => {
    const pts = starPoints(10).split(" ").map((p) => p.split(",").map(Number));
    pts.forEach(([x, y], i) => expect(Math.hypot(x, y)).toBeCloseTo(i % 2 === 0 ? 10 : 10 * STAR_INNER, 1));
  });

  it("is the fuller star (Lee): inner points at half the radius", () => {
    expect(STAR_INNER).toBe(0.5);
  });

  it("the inside star is half the star's area", () => {
    expect(STAR_CORE * STAR_CORE).toBeCloseTo(0.5, 10);
  });
});

describe("the star marker", () => {
  it("draws the outer star in the ring colour with a white outline, the inside in the fill", () => {
    const [outer, inner] = polygons(render({}));
    expect(outer).toContain(`fill="${BLUE}"`);
    expect(outer).toContain(`stroke="${STAR_EDGE_COLOR}"`);
    expect(outer).toContain('paint-order="stroke"');
    expect(outer).toContain(`points="${starPoints(14)}"`);
    expect(inner).toContain(`fill="${WHITE}"`);
    expect(inner).toContain(`points="${starPoints(14 * STAR_CORE)}"`);
  });

  it("C: the red edge for the even trains", () => {
    expect(polygons(render({ ringColor: RED, labelColor: BLUE }))[0]).toContain(`fill="${RED}"`);
  });

  it("has no disc: no CSS ring, no background, the star class", () => {
    const out = render({});
    expect(out).toMatch(/class="marker star /);
    expect(out).not.toContain("background-color:");
    expect(out).not.toContain("border-color:");
  });

  it("the number in its colour with the HEAVIER white outline", () => {
    expect(render({})).toContain(`color: ${RED}; text-shadow: ${starLabelOutline(WHITE)};`);
    expect(starLabelOutline(WHITE).split(", ")).toHaveLength(8);
    expect(starLabelOutline(WHITE)).toContain(`1.5px 1.5px 0 ${WHITE}`);
  });

  it("falls back to a dark number and a dark outline", () => {
    expect(starLabelStyle("", "")).toBe(`color: #212121; text-shadow: ${starLabelOutline("")};`);
    expect(starLabelOutline("")).toContain("rgba(0, 0, 0, 0.8)");
  });

  it("with no ring colour the edge is the fill", () => {
    expect(polygons(render({ ringColor: "", color: "#123456" }))[0]).toContain('fill="#123456"');
  });

  it("keeps the arrow, the label and the delay badge", () => {
    const out = render({ delayBadge: "+20", delayLevel: "amber" });
    expect(out).toContain('<svg class="arrow"');
    expect(out).toContain("2150");
    expect(out).toContain("delay-badge");
  });

  it("the outline grows with the marker, never under 2", () => {
    expect(starEdgeWidth(12)).toBe(2);
    expect(starEdgeWidth(48)).toBe(4);
  });

  it.each(["", "disc", "Star", undefined])("shape %p is the disc, exactly as before", (shape) => {
    const out = render({ shape });
    expect(out).not.toContain("star-shape");
    expect(out).toContain("background-color: #FFFFFF;");
  });

  it("a picture or an icon wins over the star", () => {
    expect(render({ picture: "/p.png" })).not.toContain("star-shape");
    expect(render({ icon: "mdi:train" })).not.toContain("star-shape");
  });
});
