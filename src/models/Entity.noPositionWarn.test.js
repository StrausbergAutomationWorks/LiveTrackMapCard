import { describe, expect, it, jest, beforeEach } from "@jest/globals";

jest.mock("./Circle.js");
jest.mock("./GeoJson.js");
jest.mock("../util/Logger.js");
jest.mock("./EntityHistoryManager.js");

import Entity, { warnNoPositionOnce, _resetNoPositionWarnings } from "./Entity.js";
import Logger from "../util/Logger.js";

// Backlog 233: `latLng` warned on EVERY update for every entity without a
// position - 109,846 warnings in one tab. Now once per entity id.

/**
 * An entity with no position at all.
 * @param {string} id
 * @returns {Entity}
 */
function noPosition(id) {
  const hass = { states: { [id]: { state: "unknown", attributes: { friendly_name: id } } } };
  const cfg = { id, display: "marker", prefix: "", suffix: "", size: 28, color: "#757575", zIndexOffset: 0, tapAction: {}, css: "",
    positionUpdateThreshold: 10, positionTransition: 0, circleConfig: {}, geoJsonConfig: {}, rotationTransition: 3 };
  return new Entity(cfg, hass, { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) }, jest.fn(), jest.fn(), jest.fn(), false);
}

beforeEach(() => { _resetNoPositionWarnings(); Logger.warn.mockClear(); });

describe("no-position warning", () => {
  it("warns once for an entity, however many updates read its position", () => {
    const e = noPosition("geo_location.vessel_1");
    for (let i = 0; i < 50; i++) expect(e.latLng).toBeNull();
    expect(Logger.warn).toHaveBeenCalledTimes(1);
    expect(Logger.warn.mock.calls[0][0]).toContain("geo_location.vessel_1");
  });

  it("a rebuilt Entity for the same id does not warn again; a different id does", () => {
    void noPosition("geo_location.vessel_1").latLng;
    void noPosition("geo_location.vessel_1").latLng;
    void noPosition("geo_location.vessel_2").latLng;
    expect(Logger.warn).toHaveBeenCalledTimes(2);
  });

  it("warnNoPositionOnce says whether it warned", () => {
    expect(warnNoPositionOnce("a")).toBe(true);
    expect(warnNoPositionOnce("a")).toBe(false);
    expect(warnNoPositionOnce("b")).toBe(true);
  });

  it("an entity WITH a position never warns", () => {
    const e = noPosition("geo_location.ok");
    e.hass.states["geo_location.ok"].attributes = { latitude: 41.9, longitude: -87.6 };
    expect(e.latLng).not.toBeNull();
    expect(Logger.warn).not.toHaveBeenCalled();
  });
});
