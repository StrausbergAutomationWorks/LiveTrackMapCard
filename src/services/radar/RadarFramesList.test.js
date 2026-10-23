import { describe, expect, it } from "@jest/globals";
import {
  MAX_LIST, isoDurationMs, wmsTimeList, timeDimensions, parseGeoMetCaps, parseNowCoastRegions,
  parseRainViewer, parseJma, computedList, computedFiveMinute,
} from "./RadarFrames.js";

// Backlog 285 part 2, D13 "Motion": each source's frame list, from the SAME answer.

const U = (h, m, s = 0) => Date.UTC(2026, 9, 6, h, m, s);

describe("isoDurationMs", () => {
  it("hours, minutes, seconds", () => {
    expect(isoDurationMs("PT6M")).toBe(360000);
    expect(isoDurationMs("PT1H30M")).toBe(5400000);
    expect(isoDurationMs("PT10S")).toBe(10000);
    expect(isoDurationMs("PT1H2M3S")).toBe(3723000);
  });
  it("nothing else", () => {
    for (const s of ["PT", "P1D", "6M", "PT6m", "", null, "PT-1M"]) expect(isoDurationMs(s)).toBeNaN();
  });
});

describe("wmsTimeList", () => {
  it("a comma list: each time kept EXACTLY as written, oldest first, duplicates once", () => {
    const l = wmsTimeList(" 2026-10-06T07:06:00.000Z,2026-10-06T07:00:00Z, 2026-10-06T07:06:00Z ,junk");
    expect(l).toEqual([{ key: "2026-10-06T07:00:00Z", time: U(7, 0) }, { key: "2026-10-06T07:06:00.000Z", time: U(7, 6) }]);
  });
  it("an interval: every period from start to end, written as the start is", () => {
    expect(wmsTimeList("2026-10-06T07:00:00Z/2026-10-06T07:18:00Z/PT6M").map((f) => f.key))
      .toEqual(["2026-10-06T07:00:00Z", "2026-10-06T07:06:00Z", "2026-10-06T07:12:00Z", "2026-10-06T07:18:00Z"]);
    expect(wmsTimeList("2026-10-06T07:00:00.000Z/2026-10-06T07:06:00.000Z/PT6M").map((f) => f.key))
      .toEqual(["2026-10-06T07:00:00.000Z", "2026-10-06T07:06:00.000Z"]);
  });
  it("an end off the grid stops at the last period before it", () => {
    expect(wmsTimeList("2026-10-06T07:00:00Z/2026-10-06T07:10:00Z/PT6M").map((f) => f.time)).toEqual([U(7, 0), U(7, 6)]);
  });
  it("a bad interval is skipped; the rest kept", () => {
    expect(wmsTimeList("2026-10-06T07:10:00Z/2026-10-06T07:00:00Z/PT6M,2026-10-06T07:00:00Z/x/PT6M,2026-10-06T07:00:00Z/2026-10-06T07:06:00Z/P1D,a/b,2026-10-06T08:00:00Z"))
      .toEqual([{ key: "2026-10-06T08:00:00Z", time: U(8, 0) }]);
  });
  it(`a long interval keeps only its newest ${MAX_LIST}, ending at its end`, () => {
    const l = wmsTimeList("2020-01-01T00:00:00Z/2026-10-06T07:00:00Z/PT1M");
    expect(l).toHaveLength(MAX_LIST);
    expect(l.at(-1).time).toBe(U(7, 0));
    expect(l[0].time).toBe(U(7, 0) - (MAX_LIST - 1) * 60000);
  });
  it("not text: empty", () => {
    expect(wmsTimeList(undefined)).toEqual([]);
    expect(wmsTimeList("")).toEqual([]);
  });
});

describe("timeDimensions", () => {
  it("each time Dimension's default and values; other Dimensions ignored", () => {
    const caps = '<Dimension name="elevation" default="0">0</Dimension><wms:Dimension units="ISO8601" name="time" default="D">V1,V2</wms:Dimension><Dimension name="time">W</Dimension>';
    expect(timeDimensions(caps)).toEqual([{ default: "D", values: "V1,V2" }, { default: null, values: "W" }]);
    expect(timeDimensions(null)).toEqual([]);
  });
});

