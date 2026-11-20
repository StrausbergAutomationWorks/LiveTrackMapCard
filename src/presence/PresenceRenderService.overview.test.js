import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import L from "leaflet";
import PresenceRenderService, { ZONE_PANE } from "./PresenceRenderService.js";

// Step 2 (Lee 2026-11-19): with the overview shown the presence markers follow Home Assistant's panel
// layout: the tab hides persons or trackers, only the selection shows an accuracy circle and leaves its
// bubble at 1.25x, a zone's radius shows when selected or on the Zones tab, and a tap selects.

let el, host, map, svc;
const HOME = [41.9, -88.0];
const zone = (lat, lng, extra = {}) => ({ state: "0", attributes: { latitude: lat, longitude: lng, radius: 100, friendly_name: "Zone", icon: "mdi:map-marker", ...extra } });

/**
 * Two people, a tablet and two zones, in short.
 * @param {object} [extra] states to add or replace
 * @returns {object} hass.states
 */
function states(extra = {}) {
  const s = {
    "zone.home": zone(...HOME, { friendly_name: "Home", icon: "mdi:home" }),
    "zone.work": zone(HOME[0] + 0.05, HOME[1], { friendly_name: "Work", radius: 250 }),
    "person.ana": { state: "home", attributes: { friendly_name: "Ana Lopez", latitude: HOME[0], longitude: HOME[1], gps_accuracy: 30, entity_picture: "/api/image/ana", in_zones: ["zone.home"] } },
    "person.ben": { state: "home", attributes: { friendly_name: "Ben", latitude: HOME[0] + 0.0001, longitude: HOME[1], gps_accuracy: 0, entity_picture: "/api/image/ben", in_zones: ["zone.home"] } },
    "device_tracker.bens_ipad": { state: "home", attributes: { friendly_name: "Ben's iPad", latitude: HOME[0], longitude: HOME[1] + 0.0001, gps_accuracy: 20, in_zones: ["zone.home"] } },
    ...extra,
  };
  for (const [id, v] of Object.entries(s)) if (v) v.entity_id = id;
  return s;
}
const makeHass = (st = states()) => ({ states: st, hassUrl: (u) => u, connection: { sendMessagePromise: jest.fn(() => Promise.resolve([])) } });
const configs = [{ id: "person.ana" }, { id: "person.ben" }, { id: "device_tracker.bens_ipad" }, { id: "zone.home" }];

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  el = document.createElement("div");
  host.appendChild(el);
  map = L.map(el, { maxZoom: 18 }).setView(HOME, 15);
  map.getSize = () => L.point(1000, 700);
  L.tileLayer("https://tiles.example/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(map);
  svc = new PresenceRenderService(map, { enabled: true, styleHost: () => host });
  svc.setup();
  svc.setEntities(configs);
});
afterEach(() => { svc?.cleanup(); map?.remove(); host?.remove(); });

const bubbleIds = () => [...el.querySelectorAll(".ltmc-cluster")].map((b) => [...b.querySelectorAll(".ltmc-frame")].map((f) => f.dataset.entityId));
const pins = () => [...el.querySelectorAll(".ltmc-pin")];
const pinIds = () => pins().map((p) => p.querySelector(".ltmc-frame").dataset.entityId);
const circles = () => { const out = []; map.eachLayer((l) => { if (l instanceof L.Circle) out.push(l); }); return out; };
const zoneRadii = () => circles().filter((c) => c.options.pane === "ltmcZoneCircles" && [100, 250].includes(c.getRadius())).map((c) => c.getRadius()).sort();

