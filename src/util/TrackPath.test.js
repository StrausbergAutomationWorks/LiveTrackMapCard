import { describe, expect, it } from "@jest/globals";
import { parseTrackPath, trackRoute, metres, TRACK_PATH_MAX_POINTS, TRACK_PATH_JOIN_M } from "./TrackPath.js";

// The rail route hint (06_MAP_CONTRACT.md D3c-v): a line with a bend, east
// along the equator then north.
const BEND = [[0, 0], [0, 0.01], [0.01, 0.01]];
const at = (lat, lng) => ({ lat, lng });

describe("parseTrackPath", () => {
  it("reads [lat, lon] pairs", () => {
    expect(parseTrackPath(BEND)).toEqual([at(0, 0), at(0, 0.01), at(0.01, 0.01)]);
  });

  it.each([
    undefined, null, "x", [], [[0, 0]], [[0, 0], [0]], [[0, 0], ["0", 1]], [[0, 0], [91, 0]],
    [[0, 0], [0, 181]], [[0, 0], [NaN, 0]], [[0, 0], { lat: 0, lng: 0 }],
  ])("refuses %p", (v) => {
    expect(parseTrackPath(v)).toBeNull();
  });

  it("refuses more than the cap, whole", () => {
    const many = Array.from({ length: TRACK_PATH_MAX_POINTS + 1 }, (_, i) => [0, i * 1e-5]);
    expect(parseTrackPath(many)).toBeNull();
  });
});

describe("trackRoute", () => {
  it("goes round the bend, from where the marker is drawn to where it is going", () => {
    const r = trackRoute(BEND, at(0, 0), at(0.01, 0.01));
    expect(r[0]).toEqual(at(0, 0));
    expect(r).toContainEqual(at(0, 0.01));
    expect(r[r.length - 1]).toEqual(at(0.01, 0.01));
  });

  it("joins the path where the marker is, part way along it", () => {
    const r = trackRoute(BEND, at(0.0001, 0.005), at(0.01, 0.01));
    expect(r[1].lat).toBeCloseTo(0, 6);
    expect(r[1].lng).toBeCloseTo(0.005, 6);
    expect(r[2]).toEqual(at(0, 0.01));
  });

  it("ends exactly at the target object, so the slide ends there", () => {
    const to = at(0.01, 0.01);
    const r = trackRoute(BEND, at(0, 0), to);
    expect(r[r.length - 1]).toBe(to);
  });

  it("a stale path, ending elsewhere, is not used", () => {
    expect(trackRoute(BEND, at(0, 0), at(0.02, 0.01))).toBeNull();
  });

  it("a marker drawn far from the path slides straight", () => {
    const far = at(0, -(TRACK_PATH_JOIN_M + 100) / 111195);
    expect(trackRoute(BEND, far, at(0.01, 0.01))).toBeNull();
    expect(trackRoute(BEND, at(0, -(TRACK_PATH_JOIN_M - 100) / 111195), at(0.01, 0.01))).not.toBeNull();
  });

  it("no path, no route", () => {
    expect(trackRoute(undefined, at(0, 0), at(0.01, 0.01))).toBeNull();
  });

  it("metres: a thousandth of a degree on the equator", () => {
    expect(metres(at(0, 0), at(0, 0.001))).toBeCloseTo(111.2, 1);
  });
});