describe("lists on the parsed frames", () => {
  it("GeoMet: its interval, never past the default", () => {
    const f = parseGeoMetCaps('<Dimension name="time" default="2026-10-06T07:12:00Z">2026-10-06T07:00:00Z/2026-10-06T07:18:00Z/PT6M</Dimension>');
    expect(f.key).toBe("2026-10-06T07:12:00Z");
    expect(f.list.map((x) => x.time)).toEqual([U(7, 0), U(7, 6), U(7, 12)]);
  });
  it("GeoMet: no readable list is a list of the default alone", () => {
    expect(parseGeoMetCaps('<Dimension name="time" default="2026-10-06T07:12:00Z">x</Dimension>').list)
      .toEqual([{ key: "2026-10-06T07:12:00Z", time: U(7, 12) }]);
    expect(parseGeoMetCaps('<Dimension name="time" default="2026-10-06T07:12:00Z">2026-10-06T08:00:00Z</Dimension>').list)
      .toEqual([{ key: "2026-10-06T07:12:00Z", time: U(7, 12) }]);
  });
  it("GeoMet: a Dimension with no good default is passed over for the next", () => {
    expect(parseGeoMetCaps('<Dimension name="time" default="bad">x</Dimension><Dimension name="time" default="2026-10-06T07:12:00Z">x</Dimension>').key)
      .toBe("2026-10-06T07:12:00Z");
  });
  it("nowCOAST: each region its OWN list, as listed (seconds and all)", () => {
    const caps = '<Layer><Name>conus_base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-06T07:08:14Z">2026-10-06T07:00:10Z,2026-10-06T07:04:12Z,2026-10-06T07:08:14Z</Dimension></Layer>'
      + '<Layer><Name>guam_base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-06T07:00:00Z">x</Dimension></Layer>';
    const m = parseNowCoastRegions(caps);
    expect(m.get("conus_base_reflectivity_mosaic").list.map((x) => x.key)).toEqual(["2026-10-06T07:00:10Z", "2026-10-06T07:04:12Z", "2026-10-06T07:08:14Z"]);
    expect(m.get("guam_base_reflectivity_mosaic").list).toEqual([{ key: "2026-10-06T07:00:00Z", time: U(7, 0) }]);
  });
  it("nowCOAST: a listed time after the region's default is not in its list", () => {
    const caps = '<Layer><Name>conus_base_reflectivity_mosaic</Name><Dimension name="time" default="2026-10-06T07:04:12Z">2026-10-06T07:00:10Z,2026-10-06T07:04:12Z,2026-10-06T07:08:14Z</Dimension></Layer>';
    expect(parseNowCoastRegions(caps).get("conus_base_reflectivity_mosaic").list.map((x) => x.key)).toEqual(["2026-10-06T07:00:10Z", "2026-10-06T07:04:12Z"]);
  });
  it("RainViewer: every good past frame, oldest first; a bad one skipped", () => {
    const f = parseRainViewer({ host: "https://h", radar: { past: [
      { time: U(7, 10) / 1000, path: "/v2/b" }, { time: U(7, 0) / 1000, path: "/v2/a" }, { time: 1, path: "bad" }, { path: "/v2/c" }, null,
      { time: U(7, 20) / 1000, path: "/v2/n" },
    ] } });
    expect(f.key).toBe("/v2/n");
    expect(f.list.map((x) => x.key)).toEqual(["/v2/a", "/v2/b", "/v2/n"]);
    expect(f.list[0]).toEqual({ key: "/v2/a", host: "https://h", path: "/v2/a", time: U(7, 0) });
  });
  it("JMA: newest first in the answer, oldest first in the list, once each", () => {
    const e = (t) => ({ basetime: t, validtime: t, elements: ["hrpns"] });
    const f = parseJma([e("20261006072500"), e("20261006072000"), e("20261006072000"), null, e("20261006071500")]);
    expect(f.key).toBe("20261006072500");
    expect(f.list.map((x) => x.key)).toEqual(["20261006071500", "20261006072000", "20261006072500"]);
  });
  it("FMI/DWD: thirteen frames back to an hour, on the 5-minute grid, ending at the computed newest", () => {
    const now = U(7, 31, 20);
    const l = computedList(now);
    expect(l).toHaveLength(13);
    expect(l.at(-1)).toEqual(computedFiveMinute(now));
    expect(l[0].time).toBe(U(6, 25));
    expect(l[0].key).toBe("2026-10-06T06:25:00Z");
    expect(computedList(now, 2).map((x) => x.key)).toEqual(["2026-10-06T07:20:00Z", "2026-10-06T07:25:00Z"]);
  });
});
