import { describe, expect, it, jest } from "@jest/globals";

// Render templates to plain strings, values included (as the fill tests do).
jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "" };
});

import MapCardEntityMarker, { labelTextStyle, arrowStyle, LABEL_OUTLINE } from "./MapCardEntityMarker.js";

// Backlog 238: a label colour per marker, and an arrow that turns on its own.

const WHITE_OUTLINED = `color: #FFFFFF; text-shadow: ${LABEL_OUTLINE};`;

/**
 * A rendered disc marker.
 * @param {object} props marker properties
 * @returns {string} the rendered template
 */
const render = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 24, title: "601", prefix: "", suffix: "", label: "", color: "#EF8322",
    rotationTransition: "2", ...props });
  return m.render();
};
/**
 * The style attribute of the element with `cls`.
 * @param {string} out rendered template
 * @param {string} cls class name
 * @returns {string}
 */
const styleOf = (out, cls) => {
  const m = out.match(new RegExp(`class="${cls}[^"]*"[^>]*?style="([^"]*)"`, "s"));
  return m ? m[1] : "";
};

describe("labelTextStyle with a label colour", () => {
  it("draws the label in that colour and KEEPS the outline", () => {
    expect(labelTextStyle("#EF8322", "#7F281F")).toBe(`color: #7F281F; text-shadow: ${LABEL_OUTLINE};`);
  });

  it("keeps the outline without a fill too", () => {
    expect(labelTextStyle("transparent", "#7F281F")).toBe(`color: #7F281F; text-shadow: ${LABEL_OUTLINE};`);
  });

  it.each([undefined, null, "", "   "])("falls back to white for %p", (l) => {
    expect(labelTextStyle("#EF8322", l)).toBe(WHITE_OUTLINED);
  });

  it("reaches the rendered marker", () => {
    expect(styleOf(render({ labelColor: "#7F281F" }), "marker")).toContain(`color: #7F281F; text-shadow: ${LABEL_OUTLINE};`);
    expect(styleOf(render({ labelColor: "" }), "marker")).toContain(WHITE_OUTLINED);
  });
});

describe("the arrow", () => {
  it("is drawn when there is an angle, turned by its FRAME with the rotation transition", () => {
    const out = render({ arrow: "90" });
    expect(out).toContain('class="arrow-frame"');
    expect(styleOf(out, "arrow-frame")).toBe("transform: rotate(90deg); transition: transform 2s linear;");
  });

  it("turns only the arrow: the disc and its label carry no rotation", () => {
    const out = render({ arrow: "250", labelColor: "#7F281F" });
    expect(styleOf(out, "marker")).not.toContain("rotate");
    expect(out.indexOf("601")).toBeGreaterThan(out.indexOf("</div>")); // label outside the frame
  });

  it("keeps an accumulated angle as given, so the turn is short", () => {
    expect(styleOf(render({ arrow: "370" }), "arrow-frame")).toContain("rotate(370deg)");
    expect(styleOf(render({ arrow: "-20" }), "arrow-frame")).toContain("rotate(-20deg)");
  });

  it("is filled with the marker's fill and outlined dark", () => {
    const out = render({ arrow: "0", color: "#7F281F" });
    expect(out).toMatch(/<path [^>]*fill="#7F281F"/);
    expect(out).toContain('stroke="rgba(0, 0, 0, 0.8)"');
  });

  it("uses the text colour when the marker has no fill", () => {
    expect(render({ arrow: "0", color: "transparent" })).toMatch(/<path [^>]*fill="currentColor"/);
  });

  it("sits OUTSIDE the disc, above its top edge before turning", () => {
    const out = render({ arrow: "0", size: 24 });
    // w = round(24 * 0.45) = 11, h = round(11 * 0.75) = 8 -> top -9px
    expect(out).toMatch(/class="arrow" width="11" height="8"/);
    expect(out).toContain("top: -9px;");
  });

  it.each([undefined, "", "  ", "north", "NaN"])("is not drawn for %p", (arrow) => {
    expect(render({ arrow })).not.toContain("arrow-frame");
  });

  it("is not drawn on a picture marker, which clips its overflow", () => {
    expect(render({ arrow: "90", picture: "/x.png" })).not.toContain("arrow-frame");
  });

  it("arrowStyle is empty without an angle", () => {
    expect(arrowStyle("", "2")).toBe("");
    expect(arrowStyle("45", undefined)).toBe("transform: rotate(45deg); transition: transform 0s linear;");
  });
});
