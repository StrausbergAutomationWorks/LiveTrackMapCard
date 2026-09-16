import { describe, expect, it, jest } from "@jest/globals";

// Render templates to plain strings, values included, so styles can be read.
jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "" };
});

import MapCardEntityMarker, { labelTextStyle, LABEL_OUTLINE } from "./MapCardEntityMarker.js";

// Patch 6: the entity colour FILLS the marker. Label text is WHITE with a
// dark outline, whatever the fill.
//
// Recorded wrong answer (SSOT section 23): 2a37a80 chose black or white by
// WCAG contrast against the FILL, which gave black on four Brightline
// colours. Labels overflow the marker, and black is lost on the map. These
// tests pin white for every fill, including the ones a contrast rule would
// turn black, so that rule cannot come back unnoticed.
const WHITE_OUTLINED = `color: #FFFFFF; text-shadow: ${LABEL_OUTLINE};`;

describe("labelTextStyle", () => {
  it.each([
    "#F29F05", // Orlando - contrast rule gave black
    "#64BF4B", // West Palm - contrast rule gave black
    "#299FD5", // Miami - contrast rule gave black
    "#FF091D", // Aventura - contrast rule gave black
    "#9019E6", // Fort Lauderdale
    "#A12073", // Boca Raton
    "#FFFF66", // very light: black under ANY luminance rule, incl. the box's
    "#FFFFFF",
    "#000000",
  ])("%s gets white outlined text", (fill) => {
    expect(labelTextStyle(fill)).toBe(WHITE_OUTLINED);
  });

  it("does not switch at either old threshold", () => {
    expect(labelTextStyle("#767676")).toBe(WHITE_OUTLINED); // L 0.181
    expect(labelTextStyle("#737373")).toBe(WHITE_OUTLINED); // L 0.171
    expect(labelTextStyle("#BCBCBC")).toBe(WHITE_OUTLINED); // L 0.503
  });

  it("reads lower-case hex and an alpha pair", () => {
    expect(labelTextStyle("#f29f05")).toBe(WHITE_OUTLINED);
    expect(labelTextStyle("#f29f05ff")).toBe(WHITE_OUTLINED);
  });

  // The live map's ships and South Shore branches set no colour, so the card
  // gives them a random hsl(). A hex-only rule left all of them unoutlined.
  it.each(["hsl(3, 95%, 35%)", "hsl(297, 95%, 35%)", "rgb(10, 20, 30)", "red", "#abc", " #F29F05 "])(
    "outlines a fill written as %p", (fill) => {
      expect(labelTextStyle(fill)).toBe(WHITE_OUTLINED);
    });

  it("outlines the card's own random colour", () => {
    const m = new MapCardEntityMarker();
    Object.assign(m, { size: 28, title: "SHIP", prefix: "", suffix: "", label: "", color: `hsl(${Math.floor(Math.random() * 360)}, 95%, 35%)` });
    expect(styleOf(m.render(), "marker")).toContain(WHITE_OUTLINED);
  });

  it("outlines on all four sides", () => {
    for (const offset of ["-1px -1px", "1px -1px", "-1px 1px", "1px 1px"]) {
      expect(LABEL_OUTLINE).toContain(`${offset} 0 rgba(0, 0, 0, 0.8)`);
    }
  });

  it.each(["transparent", "TRANSPARENT", " transparent ", "", "   ", null, undefined, 42])(
    "leaves the theme colour alone, no outline, for %p", (value) => {
      expect(labelTextStyle(value)).toBe("color: inherit;");
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
  it("fills the normal marker with the entity colour, with white outlined text", () => {
    const style = styleOf(marker({}), "marker");
    expect(style).toContain("background-color: #F29F05");
    expect(style).toContain("border-color: #F29F05");
    expect(style).toContain(WHITE_OUTLINED);
    expect(style).not.toContain("color: #000000");
    expect(style).toContain("height: 28px");
    expect(style).toContain("width: 28px");
  });

  it("fills a picture marker too - a transparent colour keeps it clear, no outline", () => {
    const style = styleOf(marker({ picture: "/p.svg", color: "transparent" }), "marker");
    expect(style).toContain("background-color: transparent");
    expect(style).toContain("color: inherit;");
    expect(style).not.toContain("text-shadow");
  });

  it("leaves the place pill and its badges as they were", () => {
    const out = marker({ placeIcon: "mdi:home", callout: "false" });
    expect(out).toContain('class="place-pill"');
    expect(out).not.toContain("background-color");
    expect(out).not.toContain("text-shadow");
    expect(out).not.toContain("color: #FFFFFF");
  });
});
