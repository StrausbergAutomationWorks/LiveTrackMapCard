import { execSync } from "node:child_process";

/**
 * Version stamping for the built card.
 *
 * `src/version.js` refers to TOKEN; the build replaces it with the real
 * version - package.json's, plus the commit as semver build metadata, so two
 * builds of one release are told apart: `0.1.0+2a37a80`, or
 * `0.1.0+2a37a80.dirty` from uncommitted changes. Build metadata does not
 * count when versions are compared, so "highest version wins" is unaffected.
 *
 * The bundle's FIRST LINE carries the version too, in a comment a reader
 * that does not execute JavaScript can parse - an integration deciding
 * whether to register its copy.
 *
 * The build fails rather than ship an unstamped file. Silent staleness is the
 * failure this exists to end.
 */

export const TOKEN = "__LTMC_VERSION__";
const BANNER = /^\/\*! live-track-map-card (\S+) \*\//;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

/**
 * @param {{packageVersion: string, gitHash: (string|null), dirty: boolean}} parts
 * @returns {string}
 */
export function buildVersion({ packageVersion, gitHash, dirty }) {
  if (typeof packageVersion !== "string" || !SEMVER.test(packageVersion)) {
    throw new Error(`package.json version is not plain semver: ${JSON.stringify(packageVersion)}`);
  }
  if (gitHash == null) return `${packageVersion}+nogit`;
  if (!/^[0-9a-f]{4,40}$/.test(gitHash)) {
    throw new Error(`git hash is not hex: ${JSON.stringify(gitHash)}`);
  }
  return `${packageVersion}+${gitHash}${dirty ? ".dirty" : ""}`;
}

/**
 * The commit being built, or nulls when there is no usable git.
 * @param {string} cwd
 * @returns {{gitHash: (string|null), dirty: boolean}}
 */
export function readGit(cwd) {
  try {
    const run = (cmd) => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return { gitHash: run("git rev-parse --short HEAD"), dirty: run("git status --porcelain") !== "" };
  } catch {
    return { gitHash: null, dirty: false };
  }
}

/**
 * @param {string} version
 * @returns {string}
 */
export function bannerFor(version) {
  return `/*! live-track-map-card ${version} */`;
}

/**
 * The version in a built file's first line, or null.
 * @param {string} text
 * @returns {string|null}
 */
export function parseBanner(text) {
  const m = BANNER.exec(String(text ?? "").split("\n", 1)[0]);
  return m ? m[1] : null;
}

/**
 * Rollup plugin: replace TOKEN, then refuse any output that is not stamped.
 * @param {string} version
 * @returns {object}
 */
export function stampVersion(version) {
  const literal = JSON.stringify(version);
  return {
    name: "live-track-map-card-version",
    transform(code, id) {
      if (id.includes("node_modules") || !code.includes(TOKEN)) return null;
      return { code: code.split(TOKEN).join(literal), map: null };
    },
    generateBundle(_options, bundle) {
      for (const [file, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        const fail = (why) => this.error(`${file}: ${why}`);
        if (parseBanner(chunk.code) !== version) fail(`header does not carry ${version}`);
        if (chunk.code.includes(TOKEN)) fail(`version token ${TOKEN} survived the build`);
        if (chunk.code.includes("HA_MAP_CARD_VERSION")) fail("upstream placeholder HA_MAP_CARD_VERSION survived the build");
        if (!chunk.code.includes(literal)) fail(`version ${version} was not stamped into the code`);
      }
    },
  };
}
