import { describe, expect, it, jest } from "@jest/globals";

// Layer.render(show): a named overlay the viewer turned off is built, so the
// layer control can tick it back on, but NOT added to the map.

jest.mock("../leaflet/TileLayer.js", () => ({
  __esModule: true,
  default: jest.fn(function (url, options) { this.url = url; this.options = options; this.addTo = jest.fn(); }),
}));
jest.mock("../leaflet/WMS.js", () => ({ __esModule: true, default: jest.fn(function () { this.addTo = jest.fn(); }) }));
jest.mock("../util/Logger.js");

import Layer from "./Layer.js";

const resolver = { resolveUrl: (u) => u, registerLayer: jest.fn() };
const make = () => new Layer("tile", { url: "u", options: { opacity: 0.4 } }, { map: true }, resolver);

describe("Layer.render", () => {
  it("adds the layer to the map by default, and returns it", () => {
    const l = make().render();
    expect(l.addTo).toHaveBeenCalledWith({ map: true });
    expect(l.url).toBe("u");
  });

  it("render(false) builds and registers it, and does NOT add it", () => {
    resolver.registerLayer.mockClear();
    const l = make().render(false);
    expect(l.addTo).not.toHaveBeenCalled();
    expect(resolver.registerLayer).toHaveBeenCalledWith(l, "u");
  });
});
