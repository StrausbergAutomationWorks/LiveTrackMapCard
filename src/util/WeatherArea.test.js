import { describe, expect, it } from "@jest/globals";
import { parseWeatherArea, areaBounds, geometryTouchesArea } from "./WeatherArea.js";

const HOME = { lat: 41.89, lon: -87.98, km: 150 };
const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

describe("parseWeatherArea", () => {
  it("takes the three numbers", () => {
    expect(parseWeatherArea({ latitude: 41.89, longitude: -87.98, radius_km: 150 })).toEqual(HOME);
  });
  it("refuses anything else", () => {
    for (const v of [undefined, null, 5, "x", {}, { latitude: 1, longitude: 2 }, { latitude: "1", longitude: 2, radius_km: 3 },
      { latitude: 91, longitude: 0, radius_km: 3 }, { latitude: 0, longitude: 181, radius_km: 3 }, { latitude: 0, longitude: 0, radius_km: 0 },
      { latitude: NaN, longitude: 0, radius_km: 3 }]) {
      expect(parseWeatherArea(v)).toBeNull();
    }
  });
});

describe("areaBounds", () => {
  it("holds the circle, widening in longitude with latitude", () => {
    const [[s, w], [n, e]] = areaBounds(HOME);
    expect(s).toBeCloseTo(41.89 - 150 / 111.2, 6);
    expect(n).toBeCloseTo(41.89 + 150 / 111.2, 6);
    const dLon = 150 / (111.2 * Math.cos((41.89 * Math.PI) / 180));
    expect(w).toBeCloseTo(-87.98 - dLon, 6);
    expect(e).toBeCloseTo(-87.98 + dLon, 6);
  });
});

describe("geometryTouchesArea", () => {
  it("a county inside", () => {
    expect(geometryTouchesArea({ type: "Polygon", coordinates: [box(-88.2, 41.7, -87.9, 42)] }, HOME)).toBe(true);
  });
  it("a county far away", () => {
    expect(geometryTouchesArea({ type: "Polygon", coordinates: [box(-120, 36, -119, 37)] }, HOME)).toBe(false);
  });
  it("a shape that covers the whole circle, with no vertex near it", () => {
    expect(geometryTouchesArea({ type: "Polygon", coordinates: [box(-100, 30, -75, 50)] }, HOME)).toBe(true);
  });
  it("a long edge crossing the circle, with no vertex in it and the centre outside", () => {
    expect(geometryTouchesArea({ type: "Polygon", coordinates: [box(-100, 42, -75, 50)] }, HOME)).toBe(true);
  });
  it("a neighbour whose box would overlap but whose shape does not", () => {
    const L = [[-95, 30], [-95, 41], [-94, 41], [-94, 31], [-89.5, 31], [-89.5, 30], [-95, 30]];
    expect(geometryTouchesArea({ type: "Polygon", coordinates: [L] }, HOME)).toBe(false);
  });
  it("a hole's edge counts as outline; any part of a MultiPolygon counts", () => {
    expect(geometryTouchesArea({ type: "MultiPolygon", coordinates: [[box(-120, 36, -119, 37)], [box(-88, 41.8, -87.9, 41.9)]] }, HOME)).toBe(true);
    expect(geometryTouchesArea({ type: "MultiPolygon", coordinates: [[box(-120, 36, -119, 37)], [box(-110, 36, -109, 37)]] }, HOME)).toBe(false);
  });
  it("lines", () => {
    expect(geometryTouchesArea({ type: "LineString", coordinates: [[-100, 41.9], [-75, 41.9]] }, HOME)).toBe(true);
    expect(geometryTouchesArea({ type: "LineString", coordinates: [[-100, 30], [-75, 30]] }, HOME)).toBe(false);
    expect(geometryTouchesArea({ type: "MultiLineString", coordinates: [[[-100, 30], [-75, 30]], [[-88, 41.9], [-87.9, 41.9]]] }, HOME)).toBe(true);
  });
  it("the edge of the circle", () => {
    const edge = 41.89 + 149.9 / 111.2;
    const past = 41.89 + 150.1 / 111.2;
    expect(geometryTouchesArea({ type: "LineString", coordinates: [[-87.98, edge], [-87.98, edge + 1]] }, HOME)).toBe(true);
    expect(geometryTouchesArea({ type: "LineString", coordinates: [[-87.98, past], [-87.98, past + 1]] }, HOME)).toBe(false);
  });
  it("a degree of longitude is shorter at this latitude", () => {
    // 1.5 degrees west is 124 km here, and would be 167 km at the equator
    expect(geometryTouchesArea({ type: "LineString", coordinates: [[-89.48, 41.89], [-89.58, 41.89]] }, HOME)).toBe(true);
  });
  it("nothing usable is nothing", () => {
    expect(geometryTouchesArea(null, HOME)).toBe(false);
    expect(geometryTouchesArea({ type: "Point", coordinates: [-87.98, 41.89] }, HOME)).toBe(false);
  });
});
