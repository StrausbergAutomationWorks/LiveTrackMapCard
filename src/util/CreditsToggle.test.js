import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import L from "leaflet";
import {
  BUTTON_LABEL, COLLAPSE_AFTER_MS, COLLAPSED_CLASS, CreditsToggle, OPEN_CLASS, parseCreditsCollapse,
} from "./CreditsToggle.js";

let el;
let map;

/**
 * A Leaflet map in the page, sized as a phone's.
 * @param {object} [options] Leaflet map options
 * @returns {L.Map} the map
 */
function makeMap(options = {}) {
  el = document.createElement("div");
  document.body.appendChild(el);
  map = L.map(el, options).setView([41.9, -88.0], 10);
  map.getSize = () => L.point(390, 620);
  return map;
}

const box = () => map.attributionControl.getContainer();
const button = () => el.querySelector(".ltmc-credits-button");
const fire = (target, type) => target.dispatchEvent(new Event(type, { bubbles: true }));
const collapsed = () => box().classList.contains(COLLAPSED_CLASS);

beforeEach(() => {
  jest.useFakeTimers();
  makeMap();
  map.attributionControl.addAttribution("Data from somewhere, CC BY 4.0");
});

afterEach(() => {
  jest.useRealTimers();
  map?.remove();
  el?.remove();
});

describe("parseCreditsCollapse", () => {
  it("collapses unless told false", () => {
    for (const v of [undefined, null, true, "no", 0, {}]) expect(parseCreditsCollapse(v)).toBe(true);
    expect(parseCreditsCollapse(false)).toBe(false);
  });
});

describe("CreditsToggle", () => {
  it("opens in full with the map, the button offering to close it", () => {
    const t = new CreditsToggle(map);
    expect(t.setup()).toBe(true);
    expect(collapsed()).toBe(false);
    expect(box().classList.contains(OPEN_CLASS)).toBe(false);
    expect(box().style.maxHeight).toBe("");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(button().getAttribute("aria-label")).toBe(BUTTON_LABEL);
    expect(button().type).toBe("button");
  });

  it("collapses after five seconds, not before", () => {
    // The literal, not the constant: OpenStreetMap's guideline says five seconds.
    expect(COLLAPSE_AFTER_MS).toBe(5000);
    new CreditsToggle(map).setup();
    jest.advanceTimersByTime(4999);
    expect(collapsed()).toBe(false);
    jest.advanceTimersByTime(1);
    expect(collapsed()).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().textContent).toBe("i");
  });

  it.each(["pointerdown", "touchstart", "wheel", "keydown"])("collapses at the viewer's first %s on the map", (type) => {
    new CreditsToggle(map).setup();
    fire(map.getPanes().mapPane, type);
    expect(collapsed()).toBe(true);
  });

  it("ignores a press inside a control, so a credit's link can be used", () => {
    new CreditsToggle(map).setup();
    fire(box(), "pointerdown");
    fire(button(), "pointerdown");
    expect(collapsed()).toBe(false);
  });

  it("does not count the card's own moves", () => {
    new CreditsToggle(map).setup();
    map.setView([42.0, -87.5], 11);
    map.fire("movestart");
    map.fire("zoomstart");
    expect(collapsed()).toBe(false);
  });

  it("reopens from the button, capped at 40% of the map and scrollable, and stays open past five seconds", () => {
    new CreditsToggle(map).setup();
    jest.advanceTimersByTime(COLLAPSE_AFTER_MS);
    button().click();
    expect(collapsed()).toBe(false);
    expect(box().classList.contains(OPEN_CLASS)).toBe(true);
    expect(box().style.maxHeight).toBe("248px");
    expect(box().style.maxWidth).toBe("380px");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    jest.advanceTimersByTime(COLLAPSE_AFTER_MS * 3);
    expect(collapsed()).toBe(false);
  });

  it("closes a reopened box on the next press on the map, or on the button", () => {
    new CreditsToggle(map).setup();
    jest.advanceTimersByTime(COLLAPSE_AFTER_MS);
    button().click();
    fire(map.getPanes().mapPane, "pointerdown");
    expect(collapsed()).toBe(true);
    expect(box().style.maxHeight).toBe("");
    expect(box().style.maxWidth).toBe("");
    button().click();
    button().click();
    expect(collapsed()).toBe(true);
  });

  it("the button at the start closes the box at once", () => {
    new CreditsToggle(map).setup();
    button().click();
    expect(collapsed()).toBe(true);
    jest.advanceTimersByTime(COLLAPSE_AFTER_MS);
    expect(collapsed()).toBe(true);
  });

  it("stays collapsed, and keeps its button, when Leaflet rewrites the credits", () => {
    new CreditsToggle(map).setup();
    jest.advanceTimersByTime(COLLAPSE_AFTER_MS);
    map.attributionControl.addAttribution("Another source");
    map.attributionControl.removeAttribution("Data from somewhere, CC BY 4.0");
    expect(collapsed()).toBe(true);
    expect(box().innerHTML).toContain("Another source");
    expect(button()).not.toBeNull();
  });

  it("puts the button in the credits' own corner", () => {
    new CreditsToggle(map).setup();
    const corner = map._controlCorners[map.attributionControl.getPosition()];
    expect(corner.contains(button())).toBe(true);
  });

  it("does nothing on a map without a credits box", () => {
    map.remove(); el.remove();
    makeMap({ attributionControl: false });
    const t = new CreditsToggle(map);
    expect(t.setup()).toBe(false);
    expect(button()).toBeNull();
    expect(() => t.dispose()).not.toThrow();
  });

  it("waits for a hidden page to show before counting five seconds", () => {
    let state = "hidden";
    const doc = {
      get visibilityState() { return state; },
      listeners: {},
      addEventListener(t, f) { this.listeners[t] = f; },
      removeEventListener(t, f) { if (this.listeners[t] === f) delete this.listeners[t]; },
    };
    new CreditsToggle(map, { doc }).setup();
    jest.advanceTimersByTime(COLLAPSE_AFTER_MS * 2);
    expect(collapsed()).toBe(false);
    state = "visible";
    doc.listeners.visibilitychange();
    jest.advanceTimersByTime(COLLAPSE_AFTER_MS - 1);
    expect(collapsed()).toBe(false);
    jest.advanceTimersByTime(1);
    expect(collapsed()).toBe(true);
  });

  it("dispose removes the button, the listeners, the timer and its marks on the box", () => {
    const t = new CreditsToggle(map);
    t.setup();
    t.dispose();
    expect(button()).toBeNull();
    expect(box().classList.contains(COLLAPSED_CLASS)).toBe(false);
    jest.advanceTimersByTime(COLLAPSE_AFTER_MS);
    for (const type of ["pointerdown", "touchstart", "wheel", "keydown"]) fire(map.getPanes().mapPane, type);
    expect(collapsed()).toBe(false);
    // Nothing left listening: a leftover listener or timer would still flip it.
    expect(t.expanded).toBe(true);
  });
});
