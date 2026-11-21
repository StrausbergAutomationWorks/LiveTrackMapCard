import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import L from "leaflet";
import PresenceRenderService, { ZONE_PANE, PRESENCE_PANE, ZONE_CIRCLE_PANE, placeZonePanes } from "./PresenceRenderService.js";

let el, host, map, svc;

const HOME = [41.9, -88.0];
const zone = (lat, lng, extra = {}) => ({ entity_id: "", state: "0", attributes: { latitude: lat, longitude: lng, radius: 100, friendly_name: "Zone", icon: "mdi:map-marker", ...extra } });

/**
 * The box's people, devices and zones, in short.
 * @param {object} [extra] states to add or replace
 * @returns {object} hass.states
 */
function states(extra = {}) {
  const s = {
    "zone.home": zone(...HOME, { friendly_name: "Home", icon: "mdi:home" }),
    "zone.announce": zone(...HOME, { passive: true, radius: 3800 }),
    "zone.tx": zone(32.8, -97.0, { friendly_name: "TX" }),
    "person.ana": { state: "home", attributes: { friendly_name: "Ana Lopez", latitude: HOME[0], longitude: HOME[1], gps_accuracy: 100, entity_picture: "/api/image/ana", in_zones: ["zone.home", "zone.announce"] } },
    "person.ben": { state: "home", attributes: { friendly_name: "Ben", latitude: HOME[0] + 0.0001, longitude: HOME[1], gps_accuracy: 9, entity_picture: "/api/image/ben", in_zones: ["zone.home", "zone.announce"] } },
    "device_tracker.bens_ipad": { state: "home", attributes: { friendly_name: "Ben's iPad", latitude: HOME[0], longitude: HOME[1] + 0.0001, gps_accuracy: 20, in_zones: ["zone.home", "zone.announce"] } },
    "geo_location.flight": { state: "5", attributes: { latitude: HOME[0], longitude: HOME[1], source: "live_track_aircraft" } },
    ...extra,
  };
  for (const [id, v] of Object.entries(s)) if (v) v.entity_id = id;
  return s;
}

/**
 * A hass with a websocket that answers the entity registry.
 * @param {object} [st] states
 * @param {Promise} [registry] what config/entity_registry/list answers
 * @returns {object}
 */
function makeHass(st = states(), registry = Promise.resolve([])) {
  return {
    states: st,
    hassUrl: (u) => `https://ha.local${u}`,
    connection: { sendMessagePromise: jest.fn(() => registry) },
  };
}

const configs = [
  { id: "person.ana", display: "marker" },
  { id: "person.ben", display: "marker" },
  { id: "device_tracker.bens_ipad", display: "pill" },
  { id: "zone.home", display: "marker" },
  { id: "geo_location.flight", display: "attribute" },
];

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  el = document.createElement("div");
  host.appendChild(el);
  map = L.map(el, { maxZoom: 18 }).setView(HOME, 15);
  map.getSize = () => L.point(390, 620);
  svc = new PresenceRenderService(map, { enabled: true, styleHost: () => host });
  svc.setup();
  svc.setEntities(configs);
});

afterEach(() => {
  svc?.cleanup();
  map?.remove();
  host?.remove();
});

const zonesDrawn = () => [...el.querySelectorAll(".ltmc-zone-circle")].map((z) => z.dataset.zone);
const bubblesDrawn = () => [...el.querySelectorAll(".ltmc-cluster")];
const pinsDrawn = () => [...el.querySelectorAll(".ltmc-pin .ltmc-frame")].map((f) => f.dataset.entityId);

describe("which entities", () => {
  it("draws persons and trackers with display unset, marker or pill; never a geo_location", () => {
    expect(svc.entityIds).toEqual(["person.ana", "person.ben", "device_tracker.bens_ipad"]);
    expect(svc.drawsId("zone.home")).toBe(true);
    expect(svc.drawsId("geo_location.flight")).toBe(false);
  });
  it("a person with another display stays with the older marker", () => {
    svc.setEntities([{ id: "person.ana", display: "icon" }]);
    expect(svc.drawsId("person.ana")).toBe(false);
    expect(svc.entityIds).toEqual([]);
  });
  it("option off: draws nothing and takes nothing", () => {
    const off = new PresenceRenderService(map, { enabled: false });
    off.setup();
    off.setEntities(configs);
    off.render(makeHass());
    expect(off.drawsId("person.ana")).toBe(false);
    expect(map.getPane("ltmcPresence")).toBeTruthy(); // from svc, not off
  });
});

