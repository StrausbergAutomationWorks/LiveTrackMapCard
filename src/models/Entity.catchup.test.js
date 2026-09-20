import Entity, { catchUpFromPrevious } from './Entity.js';
import { LatLng, Marker } from 'leaflet';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

// Backlog 235: a marker seen for the first time starts from previous_*
// instead of standing still until the integration's next update.

const NOW = Date.parse('2026-09-19T23:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

// 6 s into a 15 s segment from 41.0 to 41.1: f = 0.4.
const segment = (over = {}) => ({
  previous_latitude: 41.0,
  previous_longitude: -88.0,
  observed_at: iso(6000),
  segment_duration_s: 15,
  ...over,
});

describe('catchUpFromPrevious: the fraction', () => {
  it('is the share of the segment already elapsed', () => {
    const p = catchUpFromPrevious(segment(), NOW);
    expect(p.fraction).toBeCloseTo(0.4, 9);
    expect(p.elapsedSeconds).toBeCloseTo(6, 9);
    expect(p.remainingSeconds).toBeCloseTo(9, 9);
    expect(p.previous).toEqual({ lat: 41.0, lng: -88.0 });
  });

  it('is 0 at the instant of the fix', () => {
    const p = catchUpFromPrevious(segment({ observed_at: iso(0) }), NOW);
    expect(p.fraction).toBe(0);
    expect(p.remainingSeconds).toBe(15);
  });

  it.each([15000, 15001, 60000, 86400000])('gives nothing once the segment is over (%i ms ago)', (ago) => {
    expect(catchUpFromPrevious(segment({ observed_at: iso(ago) }), NOW)).toBeNull();
  });

  it('clamps a NEGATIVE elapsed time - browser clock behind the server - to 0', () => {
    const p = catchUpFromPrevious(segment({ observed_at: iso(-5000) }), NOW);
    expect(p.fraction).toBe(0);
    expect(p.elapsedSeconds).toBe(0);
    expect(p.remainingSeconds).toBe(15);
  });

  it.each(['previous_latitude', 'previous_longitude', 'observed_at', 'segment_duration_s'])(
    'gives nothing when %s is missing', (key) => {
      const a = segment();
      delete a[key];
      expect(catchUpFromPrevious(a, NOW)).toBeNull();
    });

  it.each([
    ['previous_latitude', '41.0'], ['previous_latitude', null], ['previous_latitude', NaN],
    ['previous_latitude', Infinity], ['previous_latitude', true], ['previous_latitude', 91],
    ['previous_longitude', '-88'], ['previous_longitude', -Infinity], ['previous_longitude', -181],
    ['segment_duration_s', '15'], ['segment_duration_s', NaN], ['segment_duration_s', Infinity],
    ['segment_duration_s', 0], ['segment_duration_s', -15], ['segment_duration_s', null],
    ['observed_at', 'not a time'], ['observed_at', NOW - 6000], ['observed_at', ''], ['observed_at', null],
  ])('gives nothing when %s is %p', (key, value) => {
    expect(catchUpFromPrevious(segment({ [key]: value }), NOW)).toBeNull();
  });

  it('gives nothing for no attributes, or a clock that is not a number', () => {
    expect(catchUpFromPrevious(undefined, NOW)).toBeNull();
    expect(catchUpFromPrevious({}, NOW)).toBeNull();
    expect(catchUpFromPrevious(segment(), NaN)).toBeNull();
  });

  it('does not need previous_observed_at', () => {
    const a = segment();
    delete a.previous_observed_at;
    expect(catchUpFromPrevious(a, NOW)).not.toBeNull();
  });
});

// ---- The entity: setup() and the recovery path of update() --------------

let clock, frames, nextFrame, reducedMotion;

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
  // No real map: a marker "added to the map" is just remembered.
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
 * An entity 0.4 of the way through a 15 s segment from 41.0 to 41.1.
 * @param {object} [o]
 * @param {number|string|null} [o.positionTransition] as EntityConfig normalises it
 * @param {object} [o.attrs] the segment attributes
 * @param {number|null} [o.lat] current latitude; null for no position
 * @param {number} [o.lng] current longitude
 * @returns {{entity: Entity, attributes: object, at: Function}}
 */
function makeEntity({ positionTransition = 10, attrs = segment(), lat = 41.1, lng = -88.0 } = {}) {
  const attributes = { friendly_name: 'X', ...(lat === null ? {} : { latitude: lat, longitude: lng }), ...attrs };
  const hass = {
    states: { 'geo_location.x': { state: '1', attributes } },
    formatEntityState: () => 'S', formatEntityAttributeValue: () => 'A', hassUrl: (u) => u,
  };
  const config = {
    id: 'geo_location.x', display: 'marker', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 24, color: '#757575', configuredColor: null,
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, positionTransition, circleConfig: {}, geoJsonConfig: {},
  };
  const map = {
    distance: jest.fn((a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111000),
    getZoom: jest.fn(() => 10),
  };
  const entity = new Entity(config, hass, map, jest.fn(), jest.fn(), jest.fn(), false);
  const at = () => entity.marker.getLatLng();
  return { entity, attributes, at };
}

describe('first sight, with previous_* and position_transition', () => {
  it('starts at the point f of the way along, and ends exactly on current', () => {
    const { entity, at } = makeEntity();
    entity.setup();
    expect(at().lat).toBeCloseTo(41.04, 9);           // 0.4 of 41.0 -> 41.1
    expect(requestAnimationFrame).toHaveBeenCalled();  // moving from the first frame
    tick(4500);
    expect(at().lat).toBeCloseTo(41.07, 9);           // half of the remaining 9 s
    tick(4500);
    expect(at()).toEqual(new LatLng(41.1, -88.0));
    expect(frames.size).toBe(0);
  });

  it('slides over the REMAINING segment, not the configured position_transition', () => {
    const { entity, at } = makeEntity({ positionTransition: 60 });
    entity.setup();
    tick(9000);
    expect(at()).toEqual(new LatLng(41.1, -88.0));
  });

  it('works inside a cluster group (cluster_markers: true)', () => {
    const cluster = { addLayer: jest.fn(), hasLayer: jest.fn(() => true) };
    const { entity, at } = makeEntity();
    entity.setup(cluster);
    expect(cluster.addLayer).toHaveBeenCalledWith(entity.marker);
    expect(Marker.prototype.addTo).not.toHaveBeenCalled();
    expect(at().lat).toBeCloseTo(41.04, 9);
    tick(9000);
    expect(at()).toEqual(new LatLng(41.1, -88.0));
  });

  it('works added straight to the map (cluster_markers: false)', () => {
    const { entity, at } = makeEntity();
    entity.setup(null);
    expect(Marker.prototype.addTo).toHaveBeenCalled();
    expect(at().lat).toBeCloseTo(41.04, 9);
  });

  it('starts at previous, and takes the whole segment, when the browser clock is behind', () => {
    const { entity, at } = makeEntity({ attrs: segment({ observed_at: iso(-5000) }) });
    entity.setup();
    expect(at().lat).toBeCloseTo(41.0, 9);
    tick(7500);
    expect(at().lat).toBeCloseTo(41.05, 9);
    tick(7500);
    expect(at().lat).toBeCloseTo(41.1, 9);
  });

  it("with 'auto', times the NEXT slide over a real segment, not since the page opened", () => {
    const { entity, attributes, at } = makeEntity({ positionTransition: 'auto' });
    entity.setup();
    tick(9000);                                       // catch-up done: the next fix is due now
    attributes.latitude = 41.2;
    entity.updateMarkerPosition();
    tick(7500);
    expect(at().lat).toBeCloseTo(41.15, 9);           // half of a 15 s slide
  });

  it('a new position mid-catch-up carries on from where the marker is drawn', () => {
    const { entity, attributes, at } = makeEntity();
    entity.setup();
    tick(4500);                                       // drawn at 41.07
    attributes.latitude = 41.3;
    entity.updateMarkerPosition();
    tick(0);
    expect(at().lat).toBeCloseTo(41.07, 9);
  });

  it('remove() stops it', () => {
    const { entity } = makeEntity();
    entity.circle.remove = jest.fn(); entity.geoJson.remove = jest.fn(); entity.historyManager.remove = jest.fn();
    entity.setup();
    entity.remove(null);
    expect(frames.size).toBe(0);
  });
});

describe('first sight WITHOUT a usable segment: placed at current, never moved', () => {
  const placedAndStill = ({ entity, at }) => {
    entity.setup();
    expect(at()).toEqual(new LatLng(41.1, -88.0));
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    tick(20000);
    expect(at()).toEqual(new LatLng(41.1, -88.0));
  };

  it('an entity with no previous_* at all', () => {
    placedAndStill(makeEntity({ attrs: {} }));
  });

  it.each([null, 0])('position_transition not configured (%p)', (pt) => {
    placedAndStill(makeEntity({ positionTransition: pt }));
  });

  it('the segment is already over (f >= 1)', () => {
    placedAndStill(makeEntity({ attrs: segment({ observed_at: iso(20000) }) }));
  });

  it('segment_duration_s is zero', () => {
    placedAndStill(makeEntity({ attrs: segment({ segment_duration_s: 0 }) }));
  });

  it('segment_duration_s is absent', () => {
    const attrs = segment();
    delete attrs.segment_duration_s;
    placedAndStill(makeEntity({ attrs }));
  });

  it('the user asks for reduced motion', () => {
    reducedMotion = true;
    placedAndStill(makeEntity());
  });

  it('the start is within positionUpdateThreshold of current', () => {
    placedAndStill(makeEntity({ attrs: segment({ previous_latitude: 41.09999 }) }));
  });
});

describe('the recovery path in update()', () => {
  it('a position arriving after setup() had none gets the same catch-up', async () => {
    const { entity, attributes, at } = makeEntity({ lat: null, attrs: {} });
    entity.setup();
    expect(entity.marker).toBeUndefined();
    Object.assign(attributes, { latitude: 41.1, longitude: -88.0 }, segment());
    await entity.update();
    expect(at().lat).toBeCloseTo(41.04, 9);
    tick(9000);
    expect(at()).toEqual(new LatLng(41.1, -88.0));
  });

  it('and without previous_* it is placed and not moved', async () => {
    const { entity, attributes, at } = makeEntity({ lat: null, attrs: {} });
    entity.setup();
    Object.assign(attributes, { latitude: 41.1, longitude: -88.0 });
    await entity.update();
    expect(at()).toEqual(new LatLng(41.1, -88.0));
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
