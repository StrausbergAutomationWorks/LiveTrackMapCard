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

// rollup -c --bundleConfigAsCjs writes rollup.config-<timestamp>.cjs next to
// the config, runs it and deletes it (rollup/dist/shared/loadConfigFile.js).
// While this code runs, git sees that file - so it must not count as dirt.
const ROLLUP_TEMP_CONFIG = /^\?\? rollup\.config-\d+\.[cm]js$/;

/**
 * Whether `git status --porcelain` output shows changes that could be in the
 * build. Untracked files count - an untracked source file can be imported -
 * except rollup's own temporary config.
 * @param {string} porcelain
 * @returns {boolean}
 */
export function isDirty(porcelain) {
  return String(porcelain ?? "")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "")
    .some((line) => !ROLLUP_TEMP_CONFIG.test(line));
}

/**
 * The commit being built, or nulls when there is no usable git.
 * @param {string} cwd
 * @returns {{gitHash: (string|null), dirty: boolean}}
 */
export function readGit(cwd) {
  try {
    const run = (cmd) => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return { gitHash: run("git rev-parse --short HEAD"), dirty: isDirty(run("git status --porcelain")) };
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
 * Everything that makes a built bundle unfit to PUBLISH. Empty means fit.
 * Run after the build; the build itself already refuses an unstamped file.
 * @param {{packageVersion: string, git: {gitHash: (string|null), dirty: boolean},
 *          bannerVersion: (string|null), tag: (string|undefined)}} facts
 *   tag: the git tag being released, e.g. "v0.1.0"; empty for a CI build.
 * @returns {string[]}
 */
export function releaseProblems({ packageVersion, git, bannerVersion, tag }) {
  const problems = [];
  let expected = null;
  try {
    expected = buildVersion({ packageVersion, gitHash: git?.gitHash ?? null, dirty: !!git?.dirty });
  } catch (e) {
    problems.push(e.message);
  }
  if (!git?.gitHash) problems.push("built without git - nothing identifies the commit");
  if (git?.dirty) problems.push("built from uncommitted changes");
  if (bannerVersion == null) {
    problems.push("bundle has no version header");
  } else if (expected && bannerVersion !== expected) {
    problems.push(`bundle says ${bannerVersion}, but this commit builds ${expected}`);
  }
  if (tag && tag !== `v${packageVersion}`) {
    problems.push(`tag ${tag} does not match package.json version ${packageVersion}`);
  }
  // Card SSOT 67.2: integrations ship only releases, so one semver is one file. A prerelease
  // ("0.1.1-dev") is the development line between releases and is never tagged as one.
  if (tag && typeof packageVersion === "string" && packageVersion.includes("-")) {
    problems.push(`package.json version ${packageVersion} is a prerelease: set the release version before tagging`);
  }
  return problems;
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