// Lee 2026-11-20 19:23: every .leaflet-pane is z-index 0 on this card, so DOM order decides; made last, the zone
// panes covered every marker. They go just before markerPane, under every marker pane made before or after.
describe("pane order (DOM order decides on this card)", () => {
  const order = () => [...map.getPane("mapPane").children];
  const idx = (name) => order().indexOf(map.getPane(name));

  it("puts the zone circles, then the zone icons, just before Leaflet's markerPane", () => {
    expect(idx(ZONE_CIRCLE_PANE)).toBe(idx("markerPane") - 2);
    expect(idx(ZONE_PANE)).toBe(idx("markerPane") - 1);
    expect(idx(ZONE_PANE)).toBeGreaterThan(idx("overlayPane"));
  });

  it("keeps the zones under marker panes made afterwards (MarkerPlacement's class panes)", () => {
    const late = map.createPane("ltmcMarkers_air");
    expect(order().indexOf(late)).toBeGreaterThan(idx(ZONE_PANE));
    expect(order().indexOf(late)).toBeGreaterThan(idx(ZONE_CIRCLE_PANE));
  });

  it("puts misplaced zone panes back, and is safe to run again", () => {
    map.getPane("mapPane").appendChild(map.getPane(ZONE_PANE));
    map.getPane("mapPane").appendChild(map.getPane(ZONE_CIRCLE_PANE));
    placeZonePanes(map);
    placeZonePanes(map);
    expect(idx(ZONE_CIRCLE_PANE)).toBe(idx("markerPane") - 2);
    expect(idx(ZONE_PANE)).toBe(idx("markerPane") - 1);
    expect(() => placeZonePanes(null)).not.toThrow();
  });

  it("leaves the people's pane where it was made: it is raised by MapCard's CSS, not by DOM order", () => {
    expect(idx(PRESENCE_PANE)).toBeGreaterThan(idx("markerPane"));
  });
});

describe("zones", () => {
  it("every non-passive zone, listed on the dashboard or not; passive left out", () => {
    svc.render(makeHass());
    expect(zonesDrawn().sort()).toEqual(["zone.home", "zone.tx"]);
  });
  it("a circle in the zone's colour at its radius, under the markers", () => {
    svc.render(makeHass());
    const circles = [];
    map.eachLayer((l) => { if (l instanceof L.Circle && l.options.pane === ZONE_CIRCLE_PANE && l.getRadius() === 100) circles.push(l); });
    expect(circles.length).toBe(2);
    const home = circles.find((c) => c.getLatLng().lat === HOME[0]);
    expect(home.options).toMatchObject({ weight: 3, fillOpacity: 0.2, interactive: false });
    expect(Number(map.getPane(ZONE_PANE).style.zIndex)).toBeLessThan(600);
    expect(Number(map.getPane(PRESENCE_PANE).style.zIndex)).toBeGreaterThan(600);
  });
  it("home takes the theme's primary colour; outside Home Assistant the fallback", () => {
    svc.render(makeHass());
    const homeEl = el.querySelector('[data-zone="zone.home"].ltmc-zone-circle');
    expect(homeEl.style.backgroundColor).toBe("rgb(3, 169, 244)");
    expect(homeEl.querySelector("ha-icon").getAttribute("icon")).toBe("mdi:home");
  });
  it("other zones their palette slot from the registry, read from the theme", async () => {
    host.style.setProperty("--color-1", "#ff0000");
    host.style.setProperty("--color-2", "#00ff00");
    const hass = makeHass(states({ "zone.b": zone(10, 10, { friendly_name: "B" }) }), Promise.resolve([
      { entity_id: "zone.b", id: "1", created_at: 5 },
      { entity_id: "zone.tx", id: "2", created_at: 9 },
    ]));
    svc.render(hass);
    await Promise.resolve(); await Promise.resolve();
    expect(hass.connection.sendMessagePromise).toHaveBeenCalledWith({ type: "config/entity_registry/list" });
    expect(el.querySelector('[data-zone="zone.b"]').style.backgroundColor).toBe("rgb(255, 0, 0)");
    expect(el.querySelector('[data-zone="zone.tx"]').style.backgroundColor).toBe("rgb(0, 255, 0)");
  });
  it("registry unreadable: still drawn", async () => {
    const hass = makeHass(states(), Promise.reject(new Error("no")));
    svc.render(hass);
    await Promise.resolve(); await Promise.resolve();
    expect(svc.palette).toBeNull();
    expect(zonesDrawn().length).toBe(2);
  });
  it("a zone without an icon shows its initials", () => {
    svc.render(makeHass(states({ "zone.tx": zone(32.8, -97, { friendly_name: "Texas Office", icon: undefined }) })));
    expect(el.querySelector('[data-zone="zone.tx"]').textContent).toBe("TO");
  });
});

