import { describe, expect, it } from "@jest/globals";
import {
  STALE_MS, POLL_MS, parseRainViewer, jmaTime, parseJma, isoTime, timeDefaults,
  parseGeoMetCaps, parseNowCoastRegions, computedFiveMinute, isFresh,
} from "./RadarFrames.js";

// Backlog 280, D13 "Frames". Shapes taken from the live answers of
// 2026-10-06 (bin\ltmc280_lists.txt, bin\ltw\t280\caps_*.xml).

const RV = {
  version: "2.0", generated: 1791271523, host: "https://tilecache.rainviewer.com",
  radar: {
    past: [{ time: 1791264000, path: "/v2/radar/03867b559e8a" }, { time: 1791271200, path: "/v2/radar/4cf7ce64d7d7" }],
    nowcast: [],
  },
  satellite: { infrared: [] },
};

const JMA = [
  { basetime: "20261006072500", validtime: "20261006072500", elements: ["hrpns", "hrpns_nd"] },
  { basetime: "20261006072000", validtime: "20261006072000", elements: ["hrpns", "hrpns_nd"] },
];

const GEOMET = `<Layer queryable="1"><Name>RADAR_1KM_RRAI</Name>
<Dimension name="time" units="ISO8601" default="2026-10-06T06:48:00Z" nearestValue="0">2026-10-06T03:48:00Z/2026-10-06T06:48:00Z/PT6M</Dimension></Layer>`;

const NOWCOAST = `<Layer><Name>base_reflectivity_mosaic</Name>
<Layer><Name>conus_base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-06T06:48:14Z" units="ISO8601" nearestValue="1">2026-10-06T06:44:00.000Z,2026-10-06T06:48:14.000Z</Dimension></Layer>
<Layer><Name>alaska_base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-06T06:50:02Z" units="ISO8601">x</Dimension></Layer>
<Layer><Name>guam_base_reflectivity_mosaic</Name><Dimension default="2026-10-06T06:40:00Z" name="time">x</Dimension></Layer>
<Layer><Name>other</Name><Dimension name="elevation" default="2030-01-01T00:00:00Z">x</Dimension></Layer>
</Layer>`;

describe("constants", () => {
  it("stale after 30 minutes; polls per D13", () => {
    expect(STALE_MS).toBe(1800000);
    expect(POLL_MS).toEqual({ rainviewer: 300000, jma: 300000, geomet: 360000, nowcoast: 300000 });
  });
});

describe("RainViewer", () => {
  it("takes the newest past frame, host and path, time in ms", () => {
    const { list, ...rest } = parseRainViewer(RV);
    expect(rest).toEqual({
      key: "/v2/radar/4cf7ce64d7d7", host: "https://tilecache.rainviewer.com", path: "/v2/radar/4cf7ce64d7d7", time: 1791271200000,
    });
    expect(list.at(-1)).toEqual(rest);
    expect(list.every((f, i) => i === 0 || list[i - 1].time < f.time)).toBe(true);
  });
  it("refuses an empty list, a non-https host, a path that is not a path, a missing time", () => {
    expect(parseRainViewer({ ...RV, radar: { past: [] } })).toBeNull();
    expect(parseRainViewer({ ...RV, host: "http://x" })).toBeNull();
    expect(parseRainViewer({ ...RV, radar: { past: [{ time: 1, path: "javascript:x" }] } })).toBeNull();
    expect(parseRainViewer({ ...RV, radar: { past: [{ path: "/v2/a" }] } })).toBeNull();
    expect(parseRainViewer(null)).toBeNull();
    expect(parseRainViewer([])).toBeNull();
  });
});

describe("JMA", () => {
  it("reads UTC compact times", () => {
    expect(jmaTime("20261006072500")).toBe(Date.UTC(2026, 9, 6, 7, 25, 0));
    expect(jmaTime("2026100607")).toBeNaN();
  });
  it("takes the first entry with basetime = validtime", () => {
    const { list, ...rest } = parseJma(JMA);
    expect(rest).toEqual({ key: "20261006072500", basetime: "20261006072500", validtime: "20261006072500", time: Date.UTC(2026, 9, 6, 7, 25) });
    expect(list.at(-1)).toEqual(rest);
  });
  it("skips a forecast entry (validtime after basetime) and one without hrpns", () => {
    const list = [
      { basetime: "20261006072500", validtime: "20261006073000", elements: ["hrpns"] },
      { basetime: "20261006072000", validtime: "20261006072000", elements: ["other"] },
      { basetime: "20261006071500", validtime: "20261006071500", elements: ["hrpns"] },
    ];
    expect(parseJma(list).key).toBe("20261006071500");
  });
  it("null when nothing fits", () => {
    expect(parseJma([])).toBeNull();
    expect(parseJma({})).toBeNull();
    expect(parseJma([{ basetime: "bad", validtime: "bad" }])).toBeNull();
  });
});

