// PROTOTYPE ONLY (map capacity, 2026-10-25; card SSOT "HOW MANY MARKERS"). Not for release.
//
// Switches read at USE, so a page can change them between runs without a rebuild:
//   globalThis.__LTMC_PROTO = { canvas: true, cull: true, diff: true, batch: true }
// canvas - plain markers drawn on one canvas; DOM only for badges, rings, special shapes, hover
// cull   - DOM markers off screen (padded) are taken off the map until they come back
// diff   - an entity whose state object is unchanged is not updated on a hass change
// batch  - the card's Lit update waits for the next animation frame, so a burst is one update

/**
 * @param {string} name
 * @returns {boolean}
 */
export function proto(name) {
  const f = globalThis.__LTMC_PROTO;
  return Boolean(f && f[name]);
}

/** Counters the page reads (window.__LTMC_PROTO_STATS). */
export const stats = (globalThis.__LTMC_PROTO_STATS = globalThis.__LTMC_PROTO_STATS || {
  skipped: 0, updated: 0, draws: 0, drawMs: 0, drawn: 0, spritesBuilt: 0,
  promoted: 0, toDom: 0, culledOut: 0, culledIn: 0, animatedPictures: 0,
});
