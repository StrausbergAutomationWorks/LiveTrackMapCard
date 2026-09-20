import Entity from './Entity.js';
import { LatLng } from 'leaflet';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

// position_transition: slide a marker to its new position instead of jumping.
// The clock and the animation frames are driven by hand.
let clock, frames, nextFrame, reducedMotion;

beforeEach(() => {
  clock = 1000;
  frames = new Map();
  nextFrame = 1;
  reducedMotion = false;
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  globalThis.requestAnimationFrame = jest.fn((cb) => { const id = nextFrame++; frames.set(id, cb); return id; });
  globalThis.cancelAnimationFrame = jest.fn((id) => frames.delete(id));
  window.matchMedia = jest.fn((q) => ({ matches: reducedMotion && q.includes('reduce'), media: q }));
});
afterEach(() => { jest.restoreAllMocks(); delete window.matchMedia; });

// Run whatever frames are pending at time t (ms after the current clock).
function tick(ms) {
  clock += ms;
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, cb] of pending) cb(clock);
}

function makeEntity(positionTransition) {
  const attrs = { friendly_name: 'X', latitude: 41.0, longitude: -88.0 };
  const hass = { states: { 'geo_location.x': { state: '1', attributes: attrs } }, formatEntityState: () => 'S', hassUrl: (u) => u };
  const config = { id: 'geo_location.x', display: 'marker', positionUpdateThreshold: 10, positionTransition, circleConfig: {}, geoJsonConfig: {} };
  const map = { distance: jest.fn((a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111000) };
  const entity = new Entity(config, hass, map, jest.fn(), jest.fn(), jest.fn(), false);
  let drawn = new LatLng(41.0, -88.0);
  const marker = {
    setLatLng: jest.fn((ll) => { drawn = Array.isArray(ll) ? new LatLng(ll[0], ll[1]) : ll; }),
    getLatLng: jest.fn(() => drawn),
    remove: jest.fn(),
  };
  entity.marker = marker;
  entity._lastSetLatLng = new LatLng(41.0, -88.0);
  entity.circle.remove = jest.fn(); entity.geoJson.remove = jest.fn(); entity.historyManager.remove = jest.fn();
  const moveTo = (lat, lng) => { attrs.latitude = lat; attrs.longitude = lng; entity.updateMarkerPosition(); };
  const at = () => marker.getLatLng();
  return { entity, marker, moveTo, at };
}

describe('position_transition off', () => {
  it.each([0, undefined])('jumps straight to the new position (%s)', (cfg) => {
    const { marker, moveTo, at } = makeEntity(cfg);
    moveTo(41.1, -88.1);
    expect(marker.setLatLng).toHaveBeenCalledTimes(1);
    expect(at().lat).toBeCloseTo(41.1, 9);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});

describe('position_transition in seconds', () => {
  it('slides over the configured time and ends exactly on the target', () => {
    const { moveTo, at } = makeEntity(10);
    moveTo(41.1, -88.1);
    expect(at().lat).toBeCloseTo(41.0, 9);          // not jumped
    tick(5000);
    expect(at().lat).toBeCloseTo(41.05, 9);          // halfway
    expect(at().lng).toBeCloseTo(-88.05, 9);
    tick(5000);
    expect(at()).toEqual(new LatLng(41.1, -88.1));   // exactly the target
    expect(frames.size).toBe(0);                     // and stops
  });

  it('a new position mid-slide starts from where the marker is DRAWN', () => {
    const { moveTo, at } = makeEntity(10);
    moveTo(41.1, -88.0);
    tick(5000);                                       // drawn at 41.05
    moveTo(41.3, -88.0);
    expect(cancelAnimationFrame).toHaveBeenCalled();
    tick(0);
    expect(at().lat).toBeCloseTo(41.05, 9);          // no jump back to 41.0 or ahead to 41.1
    tick(5000);
    expect(at().lat).toBeCloseTo(41.175, 9);         // halfway from 41.05 to 41.3
  });

  it('ignores a change inside the threshold', () => {
    const { marker, moveTo } = makeEntity(10);
    moveTo(41.00001, -88.0);
    expect(marker.setLatLng).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('jumps when there is no previous position to slide from', () => {
    const { entity, marker, moveTo } = makeEntity(10);
    entity._lastSetLatLng = null;
    moveTo(41.1, -88.1);
    expect(marker.setLatLng).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});

describe("position_transition 'auto'", () => {
  it('jumps on the first change, then slides over the measured interval', () => {
    const { moveTo, at } = makeEntity('auto');
    moveTo(41.1, -88.0);
    expect(at().lat).toBeCloseTo(41.1, 9);           // nothing to measure yet
    clock += 20000;
    moveTo(41.2, -88.0);
    tick(10000);
    expect(at().lat).toBeCloseTo(41.15, 9);          // half of a 20 s slide
    tick(10000);
    expect(at().lat).toBeCloseTo(41.2, 9);
  });

  it('caps a slide at 30 seconds', () => {
    const { moveTo, at } = makeEntity('auto');
    moveTo(41.1, -88.0);
    clock += 120000;
    moveTo(41.2, -88.0);
    tick(30000);
    expect(at().lat).toBeCloseTo(41.2, 9);
  });

  it('jumps when updates arrive under half a second apart', () => {
    const { moveTo } = makeEntity('auto');
    moveTo(41.1, -88.0);
    clock += 300;
    moveTo(41.2, -88.0);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});

describe('position_transition and the rest of the lifecycle', () => {
  it('remove() stops a slide in flight', () => {
    const { entity, marker, moveTo } = makeEntity(10);
    moveTo(41.1, -88.1);
    const pending = [...frames.values()];
    entity.remove(null);
    expect(frames.size).toBe(0);
    const calls = marker.setLatLng.mock.calls.length;
    expect(() => pending.forEach((cb) => cb(clock + 1000))).not.toThrow();
    expect(marker.setLatLng.mock.calls.length).toBe(calls);
  });

  it('does not animate when the user asks for reduced motion', () => {
    reducedMotion = true;
    const { marker, moveTo, at } = makeEntity(10);
    moveTo(41.1, -88.1);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(marker.setLatLng).toHaveBeenCalledTimes(1);
    expect(at().lat).toBeCloseTo(41.1, 9);
  });

  it("'auto' still measures the interval under reduced motion", () => {
    reducedMotion = true;
    const { moveTo } = makeEntity('auto');
    moveTo(41.1, -88.0);
    clock += 20000;
    reducedMotion = false;
    moveTo(41.2, -88.0);
    expect(requestAnimationFrame).toHaveBeenCalled();
  });
});

// position_jump: the emitter says this fix did not arrive by travelling, so
// the marker is PLACED even with position_transition on. Brightline's ~313 km
// terminal snap, which used to slide across Florida for a minute (Lee,
// 2026-09-20).
describe('position_jump', () => {
  const setJump = (entity, value) => {
    entity.hass.states['geo_location.x'].attributes.position_jump = value;
  };
  const clearJump = (entity) => {
    delete entity.hass.states['geo_location.x'].attributes.position_jump;
  };

  it('places the marker instead of sliding, and starts no animation frame', () => {
    const { entity, marker, moveTo, at } = makeEntity(60);
    setJump(entity, true);
    moveTo(28.4, -81.3);                       // Orlando-ish: a very long way
    expect(at().lat).toBeCloseTo(28.4, 6);
    expect(at().lng).toBeCloseTo(-81.3, 6);
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
    expect(marker.setLatLng).toHaveBeenCalledTimes(1);
  });

  it('does not disable sliding for the NEXT update once the flag is gone', () => {
    const { entity, moveTo, at } = makeEntity(60);
    setJump(entity, true);
    moveTo(28.4, -81.3);
    clearJump(entity);
    moveTo(28.5, -81.3);
    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
    tick(30000);
    expect(at().lat).toBeGreaterThan(28.4);
    expect(at().lat).toBeLessThan(28.5);       // mid-slide, not placed
  });

  it('cancels a slide already in flight rather than letting it finish', () => {
    const { entity, moveTo, at } = makeEntity(60);
    moveTo(41.5, -88.0);
    tick(30000);
    const midway = at().lat;
    expect(midway).toBeGreaterThan(41.0);
    expect(midway).toBeLessThan(41.5);
    setJump(entity, true);
    moveTo(28.4, -81.3);
    expect(at().lat).toBeCloseTo(28.4, 6);
    tick(60000);
    expect(at().lat).toBeCloseTo(28.4, 6);     // no stale frame drags it back
  });

  it.each([false, 'true', 1, 'yes', null, undefined, {}])(
    'ignores %p: only a JSON true is the flag', (v) => {
      const { entity, moveTo } = makeEntity(60);
      setJump(entity, v);
      moveTo(41.5, -88.0);
      expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
    });

  it('changes nothing when no transition is configured', () => {
    const { entity, moveTo, at } = makeEntity(0);
    setJump(entity, true);
    moveTo(28.4, -81.3);
    expect(at().lat).toBeCloseTo(28.4, 6);
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('still respects the movement threshold: a jump flag does not force a move', () => {
    const { entity, marker, moveTo } = makeEntity(60);
    setJump(entity, true);
    marker.setLatLng.mockClear();
    moveTo(41.00001, -88.00001);               // ~1.5 m, under the 10 m threshold
    expect(marker.setLatLng).not.toHaveBeenCalled();
  });
});
