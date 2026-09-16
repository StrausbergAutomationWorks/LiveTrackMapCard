/* global __LTMC_VERSION__ */

/**
 * This card's version, stamped in at build time by build/stamp-version.js:
 * package.json's version plus the commit, e.g. "0.1.0+2a37a80".
 *
 * Unbuilt source - under jest, say - has no stamp and reports
 * "0.0.0-unbuilt", which can never be mistaken for a release.
 * @type {string}
 */
export const VERSION = typeof __LTMC_VERSION__ === "string" ? __LTMC_VERSION__ : "0.0.0-unbuilt";
