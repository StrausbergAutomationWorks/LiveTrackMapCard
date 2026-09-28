
import Entity, { initialBearing, TRAVEL_BEARING_MIN_M } from './Entity.js';
import { LatLng, Marker } from 'leaflet';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

// Ships item 270, the turn order: while a marker slides its picture faces the
// direction it is drawn moving; on arrival it turns to the emitter's angle.
// Before, it turned to the final heading when the update arrived, then
// travelled - sideways or backwards when the two disagreed.

let clock, frames, nextFrame, reducedMotion;
const NOW = Date.parse('2026-09-28T20:00:00Z');

beforeEach(() => {
  clock = 1000;
  frames = new Map();
  nextFrame = 1;
  reducedMotion = false;
  jest.spyOn(Date, 'now').mockImplementation(() => NOW);
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  globalThis.requestAnimationFrame = jest.fn((cb) => { const id = nextFrame++; frames.set(id, cb); return id; });
  globalThis.cancelAnimationFrame = jest.fn((id) => frames.delete(id));
  window.matchMedia = jest.fn((q) => ({ matches: reducedMotion && q.includes('reduce'), media: q }));
  jest.spyOn(Marker.prototype, 'addTo').mockImplementation(function () { return this; });
});
afterEach(() => { jest.restoreAllMocks(); delete window.matchMedia; });

/**
 * Advance the clock and run the frames that were pending.
 * @param {number} ms
 */
function tick(ms) {
  clock += ms;
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, cb] of pending) cb(clock);
}

// ~111 m per 0.001 deg of latitude in the fake map.distance below; 1 m = 0.000009 deg.
const M = 1 / 111000;

/**
 * An entity at 41.0, -88.0 whose picture turns by icon_rotation_deg, with a
 * hand-driven marker. `writes` records every rotation written to the marker.
 * @param {object} [o]
 * @param {number|string} [o.transition] position_transition, as EntityConfig normalises it
 * @param {object} [o.attrs] attributes over the defaults
 * @param {string|null} [o.rotationAttribute] rotation_attribute
 * @returns {{entity: Entity, attributes: object, update: Function, writes: number[], drawnAngle: Function}}
 */
