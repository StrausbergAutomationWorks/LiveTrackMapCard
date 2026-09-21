import HaLinkedEntityService from "./HaLinkedEntityService.js";
import {afterEach, beforeEach, describe, expect, it, jest} from "@jest/globals";

/**
 * A connection whose subscribeMessage records each callback, and a delivery
 * that walks one frame the way home-assistant-js-websocket's _handleMessage
 * does: a bare forEach with no try/catch, so a throw from any callback
 * abandons the rest of the frame.
 * @returns {{hass: any, callbacks: Function[], deliverFrame: Function}}
 */
function makeHass() {
  const callbacks = [];
  const hass = {
    connection: {
      subscribeMessage: jest.fn((cb) => {
        callbacks.push(cb);
        return Promise.resolve(() => {});
      }),
    },
  };
  const deliverFrame = (frame) => {
    frame.forEach(([index, event]) => callbacks[index](event));
  };
  return {hass, callbacks, deliverFrame};
}

describe("HaLinkedEntityService", () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe("stateFrom", () => {
    const E = "sensor.orm_tile_url";

    it("reads s from an a snapshot", () => {
      expect(HaLinkedEntityService.stateFrom({a: {[E]: {s: "abc"}}}, E)).toBe("abc");
    });

    it("returns null when the a snapshot lacks the entity (HA still starting)", () => {
      expect(HaLinkedEntityService.stateFrom({a: {}}, E)).toBeNull();
      expect(HaLinkedEntityService.stateFrom({a: {"sensor.other": {s: "x"}}}, E)).toBeNull();
    });

    it("reads s from a c change", () => {
      expect(HaLinkedEntityService.stateFrom({c: {[E]: {"+": {s: "new"}}}}, E)).toBe("new");
    });

    it("returns null for a change with no + part", () => {
      expect(HaLinkedEntityService.stateFrom({c: {[E]: {"-": {a: ["x"]}}}}, E)).toBeNull();
    });

    it("returns null for an attribute-only change", () => {
      expect(HaLinkedEntityService.stateFrom({c: {[E]: {"+": {a: {x: 1}}}}}, E)).toBeNull();
    });

    it("returns null for a change naming another entity", () => {
      expect(HaLinkedEntityService.stateFrom({c: {"sensor.other": {"+": {s: "x"}}}}, E)).toBeNull();
    });

    it("returns null for an r removal and for no message", () => {
      expect(HaLinkedEntityService.stateFrom({r: [E]}, E)).toBeNull();
      expect(HaLinkedEntityService.stateFrom(undefined, E)).toBeNull();
      expect(HaLinkedEntityService.stateFrom(null, E)).toBeNull();
    });
  });

  describe("the subscription callback", () => {
    const E = "sensor.orm_tile_url";

    it("passes a snapshot state to the listener, parsed as a number when numeric", () => {
      const {hass, deliverFrame} = makeHass();
      const svc = new HaLinkedEntityService(hass);
      const got = [];
      svc.onStateChange(E, (s) => got.push(s));
      deliverFrame([[0, {a: {[E]: {s: "42"}}}], [0, {c: {[E]: {"+": {s: "tiles"}}}}]]);
      expect(got).toEqual([42, "tiles"]);
    });

    it("does not throw when the snapshot lacks the entity, and calls no listener", () => {
      const {hass, callbacks} = makeHass();
      const svc = new HaLinkedEntityService(hass);
      const listener = jest.fn();
      svc.onStateChange(E, listener);
      expect(() => callbacks[0]({a: {}})).not.toThrow();
      expect(() => callbacks[0]({c: {[E]: {"-": {a: ["x"]}}}})).not.toThrow();
      expect(() => callbacks[0](undefined)).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
    });

    it("does not let a throwing listener escape, and still calls the next listener", () => {
      const {hass, callbacks} = makeHass();
      const svc = new HaLinkedEntityService(hass);
      const second = jest.fn();
      svc.onStateChange(E, () => { throw new Error("listener broke"); });
      svc.onStateChange(E, second);
      expect(() => callbacks[0]({a: {[E]: {s: "v"}}})).not.toThrow();
      expect(second).toHaveBeenCalledWith("v");
      expect(errorSpy).toHaveBeenCalled();
    });

    it("leaves the rest of the frame deliverable - the 2026-09-21 reconnect during HA startup", () => {
      const {hass, callbacks, deliverFrame} = makeHass();
      const svc = new HaLinkedEntityService(hass);
      svc.onStateChange(E, () => {});
      // a second subscriber on the same connection, e.g. the frontend's entities
      const other = jest.fn();
      callbacks.push(other);
      // the linked entity's resubscribe snapshot arrives first and lacks the entity
      expect(() => deliverFrame([[0, {a: {}}], [1, {a: {"geo_location.x": {s: "1"}}}]])).not.toThrow();
      expect(other).toHaveBeenCalledTimes(1);
    });
  });
});
