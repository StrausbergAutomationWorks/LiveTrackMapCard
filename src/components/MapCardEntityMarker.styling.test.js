import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "" };
});

import MapCardEntityMarker, { labelTextStyle, labelOutline, LABEL_OUTLINE, ringStyle, ringWidthPx } from "./MapCardEntityMarker.js";

// Emitter-chosen label outline, arrow colour and arrow outline (Lee
// 2026-09-20): Lakeshore labels outlined in their own orange, the Monon
// arrow outlined white. Each integration emits these; the card only draws.

const render = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 28, title: "601", prefix: "", suffix: "", label: "", color: "#EF8322",
    rotationTransition: "3", arrow: "90", ...props });
  return m.render();
};
const ORANGE = "-1px -1px 0 #EF8322, 1px -1px 0 #EF8322, -1px 1px 0 #EF8322, 1px 1px 0 #EF8322";

describe("label outline", () => {
  it("is the dark default when absent or empty", () => {
    for (const v of [undefined, null, "", "  "]) expect(labelOutline(v)).toBe(LABEL_OUTLINE);
  });

  it("uses the emitter's colour in the same four offsets", () => {
    expect(labelOutline("#EF8322")).toBe(ORANGE);
  });

  it("applies with a label colour: Lakeshore", () => {
    expect(labelTextStyle("#EF8322", "#7F281F", "#EF8322")).toBe(`color: #7F281F; text-shadow: ${ORANGE};`);
  });

  it("applies to a white label too", () => {
    expect(labelTextStyle("#EF8322", "", "#EF8322")).toBe(`color: #FFFFFF; text-shadow: ${ORANGE};`);
  });

  it("leaves an unfilled marker's label alone", () => {
    expect(labelTextStyle("transparent", "", "#EF8322")).toBe("color: inherit;");
  });

  it("reaches the rendered marker", () => {
    expect(render({ labelColor: "#7F281F", labelOutline: "#EF8322" })).toContain(`color: #7F281F; text-shadow: ${ORANGE};`);
  });
});

describe("arrow colour and outline", () => {
  const path = (out) => out.match(/<path [^>]*>/)[0];

  it("default: the marker's fill, outlined dark", () => {
    const p = path(render({}));
    expect(p).toContain('fill="#EF8322"');
    expect(p).toContain('stroke="rgba(0, 0, 0, 0.8)"');
  });

  it("Monon: fill as the marker, outline WHITE", () => {
    const p = path(render({ color: "#7F281F", arrowOutline: "#FFFFFF" }));
    expect(p).toContain('fill="#7F281F"');
    expect(p).toContain('stroke="#FFFFFF"');
  });

  it("an emitted arrow colour replaces the fill", () => {
    expect(path(render({ arrowColor: "#123456" }))).toContain('fill="#123456"');
  });

  it("an emitted arrow colour works on an unfilled marker", () => {
    expect(path(render({ color: "transparent", arrowColor: "#123456" }))).toContain('fill="#123456"');
  });

  it.each(["", "  ", undefined])("%p falls back to the defaults", (v) => {
    const p = path(render({ arrowColor: v, arrowOutline: v }));
    expect(p).toContain('fill="#EF8322"');
    expect(p).toContain('stroke="rgba(0, 0, 0, 0.8)"');
  });
});

// The ring around the disc (Lee 2026-09-20, Brightline's solid black halo).
// It is the disc's CSS border, drawn inside the disc: before this it was
// always the fill's own colour, so it existed and could not be seen.
describe("ring around the disc", () => {
  const disc = (out) => out.match(/<div\s+class="marker[^"]*"\s+style="([^"]*)"/)[1];
  const svgTop = (out) => Number(out.match(/<svg class="arrow"[^>]*style="top: (-?\d+)px/)[1]);

  it("absent: exactly the old style, `border-color: <fill>;` and nothing more", () => {
    expect(ringStyle("#EF8322", "", "")).toBe("border-color: #EF8322;");
    expect(ringStyle("#EF8322")).toBe("border-color: #EF8322;");
    expect(disc(render({}))).toContain("background-color: #EF8322; border-color: #EF8322; color:");
    expect(disc(render({}))).not.toContain("border-width");
  });

  it("an emitted colour replaces the fill in the ring only", () => {
    const s = disc(render({ ringColor: "#000000" }));
    expect(s).toContain("background-color: #EF8322; border-color: #000000;");
    expect(s).not.toContain("border-width");
  });

  it("a width over 1 px is written; 1 px is the CSS default and is not", () => {
    expect(ringStyle("#EF8322", "#000000", "2")).toBe("border-color: #000000; border-width: 2px;");
    expect(ringStyle("#EF8322", "#000000", "1")).toBe("border-color: #000000;");
    expect(disc(render({ ringColor: "#000000", ringWidth: "3" }))).toContain("border-color: #000000; border-width: 3px;");
  });

  it("a width with no colour widens the fill-coloured ring", () => {
    expect(ringStyle("#EF8322", "", "2")).toBe("border-color: #EF8322; border-width: 2px;");
  });

  it.each(["", "  ", undefined, null, "0", "-2", "2.5", "wide"])("width %p reads as 1 px", (v) => {
    expect(ringWidthPx(v)).toBe(1);
  });

  it("the arrow is lifted by the ring's width so it stays on the outer edge", () => {
    // size 28: arrow 13 x 10; top = -h - ring
    expect(svgTop(render({}))).toBe(-11);
    expect(svgTop(render({ ringWidth: "2" }))).toBe(-12);
    expect(svgTop(render({ ringWidth: "4" }))).toBe(-14);
  });

  it("the ring colour does not reach the arrow, and the arrow keeps its own colours", () => {
    const out = render({ ringColor: "#000000", arrowColor: "#123456", arrowOutline: "#EBF213" });
    const p = out.match(/<path [^>]*>/)[0];
    expect(p).toContain('fill="#123456"');
    expect(p).toContain('stroke="#EBF213"');
  });
});
