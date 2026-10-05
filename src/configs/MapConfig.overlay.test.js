import MapConfig from "./MapConfig.js";
import { describe, expect, it } from "@jest/globals";

// tile_layers entries may carry `name` (a checkbox in the card's layer
// control) and `show: false` (start unticked). Lee, 2026-10-05.

const cfg = (tile_layers) => new MapConfig({ x: 0.1, y: 0.1, tile_layers });

describe("tile_layers name and show", () => {
  it("are read, the name trimmed", () => {
    const [a] = cfg([{ url: "u", name: "  Rail lines ", show: false }]).tileLayers;
    expect(a.name).toBe("Rail lines");
    expect(a.show).toBe(false);
    expect(a.url).toBe("u");
  });

  it("absent: no name, shown, exactly as before", () => {
    const [a] = cfg([{ url: "u" }]).tileLayers;
    expect(a.name).toBeNull();
    expect(a.show).toBe(true);
  });

  it.each(["", "   ", 7, true, null])("name %p is no name", (n) => {
    expect(cfg([{ url: "u", name: n }]).tileLayers[0].name).toBeNull();
  });

  it.each([true, undefined, "false", 0, null])("show %p is shown: only a JSON false hides", (s) => {
    expect(cfg([{ url: "u", name: "R", show: s }]).tileLayers[0].show).toBe(true);
  });

  it("a single entry, not a list, still works", () => {
    expect(cfg({ url: "u", name: "R" }).tileLayers[0].name).toBe("R");
  });
});
