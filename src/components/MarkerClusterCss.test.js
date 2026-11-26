import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MARKERCLUSTER_CSS } from "./MarkerClusterCss.js";

// LiveTrackMapCard#1 (hacs/default #14498): the markercluster stylesheets are bundled, not fetched from unpkg.
const ROOT = globalThis.process.cwd();   // jest runs from the repository root

describe("the bundled markercluster stylesheets", () => {
  it("are the package's two files, verbatim", () => {
    for (const f of ["MarkerCluster.css", "MarkerCluster.Default.css"]) {
      const css = readFileSync(join(ROOT, "node_modules", "leaflet.markercluster", "dist", f), "utf8").replace(/\r\n/g, "\n").trim();
      expect(MARKERCLUSTER_CSS).toContain(css);
    }
  });
  it("the card adds them to its styles and loads nothing from unpkg", () => {
    const src = readFileSync(join(ROOT, "src", "components", "MapCard.js"), "utf8");
    expect(src).not.toMatch(/unpkg\.com/);
    expect(src).toContain("unsafeCSS(MARKERCLUSTER_CSS)");
  });
  it("no file under src loads a stylesheet or script from another site", () => {
    const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const hits = walk(join(ROOT, "src")).filter((p) => p.endsWith(".js") && !p.endsWith(".test.js"))
      .filter((p) => /<link[^>]+href=["']https?:|<script[^>]+src=["']https?:/.test(readFileSync(p, "utf8")));
    expect(hits).toEqual([]);
  });
});
