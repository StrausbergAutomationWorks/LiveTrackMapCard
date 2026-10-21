import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "", unsafeCSS: () => "" };
});

import MapCardEntityMarker, { groundShadowStyle, SHADOW_FULL_M } from "./MapCardEntityMarker.js";

// D4a-shadow (Lee 2026-10-21): a picture marker casts a ground shadow from
// `altitude_m`, on the UNROTATED marker element, further away the higher.
const parse = (style) => {
  const m = style.match(/drop-shadow\(([\d.]+)px ([\d.]+)px ([\d.]+)px rgba\(0, 0, 0, ([\d.]+)\)\)/);
  return m ? { x: +m[1], y: +m[2], blur: +m[3], op: +m[4] } : null;
};

describe("groundShadowStyle", () => {
  it.each(["", "  ", null, undefined, "high", "NaN"])("no shadow for %p", (alt) => {
    expect(groundShadowStyle(alt, 60)).toBe("");
  });

  it.each([0, "", "x", -5, NaN])("no shadow without a usable size (%p)", (size) => {
    expect(groundShadowStyle("1000", size)).toBe("");
  });

  it("on the ground: close, sharp and dark", () => {
    expect(parse(groundShadowStyle("0", 60))).toEqual({ x: 1.5, y: 1.5, blur: 1.1, op: 0.55 });
  });

  it("at 40,000 ft: far, soft and faint", () => {
    expect(parse(groundShadowStyle(String(SHADOW_FULL_M), 60))).toEqual({ x: 8.7, y: 8.7, blur: 3.6, op: 0.3 });
  });

  it("stops growing above 40,000 ft and below the ground", () => {
    expect(groundShadowStyle("20000", 60)).toBe(groundShadowStyle(String(SHADOW_FULL_M), 60));
    expect(groundShadowStyle("-120", 60)).toBe(groundShadowStyle("0", 60));
  });

  it("moves away as the aircraft climbs", () => {
    const xs = [0, 300, 1500, 3000, 6000, 9750, 12192].map((a) => parse(groundShadowStyle(String(a), 60)).x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it("falls down and to the right, one direction for every angle", () => {
    const s = parse(groundShadowStyle("9750", 60));
    expect(s.x).toBe(s.y);
    expect(s.x).toBeGreaterThan(0);
  });

  it("scales with the marker", () => {
    expect(parse(groundShadowStyle("9750", 120)).x).toBeCloseTo(2 * parse(groundShadowStyle("9750", 60)).x, 0);
  });

  it("eases to a new altitude", () => {
    expect(groundShadowStyle("9750", 60)).toContain("transition: filter 3s linear;");
  });
});

const render = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 60, title: "UAL1", prefix: "", suffix: "", label: "", color: "transparent",
    ringColor: "", labelColor: "", labelOutline: "", shape: "", labelPlacement: "",
    rotation: "35", rotationTransition: "3", arrow: "", picture: "/api/live_track_aircraft/icon/b737/fixed.svg",
    barePicture: "", groundShadow: "9750", ...props });
  return m.render();
};
const markerDiv = (out) => (out.match(/<div\s+class="(marker[^"]*)"\s+style="([^"]*)"/) || []);
const pictureDiv = (out) => (out.match(/<div class="entity-picture" style="([^"]*)"/) || []);

describe("the element", () => {
  it("reads the ground-shadow attribute Entity writes", () => {
    expect(MapCardEntityMarker.properties.groundShadow).toEqual({ type: String, attribute: "ground-shadow" });
  });
});

describe("a picture marker with an altitude", () => {
  it("casts the shadow from the marker element, not the turning picture", () => {
    const out = render({});
    expect(markerDiv(out)[2]).toContain(groundShadowStyle("9750", 60));
    expect(pictureDiv(out)[1]).not.toContain("drop-shadow");
    expect(pictureDiv(out)[1]).toContain("rotate(35deg)");
  });

  it("keeps its round clipping class: the filter is drawn outside it", () => {
    expect(markerDiv(render({}))[1]).toMatch(/\bpicture\b/);
  });

  it("a bare picture casts it too", () => {
    expect(markerDiv(render({ barePicture: "true" }))[2]).toContain("drop-shadow");
  });

  it("no altitude, no shadow", () => {
    expect(markerDiv(render({ groundShadow: "" }))[2]).not.toContain("drop-shadow");
    expect(markerDiv(render({ groundShadow: undefined }))[2]).not.toContain("drop-shadow");
  });

  it("a marker with no picture never casts one", () => {
    const out = render({ picture: "" });
    expect(out).not.toContain("drop-shadow");
  });
});
