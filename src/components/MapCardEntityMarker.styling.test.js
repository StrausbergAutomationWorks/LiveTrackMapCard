import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "" };
});

import MapCardEntityMarker, { labelTextStyle, labelOutline, LABEL_OUTLINE } from "./MapCardEntityMarker.js";

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