describe("people and devices", () => {
  it("everyone at home shares one bubble above the home zone", () => {
    svc.render(makeHass());
    const b = bubblesDrawn();
    expect(b).toHaveLength(1);
    expect(b[0].dataset.zone).toBe("zone.home");
    const avatars = [...b[0].querySelectorAll(".ltmc-frame")];
    expect(avatars.map((a) => a.dataset.entityId)).toEqual(["person.ana", "person.ben", "device_tracker.bens_ipad"]);
    expect(avatars[0].querySelector(".ltmc-picture").style.backgroundImage).toContain("https://ha.local/api/image/ana");
    expect(avatars[2].textContent).toBe("Bi");
    expect(pinsDrawn()).toEqual([]);
  });
  it("five at home: three avatars and +2", () => {
    const extra = {};
    for (const n of ["a", "b"]) extra[`device_tracker.${n}`] = { state: "home", attributes: { friendly_name: n, latitude: HOME[0], longitude: HOME[1], in_zones: ["zone.home"] } };
    svc.setEntities([...configs, { id: "device_tracker.a" }, { id: "device_tracker.b" }]);
    svc.render(makeHass(states(extra)));
    const b = bubblesDrawn()[0];
    expect(b.querySelectorAll(".ltmc-frame")).toHaveLength(3);
    expect(b.querySelector(".more").textContent).toBe("+2");
  });
  it("someone away is a picture pin at their position, with an accuracy circle", () => {
    const st = states();
    st["person.ana"].attributes = { ...st["person.ana"].attributes, latitude: 42.5, longitude: -87.5, in_zones: [] };
    st["person.ana"].state = "not_home";
    svc.render(makeHass(st));
    expect(pinsDrawn()).toEqual(["person.ana"]);
    const acc = [];
    map.eachLayer((l) => { if (l instanceof L.Circle && l.getRadius() === 100 && l.getLatLng().lat === 42.5) acc.push(l); });
    expect(acc).toHaveLength(1);
    expect(acc[0].options.weight).toBe(3);
  });
  it("a precise fix (10 m or better) has no outline", () => {
    const st = states();
    st["person.ben"].attributes = { ...st["person.ben"].attributes, latitude: 45, longitude: -90, in_zones: [] };
    st["person.ben"].state = "not_home";
    svc.render(makeHass(st));
    const acc = [];
    map.eachLayer((l) => { if (l instanceof L.Circle && l.getLatLng().lat === 45) acc.push(l); });
    expect(acc[0].options.weight).toBe(0);
  });
  it("an unchanged hass does not redraw", () => {
    const hass = makeHass();
    svc.render(hass);
    const spy = jest.spyOn(svc, "regroup");
    svc.render({ ...hass, states: { ...hass.states, "geo_location.flight": { ...hass.states["geo_location.flight"], state: "6" } } });
    expect(spy).not.toHaveBeenCalled();
  });
  it("a person's change redraws", () => {
    const hass = makeHass();
    svc.render(hass);
    const spy = jest.spyOn(svc, "regroup");
    const st = { ...hass.states, "person.ana": { ...hass.states["person.ana"], state: "x" } };
    svc.render({ ...hass, states: st });
    expect(spy).toHaveBeenCalled();
  });
});

