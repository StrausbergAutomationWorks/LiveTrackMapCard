import { describe, expect, it, jest } from "@jest/globals";
import { EXPANDED_CLASS, GUARD_MS, guardFirstClick } from "./LayerControlGuard.js";

/**
 * A layer control's DOM: container, list, one checkbox row.
 * @returns {{container: HTMLElement, input: HTMLInputElement, toggle: HTMLElement, onInput: Function}}
 */
function control() {
  const container = document.createElement("div");
  container.className = "leaflet-control-layers leaflet-control";
  const toggle = document.createElement("a");
  toggle.className = "leaflet-control-layers-toggle";
  const list = document.createElement("section");
  list.className = "leaflet-control-layers-list";
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = true;
  label.appendChild(input);
  list.appendChild(label);
  container.append(toggle, list);
  document.body.appendChild(container);
  const onInput = jest.fn();
  input.addEventListener("click", onInput);
  return { container, input, toggle, onInput };
}

// A MutationObserver reports in a microtask; a browser delivers it before the next click.
const settle = () => Promise.resolve();

describe("guardFirstClick", () => {
  it("swallows a row click within 400 ms of opening: the box keeps its state", async () => {
    expect(GUARD_MS).toBe(400);
    let t = 1000;
    const c = control();
    guardFirstClick(c.container, { now: () => t });
    c.container.classList.add(EXPANDED_CLASS);
    await settle();
    t = 1399;
    c.input.click();
    expect(c.input.checked).toBe(true);
    expect(c.onInput).not.toHaveBeenCalled();
  });

  it("lets a click at 400 ms and after through", async () => {
    let t = 1000;
    const c = control();
    guardFirstClick(c.container, { now: () => t });
    c.container.classList.add(EXPANDED_CLASS);
    await settle();
    t = 1400;
    c.input.click();
    expect(c.input.checked).toBe(false);
    expect(c.onInput).toHaveBeenCalledTimes(1);
  });

  it("times from each opening, not the first", async () => {
    let t = 0;
    const c = control();
    guardFirstClick(c.container, { now: () => t });
    c.container.classList.add(EXPANDED_CLASS);
    await settle();
    t = 5000;
    c.container.classList.remove(EXPANDED_CLASS);
    await settle();
    c.input.click(); // closed: a click is not the guard's business (none reach it in practice)
    expect(c.onInput).toHaveBeenCalledTimes(1);
    t = 9000;
    c.container.classList.add(EXPANDED_CLASS);
    await settle();
    t = 9100;
    c.input.click();
    expect(c.onInput).toHaveBeenCalledTimes(1);
  });

  it("leaves clicks outside the list alone", async () => {
    let t = 0;
    const c = control();
    guardFirstClick(c.container, { now: () => t });
    c.container.classList.add(EXPANDED_CLASS);
    await settle();
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    c.toggle.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("a control already open when guarded is not treated as just opened", async () => {
    let t = 0;
    const c = control();
    c.container.classList.add(EXPANDED_CLASS);
    await settle();
    guardFirstClick(c.container, { now: () => t });
    t = 10;
    c.input.click();
    expect(c.onInput).toHaveBeenCalledTimes(1);
  });

  it("undo removes the guard; no container, nothing to do", async () => {
    let t = 0;
    const c = control();
    const undo = guardFirstClick(c.container, { now: () => t });
    undo();
    c.container.classList.add(EXPANDED_CLASS);
    await settle();
    c.input.click();
    expect(c.onInput).toHaveBeenCalledTimes(1);
    expect(() => guardFirstClick(undefined)()).not.toThrow();
  });
});
