// Counters for the marker drawing paths (canvas, culling, skipped updates). They cost an
// increment each and are read by the measuring scripts in the page as
// window.__LTMC_MARKER_STATS; nothing in the card reads them back.

/** @type {{[name: string]: number}} */
export const stats = (globalThis.__LTMC_MARKER_STATS = globalThis.__LTMC_MARKER_STATS || {
  skipped: 0, updated: 0, draws: 0, drawMs: 0, drawn: 0, spritesBuilt: 0,
  promoted: 0, toDom: 0, culledOut: 0, culledIn: 0, animatedPictures: 0, bandMoves: 0, spritesEvicted: 0,
});
