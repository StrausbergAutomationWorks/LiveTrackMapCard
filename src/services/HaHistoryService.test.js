import HaHistoryService from "./HaHistoryService.js";
import {afterEach, beforeEach, describe, expect, it, jest} from "@jest/globals";

/**
 * The history/stream callback runs inside home-assistant-js-websocket's
 * per-frame loop, which has no try/catch. These check it cannot throw.
 * @returns {{hass: any, callbacks: Function[]}}
 */
function makeHass() {
  const callbacks = [];
  const hass = {
    states: {},
    connection: {
      subscribeMessage: jest.fn((cb) => {
        callbacks.push(cb);
        return Promise.resolve(() => {});
      }),
    },
  };
  return {hass, callbacks};
}

const E = "geo_location.aircraft_abc123";
const good = (lu) => ({a: {latitude: 41.9, longitude: -87.9}, lu});

describe("HaHistoryService subscription callback", () => {
  let errorSpy, warnSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("delivers well-formed history entries", () => {
    const {hass, callbacks} = makeHass();
    const got = [];
    new HaHistoryService(hass).subscribe(E, new Date(0), null, (t) => got.push(t), true);
    callbacks[0]({states: {[E]: [good(1), good(2)]}});
    expect(got).toHaveLength(2);
  });

  it("does not throw on a message with no states, or no message", () => {
    const {hass, callbacks} = makeHass();
    new HaHistoryService(hass).subscribe(E, new Date(0), null, () => {}, true);
    expect(() => callbacks[0]({})).not.toThrow();
    expect(() => callbacks[0](undefined)).not.toThrow();
    expect(() => callbacks[0]({states: {[E]: null}})).not.toThrow();
  });

  it("does not throw on an entry with no attributes, and keeps the good ones", () => {
    const {hass, callbacks} = makeHass();
    const got = [];
    new HaHistoryService(hass).subscribe(E, new Date(0), null, (t) => got.push(t), true);
    expect(() => callbacks[0]({states: {[E]: [{lu: 1}, null, good(3)]}})).not.toThrow();
    expect(got).toHaveLength(1);
  });

  it("does not let a throwing consumer escape, and hands it the next entry", () => {
    const {hass, callbacks} = makeHass();
    let calls = 0;
    new HaHistoryService(hass).subscribe(E, new Date(0), null, () => { calls++; if (calls === 1) throw new Error("consumer broke"); }, true);
    expect(() => callbacks[0]({states: {[E]: [good(1), good(2)]}})).not.toThrow();
    expect(calls).toBe(2);
    expect(errorSpy).toHaveBeenCalled();
  });
});
