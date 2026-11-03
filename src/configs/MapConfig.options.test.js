import { describe, expect, it } from "@jest/globals";
import MapConfig from "./MapConfig.js";

describe("Lee 2026-11-02: layer_control and weather_area", () => {
  it("off unless set", () => {
    const c = new MapConfig({ x: 41, y: -87 });
    expect(c.layerControl).toBe(true);
    expect(c.weatherArea).toBeNull();
  });
  it("set", () => {
    const c = new MapConfig({ x: 41, y: -87, layer_control: false, weather_area: { latitude: 41.89, longitude: -87.98, radius_km: 150 } });
    expect(c.layerControl).toBe(false);
    expect(c.weatherArea).toEqual({ lat: 41.89, lon: -87.98, km: 150 });
  });
  it("only false turns the control off", () => {
    expect(new MapConfig({ x: 41, y: -87, layer_control: 0 }).layerControl).toBe(true);
  });
  it("map_options reach the map, which is how attributions go", () => {
    expect(new MapConfig({ x: 41, y: -87, map_options: { attributionControl: false } }).mapOptions.attributionControl).toBe(false);
  });
});
