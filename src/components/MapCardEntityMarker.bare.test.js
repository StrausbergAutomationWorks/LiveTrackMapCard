import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "", unsafeCSS: () => "" };
});

import MapCardEntityMarker, { headingTag, TAG_DEFAULT_ANGLE } from "./MapCardEntityMarker.js";

// D4a-picture (Lee 2026-10-15 03:21, 03:38): VR's night-train figures and the
// mokki. A BARE picture has no disc and no ring behind it, is not clipped, may
// carry its label as a heading tag, and shows its delay beside it.
const GREEN = "#00B451", WHITE = "#FFFFFF";
const render = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 46, title: "IC 23", prefix: "", suffix: "", label: "", color: "#757575",
    ringColor: "", labelColor: "", labelOutline: "", shape: "", labelPlacement: "",
    rotationTransition: "3", arrow: "", picture: "/api/x/mokki.svg", barePicture: "true", ...props });
  return m.render();
};
const tagOf = (out) => (out.match(/<div class="heading-tag" style="([^"]*)">([^<]*)<\/div>/) || []);
const markerDiv = (out) => (out.match(/<div\s+class="(marker[^"]*)"\s+style="([^"]*)"/) || []);

describe("a bare picture", () => {
  it("draws the picture with no disc and no ring behind it", () => {
    const out = render({ ringColor: GREEN });
    const [, cls, style] = markerDiv(out);
    expect(cls).toMatch(/\bpicture bare\b/);
    expect(style).toContain("background-color: transparent; border-color: transparent;");
    expect(style).not.toContain("#757575");
    expect(style).not.toContain(GREEN);
    expect(out).toContain("background-image: url(/api/x/mokki.svg)");
  });

  it("is not clipped: its own class, whose CSS undoes the picture's overflow", () => {
    expect(markerDiv(render({}))[1]).toContain("bare");
    expect(markerDiv(render({ barePicture: "" }))[1]).not.toContain("bare");
  });

  it("with no heading placement: no tag, no label drawn on it", () => {
    const out = render({});
    expect(out).not.toContain("heading-tag");
    expect(out).not.toContain("IC 23");
  });

  it("the label as a heading tag beside it, in the ring colour, white number", () => {
    const out = render({ labelPlacement: "heading", ringColor: GREEN, labelColor: WHITE });
    const [, style, text] = tagOf(out);
    expect(text).toBe("IC 23");
    expect(style).toContain(`background-color: ${GREEN}; color: ${WHITE};`);
    const g = headingTag(TAG_DEFAULT_ANGLE, 46, "IC 23");
    expect(style).toContain(`left: calc(50% + ${g.x}px); top: calc(50% + ${g.y}px);`);
    expect(out).toContain("background-image: url(/api/x/mokki.svg)");
  });

  it("the delay opposite its tag", () => {
    const out = render({ labelPlacement: "heading", delayBadge: "+8", delayLevel: "amber" });
    const g = headingTag(TAG_DEFAULT_ANGLE + 180, 46, "+8", true);
    expect(out).toContain(`<span class="heading-delay" style="left: calc(50% + ${g.x}px); top: calc(50% + ${g.y}px);`);
    expect(out).toContain(">+8</span>");
  });

  it("with no tag, the delay east of the picture (the reindeer and the snowman)", () => {
    const out = render({ delayBadge: "+8", delayLevel: "amber" });
    const g = headingTag(TAG_DEFAULT_ANGLE, 46, "+8", true);
    expect(g.x).toBeGreaterThan(0);
    expect(out).toContain(`left: calc(50% + ${g.x}px); top: calc(50% + ${g.y}px);`);
    expect(out).toContain(">+8</span>");
    expect(out).not.toContain("label-with-badge");
  });

  it("nothing on time", () => {
    expect(render({ delayBadge: "", delayLevel: "" })).not.toContain("heading-delay");
  });

  it("the stall pulse may show", () => {
    expect(render({ pulse: "true", delayBadge: "+8", delayLevel: "amber" })).toContain("stall-pulse");
  });

  it("no arrow on it, as on any picture", () => {
    expect(render({ arrow: "90" })).not.toContain('<svg class="arrow"');
  });
});

describe("any other picture is unchanged", () => {
  const plain = (props) => render({ barePicture: "", ...props });

  it("keeps its disc, ring and clipping class", () => {
    const [, cls, style] = markerDiv(plain({ color: "transparent" }));
    expect(cls).not.toContain("bare");
    expect(style).toContain("background-color: transparent;");
    expect(style).toContain("border-color: transparent;");
    expect(markerDiv(plain({}))[2]).toContain("background-color: #757575;");
  });

  it("refuses the heading tag, shows no delay and no pulse", () => {
    const out = plain({ labelPlacement: "heading", delayBadge: "+8", delayLevel: "amber", pulse: "true" });
    expect(out).not.toContain("heading-tag");
    expect(out).not.toContain("heading-delay");
    expect(out).not.toContain("stall-pulse");
  });

  it.each(["", "false", "TRUE", undefined])("bare-picture %p is not bare", (barePicture) => {
    expect(markerDiv(plain({ barePicture }))[1]).not.toContain("bare");
  });

  it("bare-picture without a picture draws the label marker", () => {
    const out = render({ picture: "" });
    expect(markerDiv(out)[1]).not.toContain("bare");
    expect(out).toContain("IC 23");
  });
});