function makeEntity({ transition = 10, attrs = {}, rotationAttribute = 'icon_rotation_deg' } = {}) {
  const attributes = { friendly_name: 'X', latitude: 41.0, longitude: -88.0, icon_rotation_deg: 0, ...attrs };
  const hass = { states: { 'geo_location.x': { state: '1', attributes } }, formatEntityState: () => 'S', hassUrl: (u) => u };
  const config = {
    id: 'geo_location.x', display: 'marker', positionUpdateThreshold: 10,
    positionTransition: transition, rotationAttribute, rotationTransition: 3,
    circleConfig: {}, geoJsonConfig: {},
  };
  const map = { distance: jest.fn((a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111000) };
  const entity = new Entity(config, hass, map, jest.fn(), jest.fn(), jest.fn(), false);
  let drawn = new LatLng(41.0, -88.0);
  entity.marker = {
    setLatLng: jest.fn((ll) => { drawn = Array.isArray(ll) ? new LatLng(ll[0], ll[1]) : ll; }),
    getLatLng: jest.fn(() => drawn),
    remove: jest.fn(),
  };
  entity._lastSetLatLng = new LatLng(41.0, -88.0);
  entity.circle.remove = jest.fn(); entity.geoJson.remove = jest.fn(); entity.historyManager.remove = jest.fn();
  // As update() does: the emitter's angle first, then the position.
  entity._currentRotation = entity.rotationDegrees();
  const writes = [];
  jest.spyOn(entity, '_setMarkerAttribute').mockImplementation((name, value) => {
    if (name === 'rotation') writes.push(value === '' ? null : Number(value));
  });
  const update = (lat, lng, over = {}) => {
    Object.assign(attributes, { latitude: lat, longitude: lng }, over);
    entity.refreshMarkerRotation();
    entity.updateMarkerPosition();
  };
  const drawnAngle = () => entity._currentRotation;
  return { entity, attributes, update, writes, drawnAngle };
}

describe('initialBearing: known answers', () => {
  it.each([
    [[0, 0], [1, 0], 0], [[0, 0], [0, 1], 90], [[0, 0], [-1, 0], 180], [[0, 0], [0, -1], 270],
    [[0, 179.9], [0, -179.9], 90],   // east across the antimeridian, not 270
    [[0, -179.9], [0, 179.9], 270],
    [[41, -88], [41.001, -88.001], 360 - 36.99],   // NW at 41 N: lng scaled by cos(lat)
  ])('%p -> %p is %p', (a, b, want) => {
    const got = initialBearing({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
    expect(got).toBeGreaterThanOrEqual(0);
    expect(got).toBeLessThan(360);
    expect(got).toBeCloseTo(want, 0);
  });

  it('the floor is the measured 30 m', () => {
    expect(TRAVEL_BEARING_MIN_M).toBe(30);
  });
});

describe('turn order: face the way it moves, then turn to the heading', () => {
  it('faces the travel bearing while sliding and the reported angle on arrival', () => {
    // Heading reported north (0), but the vessel is drawn moving due east.
    const { update, writes, drawnAngle } = makeEntity();
    update(41.0, -87.99);                        // ~1.1 km east
    expect(drawnAngle()).toBeCloseTo(90, 1);     // facing travel from the start of the slide
    tick(5000);
    expect(drawnAngle()).toBeCloseTo(90, 1);     // still, mid-slide
    tick(5000);                                  // arrives
    expect(drawnAngle()).toBeCloseTo(0, 6);      // then turns to the reported heading
    expect(writes.length).toBe(2);
  });

  it('a reported angle that changes mid-slide waits for arrival, then the newest one is used', () => {
    const { update, attributes, entity, drawnAngle } = makeEntity();
    update(41.0, -87.99);
    tick(2000);
    attributes.icon_rotation_deg = 45;           // an update with no position change
    entity.refreshMarkerRotation();
    entity.updateMarkerPosition();
    expect(drawnAngle()).toBeCloseTo(90, 1);
    tick(8000);
    expect(drawnAngle()).toBeCloseTo(45, 6);     // the NEWEST reported angle on arrival
  });

  it('writes the rotation twice per slide, never once per frame', () => {
    const { update, writes } = makeEntity();
    update(41.0, -87.99);
    for (let i = 0; i < 600; i++) tick(1000 / 60);
    tick(1);                                     // 600 x 16.67 ms falls just short of 10 s in floating point
    expect(frames.size).toBe(0);
    expect(writes.length).toBe(2);
  });

  it('turns the short way across north, both ways', () => {
    // Reported 10 deg; travel toward ~350 deg; back to 10 on arrival.
    const { update, drawnAngle } = makeEntity({ attrs: { icon_rotation_deg: 10 } });
    expect(drawnAngle()).toBe(10);
    update(41.0 + 1000 * M * Math.cos(10 * Math.PI / 180), -88.0 - 1000 * M * Math.sin(10 * Math.PI / 180) / Math.cos(41 * Math.PI / 180));
    expect(drawnAngle()).toBeCloseTo(-10, 0);    // not 350: a 20 deg turn, not 340
    tick(10000);
    expect(drawnAngle()).toBeCloseTo(10, 6);
  });

  it('a new fix mid-slide faces the new segment, from where the marker is DRAWN', () => {
    const { update, drawnAngle } = makeEntity();
    update(41.0, -87.99);                        // east
    tick(5000);                                  // drawn halfway, ~41.0, -87.995
    update(41.01, -87.995);                      // due north of the drawn point
    expect(drawnAngle()).toBeCloseTo(0, 0);      // north, via the short way from 90
    expect(drawnAngle()).not.toBeCloseTo(360, 0);
  });

  it('a placement (position_jump) ends the travel: the reported angle at once', () => {
    const { update, drawnAngle } = makeEntity({ transition: 60 });
    update(41.0, -87.99);
    tick(10000);
    expect(drawnAngle()).toBeCloseTo(90, 1);
    update(41.5, -88.0, { position_jump: true, icon_rotation_deg: 180 });
    expect(drawnAngle()).toBeCloseTo(180, 6);
    tick(60000);
    expect(drawnAngle()).toBeCloseTo(180, 6);
  });

  it('no transition configured: placed, never faces travel', () => {
    const { update, writes } = makeEntity({ transition: 0 });
    update(41.0, -87.99);
    expect(writes).toEqual([]);
  });

  it('reduced motion: placed, never faces travel', () => {
    reducedMotion = true;
    const { update, writes } = makeEntity();
    update(41.0, -87.99);
    expect(writes).toEqual([]);
  });
});

describe('when the picture keeps the emitter angle while sliding', () => {
  it('a drawn segment under 30 m has no bearing (D3c-iii): no turn at all', () => {
    const { update, writes, drawnAngle } = makeEntity();
    update(41.0, -88.0 + 25 * M);                // 25 m east, over the 10 m move threshold
    expect(frames.size).toBe(1);                 // it does slide
    expect(drawnAngle()).toBe(0);
    tick(10000);
    expect(writes).toEqual([]);
  });

  it('a drawn segment of 31 m does face travel', () => {
    const { update, drawnAngle } = makeEntity();
    update(41.0, -88.0 + 31 * M);
    expect(drawnAngle()).toBeCloseTo(90, 0);
  });

  it("icon_rotation_basis 'held': the emitter says at rest, so the move is jitter", () => {
    const { update, writes } = makeEntity({ attrs: { icon_rotation_basis: 'held' } });
    update(41.0, -87.99);
    tick(10000);
    expect(writes).toEqual([]);
  });

  it.each(['heading', 'course', undefined])("icon_rotation_basis %p: faces travel", (basis) => {
    const { update, drawnAngle } = makeEntity({ attrs: { icon_rotation_basis: basis } });
    update(41.0, -87.99);
    expect(drawnAngle()).toBeCloseTo(90, 1);
  });

  it('icon_counter_rotated true: an upright symbol drawn for the reported angle never tips', () => {
    const { update, writes } = makeEntity({ attrs: { icon_counter_rotated: true, icon_rotation_deg: 30 } });
    update(41.0, -87.99);
    tick(5000);
    expect(writes).toEqual([]);
    tick(5000);
    expect(writes).toEqual([]);
  });

  it.each(['true', 1, 'yes', false, null, {}])('icon_counter_rotated %p is not the flag: faces travel', (v) => {
    const { update, drawnAngle } = makeEntity({ attrs: { icon_counter_rotated: v } });
    update(41.0, -87.99);
    expect(drawnAngle()).toBeCloseTo(90, 1);
  });

  it('no angle from the emitter: the card never turns a picture the emitter does not', () => {
    const { update, writes, drawnAngle } = makeEntity({ attrs: { icon_rotation_deg: undefined } });
    update(41.0, -87.99);
    tick(10000);
    expect(drawnAngle()).toBeNull();
    expect(writes).toEqual([]);
  });

  it('no rotation_attribute configured: nothing turns', () => {
    const { update, writes } = makeEntity({ rotationAttribute: null });   // undefined would take the default
    update(41.0, -87.99);
    tick(10000);
    expect(writes).toEqual([]);
  });

  it('hide() mid-slide forgets the travel: a returning marker is built at the reported angle', () => {
    const { entity, update } = makeEntity();
    update(41.0, -87.99);
    entity.hide(null);
    expect(entity._travel).toBeNull();
    expect(entity.rotationDegrees()).toBeCloseTo(0, 6);
  });
});

describe('first sight: built already facing the catch-up travel', () => {
  /**
   * An entity 6 s into a 15 s segment due east, not yet drawn.
   * @returns {Entity}
   */
  const firstSight = () => {
    const attributes = {
      friendly_name: 'X', latitude: 41.0, longitude: -87.99, icon_rotation_deg: 0,
      previous_latitude: 41.0, previous_longitude: -88.0, segment_duration_s: 15,
      observed_at: new Date(NOW - 6000).toISOString(),
    };
    const hass = { states: { 'geo_location.x': { state: '1', attributes } }, formatEntityState: () => 'S', formatEntityAttributeValue: () => 'A', hassUrl: (u) => u };
    const config = {
      id: 'geo_location.x', display: 'marker', attribute: 'marker_label', prefix: '', suffix: '', label: null,
      size: 24, color: '#757575', configuredColor: null, zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
      positionUpdateThreshold: 10, positionTransition: 10, rotationAttribute: 'icon_rotation_deg', rotationTransition: 3,
      circleConfig: {}, geoJsonConfig: {},
    };
    const map = { distance: jest.fn((a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111000), getZoom: jest.fn(() => 10) };
    return new Entity(config, hass, map, jest.fn(), jest.fn(), jest.fn(), false);
  };
  /**
   * Record the rotations written to a marker from the moment it is built.
   * @param {Entity} entity
   * @returns {{built: number[], writes: number[]}}
   */
  const watch = (entity) => {
    const seen = { built: [], writes: [] };
    const create = entity.createMapMarker.bind(entity);
    jest.spyOn(entity, 'createMapMarker').mockImplementation((at) => {
      const m = create(at);
      seen.built.push(Number(/\srotation="([^"]*)"/.exec(m.options.icon.options.html)[1]));
      return m;
    });
    const set = entity._setMarkerAttribute.bind(entity);
    jest.spyOn(entity, '_setMarkerAttribute').mockImplementation((name, value) => {
      if (name === 'rotation') seen.writes.push(Number(value));
      return set(name, value);
    });
    return seen;
  };

  it('setup(): CREATED at the travel bearing, no turn until arrival, then the heading', () => {
    const entity = firstSight();
    const seen = watch(entity);
    entity.setup();
    expect(seen.built.length).toBe(1);
    expect(seen.built[0]).toBeCloseTo(90, 1);
    expect(seen.writes).toEqual([]);             // built facing travel, not turned to it
    tick(9000);                                  // the remaining segment
    expect(seen.writes).toEqual([0]);
  });

  it('the recovery path of update(): the same', async () => {
    const entity = firstSight();
    const seen = watch(entity);
    await entity.update(null);
    expect(seen.built.length).toBe(1);
    expect(seen.built[0]).toBeCloseTo(90, 1);
    expect(seen.writes).toEqual([]);
  });
});
