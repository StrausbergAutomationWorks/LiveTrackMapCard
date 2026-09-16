import { describe, expect, it, jest } from "@jest/globals";
import { TOKEN, buildVersion, bannerFor, parseBanner, stampVersion } from "./stamp-version.js";

// The build stamps the real version into the bundle. Without it the banner
// printed a literal token and nothing could tell which build a browser had
// loaded; and integrations that register this card compare versions.

describe("buildVersion", () => {
  it("adds the commit as semver build metadata", () => {
    expect(buildVersion({ packageVersion: "0.1.0", gitHash: "2a37a80", dirty: false })).toBe("0.1.0+2a37a80");
  });

  it("marks a build from uncommitted changes", () => {
    expect(buildVersion({ packageVersion: "0.1.0", gitHash: "2a37a80", dirty: true })).toBe("0.1.0+2a37a80.dirty");
  });

  it("says so when there is no git", () => {
    expect(buildVersion({ packageVersion: "0.1.0", gitHash: null, dirty: false })).toBe("0.1.0+nogit");
  });

  it("keeps a prerelease", () => {
    expect(buildVersion({ packageVersion: "1.2.3-beta.1", gitHash: "abc1234", dirty: false })).toBe("1.2.3-beta.1+abc1234");
  });

  it.each(["", "1.0", "v1.0.0", "1.0.0+meta", "1.0.0 ", undefined, "01.0.0"])(
    "refuses a package version that is not plain semver: %p", (v) => {
      expect(() => buildVersion({ packageVersion: v, gitHash: "abc1234", dirty: false })).toThrow(/version/);
    });

  it("refuses a hash that is not hex", () => {
    expect(() => buildVersion({ packageVersion: "0.1.0", gitHash: "HEAD", dirty: false })).toThrow(/hash/);
  });
});

describe("banner", () => {
  it("is one comment line a non-JavaScript reader can parse", () => {
    const b = bannerFor("0.1.0+2a37a80");
    expect(b).toBe("/*! live-track-map-card 0.1.0+2a37a80 */");
    expect(b).not.toContain("\n");
    expect(parseBanner(b + "\n'use strict';\n")).toBe("0.1.0+2a37a80");
  });

  it("is found only on the first line", () => {
    expect(parseBanner("'use strict';\n/*! live-track-map-card 0.1.0+x */")).toBeNull();
    expect(parseBanner("")).toBeNull();
  });
});

describe("stampVersion plugin", () => {
  const V = "0.1.0+2a37a80";
  const plugin = stampVersion(V);

  it("replaces the token with the version as a string literal", () => {
    const out = plugin.transform(`export const VERSION = typeof ${TOKEN} === "string" ? ${TOKEN} : "x";`, "/src/version.js");
    expect(out.code).toBe(`export const VERSION = typeof "${V}" === "string" ? "${V}" : "x";`);
    expect(out.map).toBeNull();
  });

  it("leaves files without the token alone", () => {
    expect(plugin.transform("const a = 1;", "/src/a.js")).toBeNull();
  });

  it("leaves dependencies alone", () => {
    expect(plugin.transform(`const a = ${TOKEN};`, "/x/node_modules/lit/index.js")).toBeNull();
  });

  const run = (code) => {
    const ctx = { error: jest.fn((m) => { throw new Error(m); }) };
    return () => plugin.generateBundle.call(ctx, {}, { "live-track-map-card.js": { type: "chunk", code } });
  };

  it("fails the build if the token survives", () => {
    expect(run(`/*! live-track-map-card ${V} */\nconst v = "${V}"; ${TOKEN}`)).toThrow(/token/);
  });

  it("fails the build if the version never made it in", () => {
    expect(run(`/*! live-track-map-card ${V} */\nconst v = "0.0.0-unbuilt";`)).toThrow(/not stamped/);
  });

  it("fails the build if the header is missing or wrong", () => {
    expect(run(`const v = "${V}";`)).toThrow(/header/);
    expect(run(`/*! live-track-map-card 9.9.9 */\nconst v = "${V}";`)).toThrow(/header/);
  });

  it("passes a correctly stamped bundle", () => {
    expect(run(`/*! live-track-map-card ${V} */\nconst v = "${V}";`)).not.toThrow();
  });

  it("fails if the upstream placeholder is still there", () => {
    expect(run(`/*! live-track-map-card ${V} */\nconst v = "${V}"; "HA_MAP_CARD_VERSION"`)).toThrow(/HA_MAP_CARD_VERSION/);
  });
});
