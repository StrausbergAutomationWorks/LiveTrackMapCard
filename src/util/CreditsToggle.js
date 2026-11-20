import L from "leaflet";

/**
 * The map's credits box, collapsible (Lee, 2026-11-19).
 *
 * Every source drawn on the map is credited in Leaflet's attribution box
 * (contract D4d, the radar, clouds, lightning, shapes and points), and on a
 * phone that box had grown to cover 85-92% of the map. OpenStreetMap's
 * attribution guideline (OSMF, adopted 2021-06-25) lets an interactive map's
 * credits collapse automatically after five seconds or on map interaction,
 * provided an "(i)" button still leads to them. So:
 *
 * - the box opens in full with the map;
 * - it collapses after five seconds, or at the viewer's first press, scroll or
 *   key on the map, whichever comes first. Moves the card makes itself (the
 *   initial view, following) are not the viewer's and do not count; neither
 *   does anything inside a control, so a credit's link stays clickable;
 * - an "i" button beside it reopens it, at most 40% of the map's height and
 *   scrollable; the next press on the map, or the button, closes it again.
 *
 * Only classes, a max-height and a max-width are set on the box: Leaflet rewrites the box's
 * contents whenever a credit is added or removed, so nothing is put inside it.
 * The button is its own control in the same corner. A map without an
 * attribution control gets nothing.
 */
export const COLLAPSE_AFTER_MS = 5000;
export const OPEN_MAX_FRACTION = 0.4;
export const OPEN_SIDE_GAP_PX = 10;
export const COLLAPSED_CLASS = "ltmc-credits-collapsed";
export const OPEN_CLASS = "ltmc-credits-open";
export const BUTTON_LABEL = "Map data credits";

const USER_EVENTS = ["pointerdown", "touchstart", "wheel", "keydown"];

/**
 * `attribution_collapse`: anything but `false` collapses.
 * @param {*} value the dashboard's `attribution_collapse`
 * @returns {boolean} whether the credits box collapses
 */
export function parseCreditsCollapse(value) {
  return value !== false;
}

export class CreditsToggle {
  /**
   * @param {L.Map} map
   * @param {{collapseAfterMs?: number, doc?: Document}} [options]
   */
  constructor(map, options = {}) {
    this.map = map;
    this.collapseAfterMs = options.collapseAfterMs ?? COLLAPSE_AFTER_MS;
    this.doc = options.doc ?? (typeof document !== "undefined" ? document : undefined);
    this.expanded = true;
    this.viewerOpened = false;
    this.timer = undefined;
    this.box = undefined;
    this.button = undefined;
    this.control = undefined;
    this._onInput = (e) => this._userInput(e);
    this._onVisible = () => this._startTimerIfVisible();
  }

  /** @returns {boolean} whether the box is now collapsible */
  setup() {
    const ctl = this.map?.attributionControl;
    const box = ctl?.getContainer?.();
    if (!box) return false;
    this.box = box;

    const wrap = L.DomUtil.create("div", "leaflet-control ltmc-credits-control");
    const button = L.DomUtil.create("button", "ltmc-credits-button", wrap);
    button.type = "button";
    button.setAttribute("aria-label", BUTTON_LABEL);
    button.title = BUTTON_LABEL;
    L.DomEvent.disableClickPropagation(wrap);
    L.DomEvent.on(button, "click", (e) => {
      L.DomEvent.stop(e);
      this.toggle();
    });
    this.button = button;
    const Ctl = L.Control.extend({ onAdd: () => wrap, onRemove: () => {} });
    this.control = new Ctl({ position: ctl.getPosition() });
    this.control.addTo(this.map);

    const el = this.map.getContainer();
    for (const t of USER_EVENTS) el.addEventListener(t, this._onInput, { passive: true });
    this._apply();
    this._startTimerIfVisible();
    return true;
  }

  _startTimerIfVisible() {
    if (!this.expanded || this.viewerOpened || this.timer !== undefined) return;
    if (this.doc?.visibilityState === "hidden") {
      this.doc.addEventListener("visibilitychange", this._onVisible);
      return;
    }
    this.doc?.removeEventListener?.("visibilitychange", this._onVisible);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.collapse();
    }, this.collapseAfterMs);
  }

  _userInput(e) {
    const t = e?.target;
    if (t && typeof t.closest === "function" && t.closest(".leaflet-control")) return;
    if (this.expanded) this.collapse();
  }

  collapse() {
    this._clearTimer();
    this.expanded = false;
    this.viewerOpened = false;
    this._apply();
  }

  expand() {
    this._clearTimer();
    this.expanded = true;
    this.viewerOpened = true;
    this._apply();
  }

  toggle() {
    if (this.expanded) this.collapse(); else this.expand();
  }

  _clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.doc?.removeEventListener?.("visibilitychange", this._onVisible);
  }

  _apply() {
    if (!this.box) return;
    this.box.classList.toggle(COLLAPSED_CLASS, !this.expanded);
    // Capped only when the viewer opened it: at the start the box shows in full.
    const capped = this.expanded && this.viewerOpened;
    this.box.classList.toggle(OPEN_CLASS, capped);
    const size = capped ? this.map.getSize?.() : undefined;
    const h = size?.y;
    const w = size?.x;
    this.box.style.maxHeight = Number.isFinite(h) && h > 0 ? `${Math.floor(h * OPEN_MAX_FRACTION)}px` : "";
    // Its own width too: the scrollbar otherwise widens the box past the map's
    // left edge (seen on the look page, 2026-11-19), and Leaflet's corner
    // sizes itself to the box, so a percentage cannot hold it.
    this.box.style.maxWidth = Number.isFinite(w) && w > OPEN_SIDE_GAP_PX ? `${Math.floor(w - OPEN_SIDE_GAP_PX)}px` : "";
    if (this.button) {
      this.button.setAttribute("aria-expanded", String(this.expanded));
      this.button.textContent = this.expanded ? "×" : "i";
    }
  }

  dispose() {
    this._clearTimer();
    const el = this.map?.getContainer?.();
    if (el) for (const t of USER_EVENTS) el.removeEventListener(t, this._onInput);
    try { this.control?.remove(); } catch { /* the map is already gone */ }
    if (this.box) {
      this.box.classList.remove(COLLAPSED_CLASS, OPEN_CLASS);
      this.box.style.maxHeight = "";
      this.box.style.maxWidth = "";
    }
    this.control = undefined;
    this.button = undefined;
    this.box = undefined;
  }
}
