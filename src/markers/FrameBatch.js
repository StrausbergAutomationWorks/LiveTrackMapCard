// The card's update waits for the next animation frame (map capacity, card SSOT 2026-10-25):
// every hass change that lands before that frame is one update, and the work leaves Home
// Assistant's websocket task. In a hidden tab no frame comes, so no update runs until the
// tab is shown again, and then one does.

/**
 * A promise that settles on the next animation frame, or at once without one.
 * @param {(cb: (t: number) => void) => number} [raf] requestAnimationFrame
 * @returns {Promise<void>}
 */
export function nextFrame(raf = globalThis.requestAnimationFrame) {
  if (typeof raf !== "function") return Promise.resolve();
  return new Promise((resolve) => { raf(() => resolve()); });
}

/**
 * Run `update` after the next animation frame; its promise is the update's.
 * @template T
 * @param {() => T} update
 * @param {(cb: (t: number) => void) => number} [raf] requestAnimationFrame
 * @returns {Promise<Awaited<T>>}
 */
export function afterFrame(update, raf = globalThis.requestAnimationFrame) {
  return nextFrame(raf).then(() => update());
}