describe("taps", () => {
  it("a tap on a closed bubble zooms to its members, not more-info", () => {
    svc.render(makeHass());
    const fit = jest.spyOn(map, "fitBounds").mockImplementation(() => map);
    const heard = jest.fn();
    el.addEventListener("hass-action", heard);
    bubblesDrawn()[0].querySelector(".ltmc-frame").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(fit).toHaveBeenCalled();
    expect(fit.mock.calls[0][1]).toEqual({ maxZoom: 18 });
    expect(heard).not.toHaveBeenCalled();
  });
  it("at the maximum zoom the bubble opens and each avatar opens more-info", () => {
    map.setView(HOME, 18);
    svc.render(makeHass());
    const b = bubblesDrawn()[0];
    expect(b.classList.contains("open")).toBe(true);
    const heard = jest.fn();
    el.addEventListener("hass-action", (e) => heard(e.detail));
    b.querySelectorAll(".ltmc-frame")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(heard).toHaveBeenCalledWith({ config: { entity: "person.ben", tap_action: { action: "more-info" } }, action: "tap" });
  });
  it("the deepest zoom is the base map's, not an overlay's or the map's (live 2026-11-19: 24, a tap to 23)", () => {
    L.tileLayer("https://tile.example/{z}/{x}/{y}.png", { maxZoom: 16 }).addTo(map);
    L.tileLayer("https://overlay.example/{z}/{x}/{y}.png", { maxZoom: 24 }).addTo(map);
    L.tileLayer("https://radar.example/{z}/{x}/{y}.png", { maxZoom: 24, pane: "overlayPane" }).addTo(map);
    expect(svc.maxZoom()).toBe(16);
    svc.render(makeHass());
    const fit = jest.spyOn(map, "fitBounds").mockImplementation(() => map);
    bubblesDrawn()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(fit.mock.calls[0][1]).toEqual({ maxZoom: 16 });
    fit.mockRestore();
    map.setView(HOME, 16);
    svc.regroup();
    expect(bubblesDrawn()[0].classList.contains("open")).toBe(true);
  });
  it("a tile layer in its own pane is not the base map, even added first", () => {
    L.tileLayer("https://radar.example/{z}/{x}/{y}.png", { maxZoom: 24, pane: "overlayPane" }).addTo(map);
    L.tileLayer("https://tile.example/{z}/{x}/{y}.png", { maxZoom: 16 }).addTo(map);
    expect(svc.maxZoom()).toBe(16);
  });
  it("no tile layer: the map's own maximum", () => {
    expect(svc.maxZoom()).toBe(18);
  });
  it("after the zoom a bubble whose members cannot part opens", () => {
    svc.render(makeHass());
    const members = svc.groups[0].members;
    svc._pending = new Set(members.map((m) => m.id));
    svc.regroup();
    expect(bubblesDrawn()[0].classList.contains("open")).toBe(true);
    // the pending set is used once
    svc.regroup();
    expect(bubblesDrawn()[0].classList.contains("open")).toBe(false);
  });
  it("a pin's tap opens more-info", () => {
    const st = states();
    st["person.ana"].attributes = { ...st["person.ana"].attributes, latitude: 42.5, longitude: -87.5, in_zones: [] };
    st["person.ana"].state = "not_home";
    svc.render(makeHass(st));
    const heard = jest.fn();
    el.addEventListener("hass-action", (e) => heard(e.detail.config.entity));
    el.querySelector('.ltmc-pin .ltmc-frame[data-entity-id="person.ana"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(heard).toHaveBeenCalledWith("person.ana");
  });
});

describe("cleanup", () => {
  it("takes everything off the map", () => {
    svc.render(makeHass());
    svc.cleanup();
    expect(el.querySelectorAll(".ltmc-zone-circle, .ltmc-cluster, .ltmc-pin")).toHaveLength(0);
  });
});
