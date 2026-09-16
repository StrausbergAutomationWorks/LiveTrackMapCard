import { describe, expect, it, jest, beforeAll } from "@jest/globals";

jest.mock("lit", () => ({
  LitElement: class extends globalThis.HTMLElement {},
  html: () => "",
  css: () => "",
}));
jest.mock("leaflet");

import { VERSION } from "./version.js";

// Unbuilt source - jest - has no stamped version. The build replaces the
// token; build/stamp-version.test.js covers that side.
describe("VERSION", () => {
  it("is a recognisable placeholder when the source is not built", () => {
    expect(VERSION).toBe("0.0.0-unbuilt");
  });
});

describe("the running card reports its version", () => {
  let info, MapCard;

  beforeAll(async () => {
    window.customCards = [];
    info = jest.spyOn(console, "info").mockImplementation(() => {});
    await import("./index.js");
    MapCard = customElements.get("live-track-map-card");
  });

  it("on the element class", () => {
    expect(MapCard).toBeDefined();
    expect(MapCard.version).toBe(VERSION);
  });

  it("in the console banner, with no upstream placeholder", () => {
    const banner = info.mock.calls.map((c) => c[0]).find((m) => String(m).includes("LiveTrackMapCard"));
    expect(banner).toContain(VERSION);
    expect(banner).not.toContain("HA_MAP_CARD_VERSION");
  });

  it("in the card picker entry", () => {
    const entry = window.customCards.find((c) => c.type === "live-track-map-card");
    expect(entry.version).toBe(VERSION);
  });
});
