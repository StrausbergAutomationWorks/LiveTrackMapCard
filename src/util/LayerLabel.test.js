import { describe, expect, it } from "@jest/globals";
import { layerLabel } from "./LayerLabel.js";

const ID = "sensor.live_track_weather_storm_reports";

/**
 * A frontend hass with one publisher on one device.
 * @param {object} [o] friendly name, device name, name_by_user, whether the entity has a device
 * @returns {object} hass
 */
function hass(o = {}) {
  // "fn" in o, not a default: fn: undefined must mean NO friendly name.
  const fn = "fn" in o ? o.fn : "Live Track Weather Storm reports";
  const { device = "Live Track Weather", byUser = null, linked = true } = o;
  return {
    states: { [ID]: { attributes: fn === undefined ? {} : { friendly_name: fn } } },
    entities: { [ID]: linked ? { entity_id: ID, device_id: "d1" } : { entity_id: ID } },
    devices: { d1: { id: "d1", name: device, name_by_user: byUser } },
  };
}

describe("layerLabel", () => {
  it("leaves the device name off, and gives the former label", () => {
    expect(layerLabel(hass(), ID, null)).toEqual({ name: "Storm reports", former: "Live Track Weather Storm reports" });
  });

  it("uses the name the user gave the device", () => {
    const h = hass({ fn: "Weather Storm reports", byUser: "Weather" });
    expect(layerLabel(h, ID, null)).toEqual({ name: "Storm reports", former: "Weather Storm reports" });
  });

  it("the dashboard's own name wins, as before; an empty one falls back to the id", () => {
    expect(layerLabel(hass(), ID, "Storms")).toEqual({ name: "Storms", former: undefined });
    expect(layerLabel(hass(), ID, "")).toEqual({ name: ID, former: undefined });
  });

  it("keeps the friendly name when it does not start with the device name", () => {
    expect(layerLabel(hass({ fn: "Storm reports near home" }), ID, null)).toEqual({ name: "Storm reports near home", former: undefined });
    expect(layerLabel(hass({ fn: "Live Track WeatherX reports" }), ID, null)).toEqual({ name: "Live Track WeatherX reports", former: undefined });
  });

  it("keeps a friendly name that is only the device name", () => {
    expect(layerLabel(hass({ fn: "Live Track Weather" }), ID, null)).toEqual({ name: "Live Track Weather", former: undefined });
    expect(layerLabel(hass({ fn: "Live Track Weather  " }), ID, null)).toEqual({ name: "Live Track Weather  ", former: undefined });
  });

  it("keeps the friendly name with no device, or no registry in the hass", () => {
    expect(layerLabel(hass({ linked: false }), ID, null).name).toBe("Live Track Weather Storm reports");
    expect(layerLabel({ states: hass().states }, ID, null).name).toBe("Live Track Weather Storm reports");
  });

  it("the entity id when there is no friendly name", () => {
    expect(layerLabel(hass({ fn: undefined }), ID, null)).toEqual({ name: ID, former: undefined });
    expect(layerLabel(undefined, ID, undefined)).toEqual({ name: ID, former: undefined });
  });
});
