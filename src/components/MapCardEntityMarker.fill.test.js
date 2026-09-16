import { describe, expect, it, jest } from "@jest/globals";

// Render templates to plain strings, values included, so styles can be read.
jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "" };
});

import MapCardEntityMarker, { contrastTextOn } from "./MapCardEntityMarker.js";

// Patch 6: the entity colour FILLS the marker, and the text on it is black or
// white, whichever has the higher WCAG contrast ratio, so a label inside a
// bright fill stays readable.
//
// Expected values are computed contrast ratios, not judgement. The bundle
// patch used "luminance > 0.5", which gives WHITE on #F29F05 (2.16:1)
// where black is 9.74:1 - the exact case it was written to fix. The two
// ratios cross at luminance 0.1791.
describe("contrastTextOn", () => {
  it.each([
    ["#F29F05", "#000000"],   // L 0.437: black 9.74, white 2.16
    ["#64BF4B", "#000000"],   // L 0.405: black 9.10, white 2.31
    ["#299FD5", "#000000"],   // L 0.301: black 7.01, white 2.99
    ["#FF091D", "#000000"],   // L 0.215: black 5.31, white 3.96
    ["#9019E6", "#FFFFFF"],   // L 0.123: black 3.47, white 6.06
    ["#A12073", "#FFFFFF"],   // L 0.099: black 2.97, white 7.07
    ["#FFFFFF", "#000000"],
    ["#000000", "#FFFFFF"],
  ])("%s gets %s", (fill, text) => {
    expect(contrastTextOn(fill)).toBe(text);
  });

  it("switches at the crossover, not at 0.5", () => {
    expect(contrastTextOn("#767676")).toBe("#000000");  // L 0.181, just above
    expect(contrastTextOn("#737373")).toBe("#FFFFFF");  // L 0.171, just below
  });

  it("reads lower-case hex and ignores an alpha pair", () => {
    expect(contrastTextOn("#f29f05")).toBe("#000000");
    expect(contrastTextOn("#000000ff")).toBe("#FFFFFF");
  });

  it.each(["transparent", "red", "hsl(297, 95%, 35%)", "#abc", "", null, undefined, 42])(
    "leaves the theme colour alone for %p", (value) => {
      expect(contrastTextOn(value)).toBe("inherit");
    });
});

function marker(props) {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 28, color: "#F29F05", title: "B1", prefix: "", suffix: "", label: "", ...props });
  return m.render();
}
const styleOf = (out, cls) => {
  const i = out.indexOf(`class="${cls}`);
  const j = out.indexOf('style="', i);
  return out.slice(j + 7, out.indexOf('"', j + 7));
};

describe("marker fill", () => {
  it("fills the normal marker with the entity colour, with readable text", () => {
    const style = styleOf(marker({}), "marker");
    expect(style).toContain("background-color: #F29F05");
    expect(style).toContain("border-color: #F29F05");
    expect(style).toContain("color: #000000");
    expect(style).toContain("height: 28px");
    expect(style).toContain("width: 28px");
  });

  it("fills a picture marker too - a transparent colour keeps it clear", () => {
    const style = styleOf(marker({ picture: "/p.svg", color: "transparent" }), "marker");
    expect(style).toContain("background-color: transparent");
    expect(style).toContain("color: inherit");
  });

  it("leaves the place pill and its badges as they were", () => {
    const out = marker({ placeIcon: "mdi:home", callout: "false" });
    expect(out).toContain('class="place-pill"');
    expect(out).not.toContain("background-color");
    expect(out).not.toContain("color: #000000");
  });
});
