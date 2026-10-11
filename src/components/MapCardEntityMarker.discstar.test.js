import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "", unsafeCSS: () => "" };
});

import MapCardEntityMarker, {
  DISC_STAR_COLOR, DISC_STAR_DROP, DISC_STAR_SIZE, STAR_INNER, starPoints,
} from "./MapCardEntityMarker.js";

// SE Queensland's grey special shuttles (Lee 2026-10-11 05:21, 05:23 "fuller,
// small margin"): a white star filling the disc in place of a label.
const GREY = "#666D8E", DARK = "#0A1116";
const render = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 36, title: "1SF8", prefix: "", suffix: "", label: "", color: DARK,
    ringColor: GREY, ringWidth: "4", labelColor: "#FFFFFF", labelOutline: "none", shape: "",
    symbol: "star", labelPlacement: "", symbolColor: "", symbolOutline: "", rotationTransition: "3",
    arrow: "20", arrowColor: GREY, arrowOutline: "#000000", ...props });
  return m.render();
};
const symbolSvg = (out) => (out.match(/<svg class="disc-symbol"[\s\S]*?<\/svg>/) || [""])[0];

describe("the star inside the disc", () => {
  it("the decided proportions: the fuller star, points at 0.88 of the inner disc, dropped 0.06", () => {
    expect(DISC_STAR_SIZE).toBe(0.88);
    expect(DISC_STAR_DROP).toBe(0.06);
    expect(STAR_INNER).toBe(0.5);
    const svg = symbolSvg(render({}));
    expect(svg).toContain('viewBox="-100 -100 200 200"');
    expect(svg).toContain(`points="${starPoints(88, 0.5)}"`);
    expect(svg).toContain('transform="translate(0 5.28)"');
  });

  it("white by default with no outline; the emitter's colours when sent", () => {
    expect(DISC_STAR_COLOR).toBe("#FFFFFF");
    expect(symbolSvg(render({}))).toContain('fill="#FFFFFF" stroke="none"');
    expect(symbolSvg(render({ symbolColor: "#FFCC00", symbolOutline: DARK }))).toContain(`fill="#FFCC00" stroke="${DARK}"`);
    expect(symbolSvg(render({ symbolColor: "  ", symbolOutline: "  " }))).toContain('fill="#FFFFFF" stroke="none"');
  });

  it("is on the disc with its ring and the arrow, as every disc", () => {
    const out = render({});
    expect(out).toContain(`background-color: ${DARK};`);
    expect(out).toContain(`border-color: ${GREY}; border-width: 4px;`);
    expect(out).toContain('<svg class="arrow"');
    expect(out.indexOf('class="disc-symbol"')).toBeLessThan(out.indexOf('class="arrow-frame"'));
  });

  it("replaces the label: the run number is not drawn", () => {
    expect(render({})).not.toContain("1SF8");
    expect(render({ symbol: "" })).toContain("1SF8");
  });

  it("keeps the delay badge", () => {
    const out = render({ delayBadge: "+9", delayLevel: "amber" });
    expect(out).toContain('class="delay-badge"');
    expect(out).toContain(">+9</span>");
    expect(out).not.toContain("1SF8");
  });

  it("a picture or an icon wins over the star", () => {
    expect(render({ picture: "/p.png" })).not.toContain("disc-symbol");
    expect(render({ icon: "mdi:train" })).not.toContain("disc-symbol");
  });

  it("only on the disc: the star and maple shapes draw their own", () => {
    expect(render({ shape: "star" })).not.toContain("disc-symbol");
    expect(render({ shape: "maple" })).not.toContain("disc-symbol");
  });

  it.each(["", "Star", " star", "circle", undefined])("symbol %p draws no star", (symbol) => {
    expect(render({ symbol })).not.toContain("disc-symbol");
  });
});
