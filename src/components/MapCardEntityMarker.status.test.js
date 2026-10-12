import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => {
  const html = (strings, ...values) =>
    strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i] ?? "") : ""), "");
  return { LitElement: class {}, html, css: () => "", unsafeCSS: () => "" };
});

import MapCardEntityMarker from "./MapCardEntityMarker.js";

// D4c-status (Lee 2026-10-11 20:23): the word sits where the delay does.
const make = (props) => {
  const m = new MapCardEntityMarker();
  Object.assign(m, { size: 46, title: "69", prefix: "", suffix: "", label: "", color: "#3FC3F4", ringColor: "#FB0001",
    labelColor: "#000000", labelOutline: "none", shape: "star", symbol: "", labelPlacement: "", symbolColor: "",
    symbolOutline: "", rotationTransition: "3", arrow: "20", alternate: "", delayBadge: "Customs", delayLevel: "status",
    ...props });
  return m;
};

describe("a status word in the badge's place", () => {
  it("beside a star's label, white", () => {
    const out = make({}).render();
    expect(out).toMatch(/color: #FFFFFF;[^>]*>Customs</);
  });

  it("on a disc", () => {
    expect(make({ shape: "" }).render()).toMatch(/class="delay-badge" style="color: #FFFFFF;[^"]*">Customs</);
  });

  it("opposite a heading tag", () => {
    expect(make({ shape: "maple", labelPlacement: "heading" }).render())
      .toMatch(/class="heading-delay"[^>]*color: #FFFFFF;[^>]*>Customs</);
  });
});