describe("without the overview nothing changes from step 1", () => {
  it("every zone's radius, every reported accuracy, more-info on a tap", () => {
    svc.render(makeHass());
    expect(zoneRadii()).toEqual([100, 250]);
    map.setZoom(18);
    const heard = jest.fn();
    host.addEventListener("hass-action", heard);
    const frame = el.querySelector(".ltmc-cluster.open .ltmc-frame") ?? el.querySelector(".ltmc-pin .ltmc-frame");
    frame.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(heard).toHaveBeenCalled();
    expect(el.querySelectorAll(".ltmc-zone-icon.ltmc-selectable")).toHaveLength(0);
  });
  it("setOverview with nothing changed does not redraw", () => {
    svc.render(makeHass());
    const spy = jest.spyOn(svc, "redraw");
    svc.setOverview({ shown: false });
    expect(spy).not.toHaveBeenCalled();
    svc.setOverview({ shown: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("the tab filters the map", () => {
  it("People: trackers hidden; Devices: persons hidden; Zones: both; the selection stays", () => {
    svc.render(makeHass());
    svc.setOverview({ shown: true, tab: "people" });
    expect(bubbleIds().flat().sort()).toEqual(["person.ana", "person.ben"]);
    svc.setOverview({ shown: true, tab: "devices" });
    expect([...bubbleIds().flat(), ...pinIds()]).toEqual(["device_tracker.bens_ipad"]);
    svc.setOverview({ shown: true, tab: "zones" });
    expect([...bubbleIds().flat(), ...pinIds()]).toEqual([]);
    svc.setOverview({ shown: true, tab: "devices", selected: "person.ana" });
    expect(pinIds()).toEqual(["person.ana"]);
    expect(bubbleIds().flat()).toEqual(["device_tracker.bens_ipad"]);
  });
  it("turned off, the selection is dropped and everyone is back", () => {
    svc.render(makeHass());
    svc.setOverview({ shown: true, tab: "zones", selected: "person.ana" });
    svc.setOverview({ shown: false, tab: "zones", selected: "person.ana" });
    expect(svc.selected).toBeUndefined();
    expect(bubbleIds().flat().sort()).toEqual(["device_tracker.bens_ipad", "person.ana", "person.ben"]);
  });
});

describe("the selection", () => {
  it("leaves its bubble as a 1.25x pin (60 px) with its dot shown, drawn above the rest", () => {
    svc.render(makeHass());
    svc.setOverview({ shown: true, tab: "people", selected: "person.ana" });
    expect(bubbleIds()).toEqual([["person.ben"]]);
    const [pin] = pins();
    expect(pin.classList.contains("selected")).toBe(true);
    expect(pin.querySelector(".ltmc-frame").style.getPropertyValue("--ltmc-marker-size")).toBe("60px");
    let offset;
    map.eachLayer((l) => { if (l instanceof L.Marker && l.options.icon?.options?.className === "ltmc-pin-icon") offset = l.options.zIndexOffset; });
    expect(offset).toBe(1000);
  });
  it("only the selection shows an accuracy circle; none reported: 2.5 m, without an outline", () => {
    svc.render(makeHass());
    map.setZoom(18);
    svc.setOverview({ shown: true, tab: "people" });
    const acc = () => circles().filter((c) => ![100, 250].includes(c.getRadius()));
    expect(acc()).toHaveLength(0);
    svc.setOverview({ shown: true, tab: "people", selected: "person.ben" });
    expect(acc().map((c) => [c.getRadius(), c.options.weight])).toEqual([[2.5, 0]]);
    svc.setOverview({ shown: true, tab: "people", selected: "person.ana" });
    expect(acc().map((c) => [c.getRadius(), c.options.weight])).toEqual([[30, 3]]);
  });
  it("a free pin that is not selected shows no accuracy with the overview", () => {
    const st = states();
    st["person.ana"].attributes = { ...st["person.ana"].attributes, latitude: 42.5, longitude: -87.5, in_zones: [] };
    st["person.ana"].state = "not_home";
    svc.render(makeHass(st));
    svc.setOverview({ shown: true, tab: "people" });
    expect(pinIds()).toEqual(["person.ana"]);
    expect(pins()[0].classList.contains("selected")).toBe(false);
    expect(circles().filter((c) => c.getLatLng().lat === 42.5)).toHaveLength(0);
  });
});

describe("zone radii", () => {
  it("only the selected zone's, or every zone's on the Zones tab", () => {
    svc.render(makeHass());
    svc.setOverview({ shown: true, tab: "people" });
    expect(zoneRadii()).toEqual([]);
    svc.setOverview({ shown: true, tab: "people", selected: "zone.work" });
    expect(zoneRadii()).toEqual([250]);
    svc.setOverview({ shown: true, tab: "zones" });
    expect(zoneRadii()).toEqual([100, 250]);
  });
});

describe("taps select", () => {
  it("a pin, an open bubble's avatar and a zone call onSelect instead of more-info", () => {
    const chosen = jest.fn();
    const heard = jest.fn();
    host.addEventListener("hass-action", heard);
    svc.onSelect = chosen;
    svc.render(makeHass());
    svc.setOverview({ shown: true, tab: "people" });
    map.setZoom(18);
    el.querySelector(".ltmc-cluster.open .ltmc-frame").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(chosen).toHaveBeenLastCalledWith("person.ana");
    const zoneIcon = el.querySelector(".ltmc-zone-icon.ltmc-selectable");
    expect(zoneIcon).not.toBeNull();
    zoneIcon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(chosen).toHaveBeenLastCalledWith("zone.home");
    expect(heard).not.toHaveBeenCalled();
    expect(map.getPane(ZONE_PANE).style.pointerEvents).toBe("");
  });
  it("shown but nobody listening: a tap still opens more-info, zones are not buttons", () => {
    const heard = jest.fn();
    host.addEventListener("hass-action", heard);
    svc.render(makeHass());
    svc.setOverview({ shown: true, tab: "people" });
    map.setZoom(18);
    el.querySelector(".ltmc-cluster.open .ltmc-frame").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(heard).toHaveBeenCalled();
    expect(el.querySelectorAll(".ltmc-zone-icon.ltmc-selectable")).toHaveLength(0);
  });
  it("hidden again, the zone pane stops taking pointer events", () => {
    svc.render(makeHass());
    svc.setOverview({ shown: true });
    svc.setOverview({ shown: false });
    expect(map.getPane(ZONE_PANE).style.pointerEvents).toBe("none");
  });
});

describe("focus", () => {
  it("a person: zoomed in only far enough to clear the nearest other marker, within the panel's padding", () => {
    svc.render(makeHass());
    svc.setOverview({ shown: true, tab: "people", selected: "person.ana" });
    map.setZoom(12, { animate: false });
    const fit = jest.spyOn(map, "fitBounds").mockImplementation(() => map);
    expect(svc.focus("person.ana", { left: 384 })).toBe(true);
    const [bounds, opts] = fit.mock.calls[0];
    expect(bounds.getCenter().lat).toBeCloseTo(HOME[0], 6);
    expect(opts.paddingTopLeft).toEqual([384, 0]);
    expect(opts.paddingBottomRight).toEqual([0, 0]);
    expect(opts.maxZoom).toBe(17);
  });
  it("never zooms out, never deeper than the base map", () => {
    svc.render(makeHass());
    svc.setOverview({ shown: true, tab: "people", selected: "person.ana" });
    map.setZoom(18, { animate: false });
    const fit = jest.spyOn(map, "fitBounds").mockImplementation(() => map);
    svc.focus("person.ana");
    expect(fit.mock.calls[0][1].maxZoom).toBe(18);
  });
  it("a base map that ends at 16 caps the focus at 16, under HA's 17 (mutation 2026-11-19)", () => {
    map.eachLayer((l) => { if (l instanceof L.TileLayer) l.options.maxZoom = 16; });
    svc.render(makeHass());
    map.setZoom(12, { animate: false });
    const fit = jest.spyOn(map, "fitBounds").mockImplementation(() => map);
    svc.focus("person.ana");
    expect(fit.mock.calls[0][1].maxZoom).toBe(16);
  });
  it("nothing near: stays at the current zoom", () => {
    const st = states({ "person.ben": null, "device_tracker.bens_ipad": null, "zone.home": null, "zone.work": null });
    delete st["person.ben"]; delete st["device_tracker.bens_ipad"]; delete st["zone.home"]; delete st["zone.work"];
    svc.render(makeHass(st));
    map.setZoom(11, { animate: false });
    const fit = jest.spyOn(map, "fitBounds").mockImplementation(() => map);
    svc.focus("person.ana");
    expect(fit.mock.calls[0][1].maxZoom).toBe(11);
  });
  it("off screen: flies there", () => {
    svc.render(makeHass());
    map.setView([10, 10], 12, { animate: false });
    const fly = jest.spyOn(map, "flyToBounds").mockImplementation(() => map);
    const fit = jest.spyOn(map, "fitBounds").mockImplementation(() => map);
    svc.focus("person.ana", { bottom: 382 });
    expect(fly).toHaveBeenCalled();
    expect(fit).not.toHaveBeenCalled();
    expect(fly.mock.calls[0][1].paddingBottomRight).toEqual([0, 382]);
  });
  it("a zone: its circle padded 20 %, no deeper than the current zoom", () => {
    svc.render(makeHass());
    map.setZoom(13, { animate: false });
    const fit = jest.spyOn(map, "fitBounds").mockImplementation(() => map);
    svc.focus("zone.work", { right: 10 });
    const [bounds, opts] = fit.mock.calls[0];
    const height = map.distance(bounds.getSouthWest(), L.latLng(bounds.getNorth(), bounds.getWest()));
    expect(height).toBeGreaterThan(2 * 250 * 1.3);
    expect(height).toBeLessThan(2 * 250 * 1.5);
    expect(opts.maxZoom).toBe(13);
    expect(opts.paddingBottomRight).toEqual([10, 0]);
  });
  it("an unknown entity or one without a location: nothing moves", () => {
    svc.render(makeHass(states({ "zone.nowhere": { state: "0", attributes: {} }, "person.lost": { state: "unknown", attributes: {} } })));
    const fit = jest.spyOn(map, "fitBounds");
    expect(svc.focus("person.gone")).toBe(false);
    expect(svc.focus("zone.nowhere")).toBe(false);
    expect(svc.focus("person.lost")).toBe(false);
    expect(fit).not.toHaveBeenCalled();
  });
});
