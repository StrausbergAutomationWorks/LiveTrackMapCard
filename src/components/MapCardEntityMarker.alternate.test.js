import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "", unsafeCSS: () => "" };
});

import MapCardEntityMarker, { ALTERNATE_PROPS } from "./MapCardEntityMarker.js";

// The Maple Leaf (Lee 2026-10-11 16:11): Amtrak 63's star, fading to VIA 98's maple badge and back.
const alt = (look, s = 4) => encodeURIComponent(JSON.stringify({ ...look, s }));
const VIA98 = { shape: "maple", title: "98", color: "#323198", ringColor: "#FFCC00", symbolColor: "#FF0000",
  symbolOutline: "#FFFFFF", labelPlacement: "heading" };
const make = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 46, title: "63", prefix: "", suffix: "", label: "", color: "#FFFFFF", ringColor: "#3C3B6E",
    labelColor: "#B22234", labelOutline: "", shape: "star", symbol: "", labelPlacement: "", symbolColor: "",
    symbolOutline: "", rotationTransition: "3", arrow: "45", alternate: alt(VIA98), ...props });
  return m;
};
const layers = (out) => {
  const i = out.indexOf('class="alt-layer alt-b"');
  return [out.slice(0, i), out.slice(i)];
};

describe("two looks that take turns", () => {
  it("the primary look first, the alternate second, stacked", () => {
    const out = make({}).render();
    expect(out).toContain('<div class="alt-wrap" style="height: 46px; width: 46px;">');
    const [a, b] = layers(out);
    expect(a).toContain('class="alt-layer alt-a"');
    expect(a).toMatch(/class="marker star /);
    expect(a).not.toContain("maple-shape");
    expect(a).toContain(">63<");
    expect(b).toMatch(/class="marker maple /);
    expect(b).toContain('class="heading-tag"');
    expect(b).toContain(">98</div>");
    expect(b).not.toContain(">63<");
  });

  it("each look shown for its seconds: the cycle is twice that", () => {
    const out = make({ alternate: alt(VIA98, 5) }).render();
    expect(out.match(/animation-duration: 10s;/g)).toHaveLength(2);
    expect(make({ alternate: alt(VIA98, 0) }).render()).toContain("animation-duration: 8s;");
  });

  it("the element's own look is put back after drawing the alternate", () => {
    const m = make({});
    m.render();
    expect([m.shape, m.title, m.color, m.ringColor, m.labelPlacement, m.symbolOutline])
      .toEqual(["star", "63", "#FFFFFF", "#3C3B6E", "", ""]);
  });

  it("an absent key keeps the primary's value", () => {
    const [, b] = layers(make({ alternate: alt({ title: "98" }) }).render());
    expect(b).toMatch(/class="marker star /);
    expect(b).toContain(">98<");
  });

  it("only the look properties are swapped", () => {
    expect(ALTERNATE_PROPS).not.toContain("arrow");
    expect(ALTERNATE_PROPS).not.toContain("size");
    expect(ALTERNATE_PROPS).not.toContain("delayBadge");
    const out = make({ alternate: alt({ ...VIA98, size: 99, arrow: "200", delayBadge: "+99" }) }).render();
    expect(out).not.toContain("99px");
    expect(out).not.toContain("+99");
  });

  it.each(["", undefined, "%7B%7D", alt({}), "not-json%", "%22x%22"])("no alternate for %p: one look, no wrapper", (a) => {
    const out = make({ alternate: a }).render();
    expect(out).not.toContain("alt-wrap");
    expect(out).toMatch(/class="marker star /);
  });

  it("not for a pill", () => {
    expect(make({ placeIcon: "mdi:home" }).render()).not.toContain("alt-wrap");
  });

  it("the delay shows in both looks", () => {
    const [a, b] = layers(make({ delayBadge: "+12", delayLevel: "amber" }).render());
    expect(a).toContain("+12");
    expect(b).toContain("+12");
  });
});
