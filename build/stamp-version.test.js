import { describe, expect, it, jest } from "@jest/globals";
import { TOKEN, buildVersion, bannerFor, isDirty, parseBanner, releaseProblems, stampVersion } from "./stamp-version.js";

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

// rollup -c --bundleConfigAsCjs compiles the config to
// rollup.config-<timestamp>.cjs NEXT TO the config, runs it and deletes it
// (rollup/dist/shared/loadConfigFile.js). While the config runs, git sees that
// file as untracked - so every build called itself dirty.
describe("isDirty", () => {
  it("is clean for an empty status", () => {
    expect(isDirty("")).toBe(false);
    expect(isDirty("\n")).toBe(false);
  });

  it("ignores rollup's own temporary config", () => {
    expect(isDirty("?? rollup.config-1789520000000.cjs\n")).toBe(false);
    expect(isDirty("?? rollup.config-1789520000000.mjs")).toBe(false);
  });

  it("counts a modified tracked file", () => {
    expect(isDirty(" M src/index.js\n")).toBe(true);
  });

  it("counts an untracked source file - it may be in the bundle", () => {
    expect(isDirty("?? src/new.js\n")).toBe(true);
  });

  it("counts anything else alongside rollup's file", () => {
    expect(isDirty("?? rollup.config-1789520000000.cjs\n M rollup.config.js\n")).toBe(true);
  });

  it("does not excuse a lookalike", () => {
    expect(isDirty("?? rollup.config-final.cjs\n")).toBe(true);
    expect(isDirty("?? src/rollup.config-1789520000000.cjs\n")).toBe(true);
    expect(isDirty(" M rollup.config-1789520000000.cjs\n")).toBe(true);
  });
});

// Run in CI after the build, before anything is published.
describe("releaseProblems", () => {
  const good = {
    packageVersion: "0.1.0",
    git: { gitHash: "82a9634", dirty: false },
    bannerVersion: "0.1.0+82a9634",
    tag: "v0.1.0",
  };

  it("passes a clean, matching, tagged build", () => {
    expect(releaseProblems(good)).toEqual([]);
  });

  it("passes an untagged build - a CI run, not a release", () => {
    expect(releaseProblems({ ...good, tag: "" })).toEqual([]);
    expect(releaseProblems({ ...good, tag: undefined })).toEqual([]);
  });

  it("refuses a tag that disagrees with package.json", () => {
    expect(releaseProblems({ ...good, tag: "v0.1.1" }).join()).toMatch(/v0\.1\.1.*0\.1\.0/);
    expect(releaseProblems({ ...good, tag: "0.1.0" }).join()).toMatch(/tag/);
  });

  it("refuses a dirty build", () => {
    const p = releaseProblems({ ...good, git: { gitHash: "82a9634", dirty: true }, bannerVersion: "0.1.0+82a9634.dirty" });
    expect(p.join()).toMatch(/uncommitted/);
  });

  it("refuses a build made without git", () => {
    const p = releaseProblems({ ...good, git: { gitHash: null, dirty: false }, bannerVersion: "0.1.0+nogit" });
    expect(p.join()).toMatch(/git/);
  });

  it("refuses a bundle built from a different commit", () => {
    expect(releaseProblems({ ...good, bannerVersion: "0.1.0+3ad7dca" }).join()).toMatch(/3ad7dca.*82a9634/);
  });

  it("refuses a bundle with no header", () => {
    expect(releaseProblems({ ...good, bannerVersion: null }).join()).toMatch(/header/);
  });

  it("refuses a package version that is not semver", () => {
    expect(releaseProblems({ ...good, packageVersion: "1.0", tag: "v1.0", bannerVersion: "1.0+82a9634" }).join()).toMatch(/semver/);
  });

  it("reports every problem, not just the first", () => {
    const p = releaseProblems({ ...good, tag: "v9.9.9", git: { gitHash: "82a9634", dirty: true }, bannerVersion: null });
    expect(p.length).toBe(3);
  });
});
