import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// A churning entity list (auto-entities over geo_location) must update the
// map in place: departed markers removed, new ones added, the rest untouched.

jest.mock("../../util/Logger");
jest.mock("../../util/HaMapUtilities");
jest.mock("../../models/Entity", () => {
  const Entity = jest.fn().mockImplementation(function (config) {
    this.config = config;
    this.id = config.id;
    this.setup = jest.fn(() => { Entity.log.push(["setup", config.id]); });
    this.remove = jest.fn(() => { Entity.log.push(["remove", config.id]); });
    if (Entity.failFor.has(config.id)) throw new Error("boom " + config.id);
  });
  Entity.log = [];
  Entity.failFor = new Set();
  return { __esModule: true, default: Entity };
});

import Entity from "../../models/Entity";
import EntitiesRenderService from "./EntitiesRenderService";
import FocusFollowConfig from "../../configs/FocusFollowConfig";

const cfg = (id, fingerprint = `{"entity":"${id}"}`) => ({ id, fingerprint });

describe("EntitiesRenderService.updateEntityConfigs", () => {
  let service, cluster, map, initial;

  beforeEach(() => {
    Entity.mockClear();
    Entity.log.length = 0;
    Entity.failFor.clear();
    map = { addLayer: jest.fn(), on: jest.fn() };
    cluster = { id: "cluster" };
    initial = [cfg("a"), cfg("b"), cfg("c")];
    service = new EntitiesRenderService(map, { id: "hass" }, new FocusFollowConfig("none"),
      initial, "linked", "range", "history", true, false);
    service.setup();
    service.markerClusterGroup = cluster;
    Entity.mockClear();
    Entity.log.length = 0;
  });

  const byId = () => Object.fromEntries(service.entities.map((e) => [e.config.id, e]));

  it("keeps an unchanged entity as the same object, untouched", () => {
    const before = byId();
    service.updateEntityConfigs([cfg("a"), cfg("b"), cfg("c")]);
    expect(Entity).not.toHaveBeenCalled();
    expect(service.entities).toEqual([before.a, before.b, before.c]);
    for (const e of service.entities) expect(e.remove).not.toHaveBeenCalled();
  });

  it("adds a new entity with the service's collaborators and cluster group", () => {
    service.updateEntityConfigs([cfg("a"), cfg("b"), cfg("c"), cfg("d")]);
    expect(Entity).toHaveBeenCalledTimes(1);
    expect(Entity).toHaveBeenCalledWith(expect.objectContaining({ id: "d" }), { id: "hass" }, map,
      "history", "range", "linked", true);
    expect(byId().d.setup).toHaveBeenCalledWith(cluster);
  });

  it("removes a departed entity, fully, and unsubscribes its history", () => {
    const gone = byId().b;
    service.updateEntityConfigs([cfg("a"), cfg("c")]);
    expect(gone.remove).toHaveBeenCalledWith(cluster, { unsubscribeHistory: true });
    expect(service.entities.map((e) => e.config.id)).toEqual(["a", "c"]);
  });

  it("replaces an entity whose own options changed, removing before creating", () => {
    const old = byId().b;
    service.updateEntityConfigs([cfg("a"), cfg("b", '{"entity":"b","color":"red"}'), cfg("c")]);
    expect(old.remove).toHaveBeenCalledWith(cluster, { unsubscribeHistory: true });
    expect(byId().b).not.toBe(old);
    expect(byId().b.config.fingerprint).toBe('{"entity":"b","color":"red"}');
    expect(Entity.log).toEqual([["remove", "b"], ["setup", "b"]]);
  });

  it("follows the order of the new list", () => {
    service.updateEntityConfigs([cfg("c"), cfg("e"), cfg("a")]);
    expect(service.entities.map((e) => e.config.id)).toEqual(["c", "e", "a"]);
  });

  it("records the new configs", () => {
    const next = [cfg("a"), cfg("z")];
    service.updateEntityConfigs(next);
    expect(service.entityConfigs.map((c) => c.id)).toEqual(["a", "z"]);
  });

  it("keeps two entries for the same entity as two markers", () => {
    service.updateEntityConfigs([cfg("a"), cfg("a"), cfg("b"), cfg("c")]);
    expect(service.entities.map((e) => e.config.id)).toEqual(["a", "a", "b", "c"]);
    expect(Entity).toHaveBeenCalledTimes(1);
  });

  it("dropping one of two duplicates keeps the other's history stream", () => {
    service.updateEntityConfigs([cfg("a"), cfg("a")]);
    const [first, second] = service.entities;
    service.updateEntityConfigs([cfg("a")]);
    expect(service.entities).toEqual([first]);
    expect(second.remove).toHaveBeenCalledWith(cluster, { unsubscribeHistory: false });
  });

  it("retries an entity that failed to load before", () => {
    Entity.failFor.add("x");
    service.updateEntityConfigs([cfg("a"), cfg("b"), cfg("c"), cfg("x")]);
    expect(Object.keys(byId())).not.toContain("x");
    Entity.failFor.clear();
    service.updateEntityConfigs([cfg("a"), cfg("b"), cfg("c"), cfg("x")]);
    expect(Object.keys(byId())).toContain("x");
  });

  it("skips a new entity that throws, and keeps the rest", () => {
    Entity.failFor.add("bad");
    service.updateEntityConfigs([cfg("a"), cfg("bad"), cfg("d")]);
    expect(service.entities.map((e) => e.config.id)).toEqual(["a", "d"]);
  });

  it("carries on when removing an entity throws", () => {
    const { b, c } = byId();
    b.remove.mockImplementation(() => { throw new Error("stuck"); });
    service.updateEntityConfigs([cfg("a"), cfg("d")]);
    expect(c.remove).toHaveBeenCalled();
    expect(service.entities.map((e) => e.config.id)).toEqual(["a", "d"]);
  });

  it("does not touch the map or build a new cluster group", () => {
    map.addLayer.mockClear();
    service.updateEntityConfigs([cfg("a"), cfg("q")]);
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(service.markerClusterGroup).toBe(cluster);
  });
});
