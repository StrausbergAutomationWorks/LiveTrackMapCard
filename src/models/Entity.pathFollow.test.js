
import Entity from './Entity.js';
import { LatLng, Marker } from 'leaflet';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

// Item 270 part 2: a water marker slides along the route the card's
// path-follower plans, facing each leg, and ends where the follower draws the
// fix (in the water). The follower itself is tested in services/path; here it
// is a stub, so these tests are about the slide.

let clock, frames, nextFrame;
beforeEach(() => {
  clock = 1000;
  frames = new Map();
  nextFrame = 1;
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  globalThis.requestAnimationFrame = jest.fn((cb) => { const id = nextFrame++; frames.set(id, cb); return id; });
  globalThis.cancelAnimationFrame = jest.fn((id) => frames.delete(id));
  window.matchMedia = jest.fn((q) => ({ matches: false, media: q }));
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

const M = 1 / 111000;   // one metre of latitude in the fake map.distance
const ll = (lat, lng) => new LatLng(lat, lng);

/**
 * A water entity at 41.0, -88.0 with a hand-driven marker; `writes` records
 * every rotation written to it.
 * @param {object} [o]
 * @param {object} [o.follower] the stub path-follower on the map, or none
 * @param {object} [o.attrs] attributes over the defaults
 * @returns {object}
 */
function makeEntity({ follower, attrs = {} } = {}) {
  const attributes = { friendly_name: 'X', latitude: 41.0, longitude: -88.0, icon_rotation_deg: 0, map_layer: 'water', ...attrs };
  const hass = { states: { 'geo_location.x': { state: '1', attributes } }, formatEntityState: () => 'S', hassUrl: (u) => u };
  const config = {
    id: 'geo_location.x', display: 'marker', positionUpdateThreshold: 10,
    positionTransition: 10, rotationAttribute: 'icon_rotation_deg', rotationTransition: 3,
    circleConfig: {}, geoJsonConfig: {},
  };
  // Plane geometry: 1 deg of lat or lng = 111 km, so bearings are exact.
  const map = { distance: jest.fn((a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111000) };
  if (follower) map.ltmcPathFollower = follower;
  const entity = new Entity(config, hass, map, jest.fn(), jest.fn(), jest.fn(), false);
  let drawn = ll(41.0, -88.0);
  entity.marker = {
    setLatLng: jest.fn((p) => { drawn = Array.isArray(p) ? ll(p[0], p[1]) : p; }),
    getLatLng: jest.fn(() => drawn),
    remove: jest.fn(),
  };
  entity._lastSetLatLng = ll(41.0, -88.0);
  entity.circle.remove = jest.fn(); entity.geoJson.remove = jest.fn(); entity.historyManager.remove = jest.fn();
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
  return { entity, attributes, update, writes, drawn: () => drawn, map };
}

// East 400 m, then north 400 m, ending 20 m off the fix (drawn in the water).
const CORNER = { lat: 41.0, lng: -88.0 + 400 * M };
const SNAPPED = { lat: 41.0 + 400 * M, lng: -88.0 + 420 * M };
const FIX = [41.0 + 400 * M, -88.0 + 400 * M];

/**
 * A stub path-follower that routes east to the corner, then north.
 * @param {object} [over] methods to replace
 * @returns {object}
 */
function follower(over = {}) {
  return {
    plan: jest.fn((from) => [{ lat: from.lat, lng: from.lng }, CORNER, SNAPPED]),
    place: jest.fn((to) => to),
    want: jest.fn(),
    applies: jest.fn(() => true),
    ...over,
  };
}
const near = (p, q, metres = 1) => Math.hypot(p.lat - q.lat, p.lng - q.lng) * 111000 <= metres;

describe('when the follower finds no way round over water', () => {
  it('the marker is placed at its fix at once, never slid across land', () => {
    const f = follower({ plan: jest.fn(() => 'place') });
    const { update, drawn } = makeEntity({ follower: f });
    update(...FIX);
    expect(f.plan).toHaveBeenCalledTimes(1);
    expect(near(drawn(), { lat: FIX[0], lng: FIX[1] })).toBe(true);
    expect(frames.size).toBe(0);
  });
});

describe('sliding along a planned route', () => {
  it('passes through the corner and ends where the follower draws the fix', () => {
    const f = follower();
    const { entity, update, drawn } = makeEntity({ follower: f });
    update(...FIX);
    expect(f.plan).toHaveBeenCalledTimes(1);
    tick(1);           // the slide starts
    tick(5000);        // half the time: half the 820 m, just past the corner
    expect(Math.abs(drawn().lat - 41.0) * 111000).toBeLessThan(25);
    expect((drawn().lng + 88.0) * 111000).toBeGreaterThan(380);
    tick(5000);
    expect(near(drawn(), SNAPPED)).toBe(true);
    // The fix is still the fix: the next slide is measured from it.
    expect(entity._lastSetLatLng.lat).toBe(FIX[0]);
    expect(entity._lastSetLatLng.lng).toBe(FIX[1]);
  });

  it('faces each leg in turn - east, then north - and the heading on arrival', () => {
    const { update, writes } = makeEntity({ follower: follower() });
    update(...FIX, { icon_rotation_deg: 200 });
    tick(1);
    for (let i = 0; i < 20; i++) tick(500);
    // Angles are written continuously (the short way round), so compare mod 360.
    const deg = (w) => ((w % 360) + 360) % 360;
    expect(deg(writes[writes.length - 3])).toBeCloseTo(90, 0);
    // Leg 2 runs 400 m north and 20 m east: about 3 degrees.
    expect(deg(writes[writes.length - 2])).toBeGreaterThan(1);
    expect(deg(writes[writes.length - 2])).toBeLessThan(5);
    expect(deg(writes[writes.length - 1])).toBeCloseTo(200, 0);
  });

  it('writes the rotation once per leg, never per frame', () => {
    const { update, writes } = makeEntity({ follower: follower() });
    update(...FIX, { icon_rotation_deg: 200 });
    const before = writes.length;
    tick(1);
    for (let i = 0; i < 600; i++) tick(10000 / 600);
    // After the start: one turn at the corner, one on arrival.
    expect(writes.length - before).toBe(2);
  });

  it('a leg under 30 m keeps the facing it had', () => {
    const jog = { lat: 41.0 + 10 * M, lng: -88.0 + 400 * M };   // 10 m north, then on east
    const f = follower({ plan: jest.fn((from) => [{ lat: from.lat, lng: from.lng }, CORNER, jog, { lat: jog.lat, lng: -88.0 + 800 * M }]) });
    const { update, writes } = makeEntity({ follower: f });
    const before = writes.length;
    update(41.0 + 10 * M, -88.0 + 800 * M, { icon_rotation_deg: 200 });
    tick(1);
    for (let i = 0; i < 40; i++) tick(250);
    // Skip the update's own heading write; drop the arrival.
    const turns = writes.slice(before + 1, -1).map((w) => ((w % 360) + 360) % 360);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every((w) => Math.abs(w - 90) < 1)).toBe(true);
  });

  it('a new route whose first leg is short keeps the facing the interrupted slide had', () => {
    const east = { lat: 41.0, lng: -88.0 + 800 * M };
    let call = 0;
    const f = follower({
      plan: jest.fn((from) => {
        call++;
        if (call === 1) return [{ lat: from.lat, lng: from.lng }, east];
        // Second plan, mid-slide: 5 m north first, then on east.
        const jog = { lat: from.lat + 5 * M, lng: from.lng };
        return [{ lat: from.lat, lng: from.lng }, jog, { lat: jog.lat, lng: -88.0 + 900 * M }];
      }),
    });
    const { update, writes } = makeEntity({ follower: f });
    update(41.0, -88.0 + 800 * M, { icon_rotation_deg: 200 });
    tick(1); tick(3000);
    const before = writes.length;
    update(41.0 + 5 * M, -88.0 + 900 * M, { icon_rotation_deg: 200 });
    tick(1); tick(500);
    // Nothing turns it off east: no write of the heading mid-slide.
    const after = writes.slice(before).map((w) => ((w % 360) + 360) % 360);
    expect(after.every((w) => Math.abs(w - 90) < 1)).toBe(true);
  });

  it('a route that does not start where the marker is drawn is joined from the marker', () => {
    const start = { lat: 41.0 + 20 * M, lng: -88.0 };   // the follower snapped the start 20 m north
    const f = follower({ plan: jest.fn(() => [start, CORNER, SNAPPED]) });
    const { update, drawn } = makeEntity({ follower: f });
    update(...FIX);
    tick(1);
    tick(10);
    // Still near the drawn start, not teleported to the snapped one.
    expect(near(drawn(), { lat: 41.0, lng: -88.0 }, 5)).toBe(true);
  });

  it('no plan (null): a straight slide to the fix, as before', () => {
    const { update, drawn } = makeEntity({ follower: follower({ plan: jest.fn(() => null) }) });
    update(...FIX);
    tick(1);
    tick(5000);
    expect(near(drawn(), { lat: 41.0 + 200 * M, lng: -88.0 + 200 * M }, 2)).toBe(true);
    tick(5000);
    expect(near(drawn(), { lat: FIX[0], lng: FIX[1] })).toBe(true);
  });

  it('a follower that throws is a straight slide, not a broken map', () => {
    const { update, drawn } = makeEntity({ follower: follower({ plan: jest.fn(() => { throw new Error('boom'); }) }) });
    update(...FIX);
    tick(1);
    tick(10001);
    expect(near(drawn(), { lat: FIX[0], lng: FIX[1] })).toBe(true);
  });

  it('asks the follower for the tiles round every new fix', () => {
    const f = follower();
    const { update } = makeEntity({ follower: f });
    update(...FIX);
    expect(f.want).toHaveBeenCalledWith(expect.objectContaining({ lat: FIX[0], lng: FIX[1] }), expect.objectContaining({ map_layer: 'water' }));
  });

  it('a jump is placed where the follower draws the fix', () => {
    const f = follower({ place: jest.fn(() => SNAPPED) });
    const { update, drawn } = makeEntity({ follower: f });
    update(...FIX, { position_jump: true });
    expect(near(drawn(), SNAPPED)).toBe(true);
  });
});

describe('refreshDrawnPosition', () => {
  it('moves a standing water marker to where the follower draws it now', () => {
    const f = follower({ place: jest.fn(() => SNAPPED) });
    const { entity, drawn } = makeEntity({ follower: f });
    entity.refreshDrawnPosition();
    expect(near(drawn(), SNAPPED)).toBe(true);
  });

  it('leaves a marker mid-slide alone', () => {
    const f = follower();
    const { entity, update, drawn } = makeEntity({ follower: f });
    update(...FIX);
    tick(1); tick(3000);
    const mid = drawn();
    f.place = jest.fn(() => ({ lat: 0, lng: 0 }));
    entity.refreshDrawnPosition();
    expect(drawn()).toBe(mid);
  });

  it('never touches anything that is not on the water layer', () => {
    const f = follower({ place: jest.fn(() => SNAPPED) });
    const { entity, drawn } = makeEntity({ follower: f, attrs: { map_layer: 'rail' } });
    entity.refreshDrawnPosition();
    expect(near(drawn(), { lat: 41.0, lng: -88.0 })).toBe(true);
  });

  it('with no follower on the map it does nothing', () => {
    const { entity, drawn } = makeEntity();
    entity.refreshDrawnPosition();
    expect(near(drawn(), { lat: 41.0, lng: -88.0 })).toBe(true);
  });
});
