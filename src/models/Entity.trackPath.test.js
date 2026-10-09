import Entity from './Entity.js';
import { LatLng, Marker } from 'leaflet';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

// Lee 2026-10-09 17:44: "Trains are off the track by a long way and the
// headings are changed to the heading they will have when they are done
// transitioning." The marker slides along the emitter's track_path, and its
// ARROW points along the leg it is on, then at the emitter's angle on arrival.

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

/**
 * A train at 0,0 with an arrow from icon_rotation_deg, sliding over 10 s.
 * @param {object} [attrs]
 * @returns {{entity: Entity, attributes: object, drawn: Function, arrows: number[], update: Function}}
 */
function makeEntity(attrs = {}) {
  const attributes = { friendly_name: 'X', latitude: 0, longitude: 0, icon_rotation_deg: 0, ...attrs };
  const hass = { states: { 'geo_location.x': { state: '1', attributes } }, formatEntityState: () => 'S', hassUrl: (u) => u };
  const config = {
    id: 'geo_location.x', display: 'marker', positionUpdateThreshold: 10,
    positionTransition: 10, rotationAttribute: null, arrowAttribute: 'icon_rotation_deg',
    rotationTransition: 3, circleConfig: {}, geoJsonConfig: {},
  };
  const map = { distance: jest.fn((a, b) => Math.hypot(a.lat - b.lat, (a.lng - b.lng)) * 111195) };
  const entity = new Entity(config, hass, map, jest.fn(), jest.fn(), jest.fn(), false);
  let at = new LatLng(0, 0);
  entity.marker = {
    setLatLng: jest.fn((ll) => { at = Array.isArray(ll) ? new LatLng(ll[0], ll[1]) : ll; }),
    getLatLng: jest.fn(() => at),
    remove: jest.fn(),
  };
  entity._lastSetLatLng = new LatLng(0, 0);
  entity.circle.remove = jest.fn(); entity.geoJson.remove = jest.fn(); entity.historyManager.remove = jest.fn();
  entity._currentArrow = entity.arrowDegrees();
  const arrows = [];
  jest.spyOn(entity, '_setMarkerAttribute').mockImplementation((name, value) => {
    if (name === 'arrow') arrows.push(value === '' ? null : Number(value));
  });
  const update = (lat, lng, over = {}) => {
    Object.assign(attributes, { latitude: lat, longitude: lng }, over);
    entity.refreshMarkerArrow();
    entity.updateMarkerPosition();
  };
  return { entity, attributes, drawn: () => entity.marker.getLatLng(), arrows, update };
}

describe('sliding along track_path', () => {
  it('goes round the bend instead of across it', () => {
    const { update, drawn } = makeEntity();
    // East 0.01 deg, then north 0.01 deg: the corner is at 0, 0.01.
    update(0.01, 0.01, { icon_rotation_deg: 0, track_path: [[0, 0], [0, 0.01], [0.01, 0.01]] });
    tick(5000);    // half way: at the corner, not on the diagonal
    expect(drawn().lat).toBeCloseTo(0, 4);
    expect(drawn().lng).toBeCloseTo(0.01, 4);
    tick(6000);
    expect(drawn().lat).toBeCloseTo(0.01, 6);
    expect(drawn().lng).toBeCloseTo(0.01, 6);
  });

  it('without a path, the straight slide as before', () => {
    const { update, drawn } = makeEntity();
    update(0.01, 0.01, { icon_rotation_deg: 0 });
    tick(5000);
    expect(drawn().lat).toBeCloseTo(0.005, 4);
    expect(drawn().lng).toBeCloseTo(0.005, 4);
  });

  it('a path that does not end at the new position is ignored', () => {
    const { update, drawn } = makeEntity();
    update(0.01, 0.01, { track_path: [[0, 0], [0, 0.01], [0.02, 0.01]] });
    tick(5000);
    expect(drawn().lat).toBeCloseTo(0.005, 4);
  });
});

describe('the arrow while sliding', () => {
  it('points along each leg, then at the emitter angle on arrival', () => {
    const { update, arrows } = makeEntity();
    update(0.01, 0.01, { icon_rotation_deg: 0, track_path: [[0, 0], [0, 0.01], [0.01, 0.01]] });
    tick(16);
    expect(arrows.at(-1) % 360).toBeCloseTo(90, 0);       // east, the first leg
    tick(6000);                                           // round the corner
    expect(((arrows.at(-1) % 360) + 360) % 360).toBeCloseTo(0, 0);  // north, the second leg
    tick(6000);                                           // arrived
    expect(((arrows.at(-1) % 360) + 360) % 360).toBeCloseTo(0, 0);  // the emitter's 0
  });

  it('on a straight slide it points along the slide, then turns to the emitter angle', () => {
    const { update, arrows } = makeEntity();
    // North-east; a latitude of exactly 0 reads as no position in the card.
    update(0.01, 0.01, { icon_rotation_deg: 200 });
    tick(16);
    expect(((arrows.at(-1) % 360) + 360) % 360).toBeCloseTo(45, 0);
    tick(11000);
    expect(((arrows.at(-1) % 360) + 360) % 360).toBeCloseTo(200, 0);
  });
});
