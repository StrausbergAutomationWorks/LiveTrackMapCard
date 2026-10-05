/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED, NOTICES_HEAD, missingNotices, noticesBanner, readNotice } from "./notices.js";

// Backlog 272: Leaflet (BSD-2), leaflet.markercluster (MIT) and lit (BSD-3)
// ask for their notices to travel with copies; HACS hands users the bundle
// alone, so the notices go INTO the bundle, read verbatim from node_modules.

const root = process.cwd();
const all = BUNDLED.map((n) => readNotice(root, n));

describe("readNotice", () => {
  it("reads every bundled package's licence from node_modules", () => {
    const byName = Object.fromEntries(all.map((n) => [n.name, n]));
    expect(byName["leaflet"].license).toBe("BSD-2-Clause");
    expect(byName["leaflet"].text).toContain("Volodymyr Agafonkin");
    expect(byName["leaflet.markercluster"].license).toBe("MIT");
    expect(byName["leaflet.markercluster"].text).toContain("David Leaver");
    expect(byName["lit"].text).toContain("Google LLC");
    for (const n of all) expect(n.text.length).toBeGreaterThan(100);
  });

  it("covers Leaflet, markercluster, lit and the path-following packages", () => {
    for (const n of ["leaflet", "leaflet.markercluster", "lit", "lit-html", "lit-element", "@lit/reactive-element",
      "@mapbox/vector-tile", "pbf", "@mapbox/point-geometry"]) expect(BUNDLED).toContain(n);
  });

  it("throws when a package has no licence file: never ship silently without one", () => {
    const dir = mkdtempSync(join(tmpdir(), "ltmc-notice-"));
    mkdirSync(join(dir, "node_modules", "nolicence"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "nolicence", "package.json"), JSON.stringify({ version: "1.0.0", license: "MIT" }));
    expect(() => readNotice(dir, "nolicence")).toThrow(/no licence file/);
  });
});

describe("noticesBanner", () => {
  const banner = noticesBanner(all);

  it("is one preserved comment with every package's header and full text", () => {
    expect(banner.startsWith("/*!\n")).toBe(true);
    expect(banner.endsWith("\n */")).toBe(true);
    expect(banner.indexOf("*/")).toBe(banner.length - 2);
    expect(banner).toContain(NOTICES_HEAD);
    for (const n of all) {
      expect(banner).toContain(`---- ${n.name} ${n.version} (${n.license}) ----`);
      const last = n.text.trim().split(/\r?\n/).filter((l) => l.trim()).pop().trim();
      expect(banner).toContain(last);
    }
  });

  it("breaks up an end-of-comment inside a licence text", () => {
    const b = noticesBanner([{ name: "x", version: "1", license: "MIT", text: "a */ b" }]);
    expect(b.indexOf("*/")).toBe(b.length - 2);
    expect(b).toContain("a * / b");
  });
});

describe("missingNotices", () => {
  it("passes a bundle carrying the banner, and names each notice that is missing", () => {
    expect(missingNotices("x\n" + noticesBanner(all) + "\ncode", all)).toEqual([]);
    expect(missingNotices("code only", all)).toContain("no third-party notices block");
    const withoutLeaflet = noticesBanner(all.filter((n) => n.name !== "leaflet"));
    expect(missingNotices(withoutLeaflet, all)).toEqual([`notice missing for leaflet ${all[0].version}`]);
  });

  it("a header with the licence text missing is still a missing notice", () => {
    const gutted = all.map((n) => (n.name === "leaflet" ? { ...n, text: "(text removed)" } : n));
    expect(missingNotices(noticesBanner(gutted), all)).toEqual([`notice missing for leaflet ${all[0].version}`]);
  });
});
