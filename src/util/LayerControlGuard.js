/**
 * A folded layer control must not tick a box with the click that opened it
 * (Lee, 2026-11-19, seen on the look page).
 *
 * Folded, Leaflet's layer control opens on hover with a mouse, so the list
 * appears under the pointer and the click aimed at the icon lands on the
 * first row: "Rail lines" was switched off, and the choice stored. Leaflet
 * 1.9.4 guards against this only until the next tick (`_expandSafely`, a
 * `setTimeout` with no delay), which a human click does not beat.
 *
 * So: watch the control's own class for the moment it opens (no private
 * Leaflet API), and for GUARD_MS after that, swallow clicks on its rows
 * (captured before Leaflet's handlers; the default action prevented, so a
 * checkbox keeps its state). A deliberate choice after that works as before.
 */
export const GUARD_MS = 400;
export const EXPANDED_CLASS = "leaflet-control-layers-expanded";
const LIST = ".leaflet-control-layers-list";

/**
 * @param {HTMLElement} container the layer control's container
 * @param {{ms?: number, now?: () => number}} [options]
 * @returns {() => void} undo
 */
export function guardFirstClick(container, options = {}) {
  if (!container || typeof container.addEventListener !== "function") return () => {};
  const ms = options.ms ?? GUARD_MS;
  const now = options.now ?? (() => Date.now());
  let openedAt = -Infinity;
  let wasOpen = container.classList.contains(EXPANDED_CLASS);
  const watch = () => {
    const open = container.classList.contains(EXPANDED_CLASS);
    if (open && !wasOpen) openedAt = now();
    wasOpen = open;
  };
  const Observer = globalThis.MutationObserver;
  const observer = Observer ? new Observer(watch) : null;
  observer?.observe(container, { attributes: true, attributeFilter: ["class"] });
  const onClick = (e) => {
    watch(); // a class change not yet delivered to the observer
    if (now() - openedAt >= ms) return;
    const t = e.target;
    if (!t || typeof t.closest !== "function" || !t.closest(LIST)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  container.addEventListener("click", onClick, true);
  return () => {
    observer?.disconnect();
    container.removeEventListener("click", onClick, true);
  };
}