describe("WMS capabilities", () => {
  it("isoTime takes Z times with or without fractions, nothing else", () => {
    expect(isoTime("2026-10-06T06:48:00Z")).toBe(Date.UTC(2026, 9, 6, 6, 48));
    expect(isoTime("2026-10-06T06:48:00.000Z")).toBe(Date.UTC(2026, 9, 6, 6, 48));
    expect(isoTime("2026-10-06T06:48:00+00:00")).toBeNaN();
    expect(isoTime(null)).toBeNaN();
  });
  it("timeDefaults finds every time Dimension's default, attribute order free", () => {
    expect(timeDefaults(NOWCOAST)).toEqual(["2026-10-06T06:48:14Z", "2026-10-06T06:50:02Z", "2026-10-06T06:40:00Z"]);
    expect(timeDefaults(null)).toEqual([]);
  });
  it("GeoMet: the default exactly as listed (on its 6-minute grid)", () => {
    const { list, ...rest } = parseGeoMetCaps(GEOMET);
    expect(rest).toEqual({ key: "2026-10-06T06:48:00Z", time: Date.UTC(2026, 9, 6, 6, 48) });
    expect(list.at(-1)).toEqual(rest);
    expect(list.every((f) => f.time <= rest.time && (f.time - rest.time) % (6 * 60000) === 0)).toBe(true);
    expect(parseGeoMetCaps("<x/>")).toBeNull();
  });
  it("nowCOAST: each REGIONAL layer's own default (backlog 285); the group and other layers carry none", () => {
    const m = parseNowCoastRegions(NOWCOAST);
    expect([...m.keys()]).toEqual(["conus_base_reflectivity_mosaic", "alaska_base_reflectivity_mosaic", "guam_base_reflectivity_mosaic"]);
    const { list, ...rest } = m.get("conus_base_reflectivity_mosaic");
    expect(rest).toEqual({ key: "2026-10-06T06:48:14Z", time: Date.UTC(2026, 9, 6, 6, 48, 14) });
    expect(list.at(-1).time).toBe(rest.time);
    expect(m.get("alaska_base_reflectivity_mosaic").key).toBe("2026-10-06T06:50:02Z");
    expect(m.get("guam_base_reflectivity_mosaic").key).toBe("2026-10-06T06:40:00Z");
    expect(parseNowCoastRegions("").size).toBe(0);
    expect(parseNowCoastRegions(null).size).toBe(0);
  });
  it("nowCOAST: a layer listed twice keeps its FIRST time", () => {
    const caps = '<Layer><Name>conus_base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-23T05:08:19Z">x</Dimension></Layer>'
      + '<Layer><Name>conus_base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-23T06:00:00Z">x</Dimension></Layer>';
    expect(parseNowCoastRegions(caps).get("conus_base_reflectivity_mosaic").key).toBe("2026-10-23T05:08:19Z");
  });
  it("nowCOAST as served 2026-10-23: a style's <Name> follows each layer's time; a layer without one takes nobody's", () => {
    const caps = '<Layer><Name>conus_base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-23T05:08:19Z">x</Dimension>'
      + '<Style><Name>weather_radar_base_reflectivity</Name></Style></Layer>'
      + '<Layer><Name>alaska_base_reflectivity_mosaic</Name><Style><Name>weather_radar_base_reflectivity</Name></Style></Layer>'
      + '<Layer><Name>default-style-base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-23T06:00:00Z">x</Dimension></Layer>';
    const m = parseNowCoastRegions(caps);
    expect(m.get("conus_base_reflectivity_mosaic").key).toBe("2026-10-23T05:08:19Z");
    expect(m.has("alaska_base_reflectivity_mosaic")).toBe(false);
    expect(m.size).toBe(1);
  });
});

describe("FMI and DWD, computed", () => {
  it("floor(now - 5 min) on the 5-minute UTC grid, as WMS wants it", () => {
    expect(computedFiveMinute(Date.UTC(2026, 9, 6, 7, 32, 10))).toEqual({ key: "2026-10-06T07:25:00Z", time: Date.UTC(2026, 9, 6, 7, 25) });
    expect(computedFiveMinute(Date.UTC(2026, 9, 6, 7, 30, 0))).toEqual({ key: "2026-10-06T07:25:00Z", time: Date.UTC(2026, 9, 6, 7, 25) });
    expect(computedFiveMinute(Date.UTC(2026, 9, 6, 0, 2, 0)).key).toBe("2026-10-05T23:55:00Z");
  });
});

describe("stale", () => {
  const now = Date.UTC(2026, 9, 6, 8, 0);
  it("30 minutes old is fresh, a second more is not, none is not", () => {
    expect(isFresh({ time: now - STALE_MS }, now)).toBe(true);
    expect(isFresh({ time: now - STALE_MS - 1000 }, now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
    expect(isFresh({ time: NaN }, now)).toBe(false);
  });
});
