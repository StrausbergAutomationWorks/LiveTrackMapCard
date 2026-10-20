import Entity, { SEGMENT_FROM_M, SEGMENT_SLIDE_MAX_S } from './Entity.js';
import { LatLng, Marker } from 'leaflet';
import { pathAt } from '../util/TrackPath.js';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

// Lee 2026-10-20 02:24, on Madrid: trains "apparently achieve super sonic
// speeds". A rail move along its line slides over the emitter's own segment;
// a fix arriving mid-slide carries on along what is left of it; a first
// sight catches up along the line (Entity.js, SEGMENT_FROM_M).

const M = 111195;               // metres per degree, as the harness's map.distance
// The card reads a latitude of exactly 0 as no position: the harness works O north of
// the cases' own coordinates, and drawn() reports them back without it.
const O = 0.01;
const WALL0 = Date.parse('2026-10-20T09:00:00Z');
let clock, wall, frames, nextFrame, reduced;
beforeEach(() => {
  clock = 1000; wall = WALL0;
  frames = new Map(); nextFrame = 1; reduced = false;
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  jest.spyOn(Date, 'now').mockImplementation(() => wall);
  globalThis.requestAnimationFrame = jest.fn((cb) => { const id = nextFrame++; frames.set(id, cb); return id; });
  globalThis.cancelAnimationFrame = jest.fn((id) => frames.delete(id));
  window.matchMedia = jest.fn((q) => ({ matches: reduced, media: q }));
  jest.spyOn(Marker.prototype, 'addTo').mockImplementation(function () { return this; });
});
afterEach(() => { jest.restoreAllMocks(); delete window.matchMedia; });

/**
 * Advance both clocks and run the frames that were pending.
 * @param {number} ms
 */
function tick(ms) {
  clock += ms; wall += ms;
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, cb] of pending) cb(clock);
}
const iso = (ms) => new Date(ms).toISOString();

/**
 * A train at 0,0 on the rail layer, position_transition 'auto' unless given.
 * @param {object} [opts]
 * @param {string|number} [opts.transition] position_transition
 * @param {string|null} [opts.layer] map_layer, null for none
 * @param {object} [opts.attrs] more attributes
 * @returns {{entity: Entity, attributes: object, drawn: Function, fix: Function}}
 */
function makeEntity({ transition = 'auto', layer = 'rail', attrs = {} } = {}) {
  const attributes = { friendly_name: 'X', latitude: O, longitude: 0, icon_rotation_deg: 90, ...attrs };
  if (layer !== null) attributes.map_layer = layer;
  const hass = { states: { 'geo_location.x': { state: '1', attributes } }, formatEntityState: () => 'S', hassUrl: (u) => u };
  const config = {
    id: 'geo_location.x', display: 'marker', positionUpdateThreshold: 10,
    positionTransition: transition, rotationAttribute: null, arrowAttribute: 'icon_rotation_deg',
    rotationTransition: 3, circleConfig: {}, geoJsonConfig: {},
  };
  const map = { distance: jest.fn((a, b) => Math.hypot(a.lat - b.lat, (a.lng - b.lng)) * M) };
  const entity = new Entity(config, hass, map, jest.fn(), jest.fn(), jest.fn(), false);
  let at = new LatLng(O, 0);
  entity.marker = {
    setLatLng: jest.fn((ll) => { at = Array.isArray(ll) ? new LatLng(ll[0], ll[1]) : ll; }),
    getLatLng: jest.fn(() => at),
    remove: jest.fn(),
  };
  entity._lastSetLatLng = new LatLng(O, 0);
  entity.circle.remove = jest.fn(); entity.geoJson.remove = jest.fn(); entity.historyManager.remove = jest.fn();
  entity._currentArrow = entity.arrowDegrees();
  jest.spyOn(entity, '_setMarkerAttribute').mockImplementation(() => {});
  /**
   * A new fix, its segment from `prev` over `seg` s, observed `ago` s before now. With
   * `path: true` its track_path is the straight line prev -> fix.
   * @param {number} lat
   * @param {number} lng
   * @param {object} [opts]
   * @param {number[]|null} [opts.prev] previous_* as [lat, lng]
   * @param {number|null} [opts.seg] segment_duration_s
   * @param {number} [opts.ago] seconds since observed_at
   * @param {boolean} [opts.path] publish track_path prev -> fix
   * @param {object} [opts.over] more attributes
   */
  const fix = (lat, lng, { prev = null, seg = null, ago = 3, path = false, over = {} } = {}) => {
    const a = { latitude: lat + O, longitude: lng, observed_at: iso(wall - ago * 1000), ...over };
    if (path && prev) a.track_path = [prev, [lat, lng]];
    if (Array.isArray(a.track_path)) a.track_path = a.track_path.map(([y, x]) => [y + O, x]);
    if (prev) Object.assign(a, { previous_latitude: prev[0] + O, previous_longitude: prev[1] });
    if (seg !== null) a.segment_duration_s = seg;
    for (const k of ['previous_latitude', 'previous_longitude', 'segment_duration_s', 'track_path', 'position_jump']) {
      if (!(k in a)) delete attributes[k];
    }
    Object.assign(attributes, a);
    entity.updateMarkerPosition();
  };
  const drawn = () => { const p = entity.marker.getLatLng(); return { lat: p.lat - O, lng: p.lng }; };
  return { entity, attributes, drawn, fix };
}

/**
 * Metres from p to the nearest point of the polyline pts.
 * @param {{lat: number, lng: number}} p
 * @param {number[][]} pts [lat, lng] pairs
 * @returns {number}
 */
function offLine(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[1] - a[1], dy = b[0] - a[0], l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.lng - a[1]) * dx + (p.lat - a[0]) * dy) / l2));
    best = Math.min(best, Math.hypot(p.lat - (a[0] + dy * t), p.lng - (a[1] + dx * t)) * M);
  }
  return best;
}

describe('a rail move along its line slides over its own segment', () => {
  it('the first move after the page opens slides instead of being placed', () => {
    const { fix, drawn } = makeEntity();
    fix(0, 0.011, { prev: [0, 0], seg: 42, path: true });
    tick(16);
    expect(drawn().lng).toBeLessThan(0.0011);
    tick(21000 - 16);                                   // half of the 42 s
    expect(drawn().lng).toBeCloseTo(0.0055, 3);
    tick(21000 + 100);
    expect(drawn().lng).toBeCloseTo(0.011, 6);
  });

  it('a long catch-up is drawn at the speed it averaged, not in 30 s', () => {
    const { fix, drawn } = makeEntity();
    fix(0, 0.01, { prev: [0, 0], seg: 10, ago: 0, path: true });
    tick(11000);
    // 4 km in 120 s: after 30 s a quarter of the way, not there.
    fix(0, 0.01 + 4000 / M, { prev: [0, 0.01], seg: 120, ago: 0, path: true });
    tick(16);
    tick(30000);
    expect((drawn().lng - 0.01) * M).toBeGreaterThan(900);
    expect((drawn().lng - 0.01) * M).toBeLessThan(1100);
    tick(90000 + 100);
    expect((drawn().lng - 0.01) * M).toBeCloseTo(4000, 0);
  });

  it('the whole segment, however late the fix arrived', () => {
    // 21 s late on a 22 s segment: still 22 s, not the 1 s left of it.
    const { fix, drawn } = makeEntity();
    fix(0, 0.011, { prev: [0, 0], seg: 22, ago: 21, path: true });
    tick(16); tick(11000 - 16);
    expect(drawn().lng).toBeCloseTo(0.0055, 3);
  });

  it('never shorter than the auto rule', () => {
    const { fix, drawn } = makeEntity();
    fix(0, 0.01, { prev: [0, 0], seg: 5, ago: 0, path: true });
    tick(25000);                                        // the next move 25 s later
    fix(0, 0.02, { prev: [0, 0.01], seg: 10, ago: 0, path: true });
    tick(16); tick(10000);
    expect(drawn().lng).toBeLessThan(0.016);            // not there after 10 s
    tick(15100);
    expect(drawn().lng).toBeCloseTo(0.02, 6);
  });

  it('is capped at SEGMENT_SLIDE_MAX_S', () => {
    const { entity } = makeEntity();
    Object.assign(entity.attributes, { previous_latitude: O, previous_longitude: 0, segment_duration_s: 5000 });
    expect(entity._segmentSeconds(new LatLng(O, 0))).toBe(SEGMENT_SLIDE_MAX_S);
    entity.attributes.segment_duration_s = 120;
    expect(entity._segmentSeconds(new LatLng(O, 0))).toBe(120);
  });

  it.each([['0', 0], ['negative', -5], ['a string', '120'], ['NaN', NaN]])('no segment when it is %s', (_, v) => {
    const { entity } = makeEntity();
    Object.assign(entity.attributes, { previous_latitude: O, previous_longitude: 0, segment_duration_s: v });
    expect(entity._segmentSeconds(new LatLng(O, 0))).toBeNull();
  });

  it('no segment without previous_*', () => {
    const { entity } = makeEntity();
    Object.assign(entity.attributes, { previous_latitude: 'x', previous_longitude: 0, segment_duration_s: 120 });
    expect(entity._segmentSeconds(new LatLng(O, 0))).toBeNull();
    Object.assign(entity.attributes, { previous_latitude: O, previous_longitude: null });
    expect(entity._segmentSeconds(new LatLng(O, 0))).toBeNull();
  });
});

describe('everything else keeps the auto rule', () => {
  it('another layer: the first move is placed, as before', () => {
    for (const layer of ['water', 'air', null]) {
      const { fix, drawn } = makeEntity({ layer });
      fix(0, 0.011, { prev: [0, 0], seg: 42, path: true });
      expect(drawn().lng).toBeCloseTo(0.011, 9);
    }
  });

  it('no track route: the first move is placed, a later one slides the auto time, straight', () => {
    const { fix, drawn } = makeEntity();
    fix(0, 0.011, { prev: [0, 0], seg: 42 });
    expect(drawn().lng).toBeCloseTo(0.011, 9);
    tick(11000);
    fix(0, 0.022, { prev: [0, 0.011], seg: 120 });
    tick(16); tick(11100);
    expect(drawn().lng).toBeCloseTo(0.022, 6);           // 11 s, not 120
  });

  it('previous_* farther than SEGMENT_FROM_M from where the marker was sent', () => {
    const far = (SEGMENT_FROM_M + 20) / M, near = (SEGMENT_FROM_M - 20) / M;
    const a = makeEntity();
    a.fix(0, 0.011, { prev: [0, far], seg: 42, path: true });
    expect(a.drawn().lng).toBeCloseTo(0.011, 9);
    const b = makeEntity();
    b.fix(0, 0.011, { prev: [0, near], seg: 42, path: true });
    tick(16);
    expect(b.drawn().lng).toBeLessThan(0.002);
  });

  it('no segment published', () => {
    const { fix, drawn } = makeEntity();
    fix(0, 0.011, { prev: [0, 0], path: true });
    expect(drawn().lng).toBeCloseTo(0.011, 9);
  });

  it('a configured number of seconds is the user\'s, not replaced', () => {
    const { fix, drawn } = makeEntity({ transition: 10 });
    fix(0, 0.01, { prev: [0, 0], seg: 120, path: true });
    tick(16); tick(10000);
    expect(drawn().lng).toBeCloseTo(0.01, 6);
  });

  it('reduced motion places it', () => {
    reduced = true;
    const { fix, drawn } = makeEntity();
    fix(0, 0.011, { prev: [0, 0], seg: 42, path: true });
    expect(drawn().lng).toBeCloseTo(0.011, 9);
  });

  it('a declared jump places it', () => {
    const { fix, drawn } = makeEntity();
    fix(0, 0.011, { prev: [0, 0], seg: 42, path: true, over: { position_jump: true } });
    expect(drawn().lng).toBeCloseTo(0.011, 9);
  });
});

describe('a fix arriving mid-slide carries on along the line', () => {
  // East 2 km, then a bend north 2 km; the second leg's path starts where the first ends.
  const E = 2000 / M;
  const LINE = [[0, 0], [0, E], [E, E], [E * 2, E]];
  /**
   * Metres along LINE (east, then north) of a point on it.
   * @param {{lat: number, lng: number}} p
   * @returns {number}
   */
  const along = (p) => (p.lat < E * 0.001 ? p.lng : E + p.lat) * M;

  it('the marker never leaves the line, and ends at the new fix', () => {
    const { fix, drawn } = makeEntity();
    fix(0, E, { prev: [0, 0], seg: 120, ago: 0, over: { track_path: [[0, 0], [0, E]] } });
    tick(16); tick(30000);                               // a quarter of the way east
    expect(drawn().lng).toBeLessThan(E * 0.3);
    fix(E * 2, E, { prev: [0, E], seg: 30, ago: 0, over: { track_path: [[0, E], [E, E], [E * 2, E]] } });
    let worst = 0, back = 0, last = along(drawn());
    for (let i = 0; i < 40; i++) {
      tick(1000);
      worst = Math.max(worst, offLine(drawn(), LINE));
      const s = along(drawn());
      back = Math.max(back, last - s); last = s;
    }
    expect(worst).toBeLessThan(1);
    expect(back).toBeLessThan(0.5);                      // never back along the line
    expect(drawn().lat).toBeCloseTo(E * 2, 6);
    expect(drawn().lng).toBeCloseTo(E, 6);
  });

  it('without the carry-on the slide would have cut across (control)', () => {
    const { entity, fix, drawn } = makeEntity();
    fix(0, E, { prev: [0, 0], seg: 120, ago: 0, over: { track_path: [[0, 0], [0, E]] } });
    tick(16); tick(30000);
    jest.spyOn(entity, '_slideRemainder').mockReturnValue(null);
    fix(E * 2, E, { prev: [0, E], seg: 30, ago: 0, over: { track_path: [[0, E], [E, E], [E * 2, E]] } });
    let worst = 0;
    for (let i = 0; i < 40; i++) { tick(1000); worst = Math.max(worst, offLine(drawn(), LINE)); }
    expect(worst).toBeGreaterThan(300);
  });

  it('no remainder once its time is up, even before the last frame has run', () => {
    const { entity, fix } = makeEntity();
    fix(0, E, { prev: [0, 0], seg: 20, ago: 0, over: { track_path: [[0, 0], [0, E]] } });
    tick(16);
    clock += 21000;                                      // no frame run
    expect(entity._transitionFrame).not.toBeNull();
    expect(entity._slideRemainder()).toBeNull();
  });

  it('a placement ends the slide: no remainder for the next move to follow', () => {
    const { entity, fix, drawn } = makeEntity();
    fix(0, E, { prev: [0, 0], seg: 120, ago: 0, over: { track_path: [[0, 0], [0, E]] } });
    tick(16); tick(30000);
    fix(E * 2, E, { prev: [0, E], seg: 30, ago: 0, over: { position_jump: true } });
    expect(drawn().lat).toBeCloseTo(E * 2, 9);
    expect(entity._slideRemainder()).toBeNull();
  });

  it('no remainder once the slide is over', () => {
    const { entity, fix } = makeEntity();
    fix(0, E, { prev: [0, 0], seg: 20, ago: 0, over: { track_path: [[0, 0], [0, E]] } });
    tick(16); tick(21000);
    expect(entity._slideRemainder()).toBeNull();
  });

  it('a new fix without a track_path slides straight from where it is drawn, as before', () => {
    const { fix, drawn } = makeEntity();
    fix(0, E, { prev: [0, 0], seg: 120, ago: 0, over: { track_path: [[0, 0], [0, E]] } });
    tick(16); tick(30000);
    const from = drawn();
    fix(E * 2, E, { prev: [0, E], seg: 30, ago: 0 });
    tick(15000);
    const mid = drawn();
    // On the straight line from where it was drawn to the fix.
    const t = (mid.lat - from.lat) / (E * 2 - from.lat);
    expect(mid.lng).toBeCloseTo(from.lng + (E - from.lng) * t, 6);
  });
});

// ---- A first sight catches up ALONG the line --------------------------------

/**
 * An entity first seen half way through a 100 s segment along a bend: east
 * 0.01 deg, then north 0.01 deg, from (41.0, -88.0) to (41.01, -87.99).
 * @param {object} [over] attributes to change
 * @returns {{entity: Entity, at: Function}}
 */
function firstSight(over = {}) {
  const attributes = {
    friendly_name: 'X', latitude: 41.01, longitude: -87.99, map_layer: 'rail',
    previous_latitude: 41.0, previous_longitude: -88.0, segment_duration_s: 100,
    observed_at: iso(WALL0 - 50000),
    track_path: [[41.0, -88.0], [41.0, -87.99], [41.01, -87.99]],
    ...over,
  };
  const hass = { states: { 'geo_location.x': { state: '1', attributes } }, formatEntityState: () => 'S', formatEntityAttributeValue: () => 'A', hassUrl: (u) => u };
  const config = {
    id: 'geo_location.x', display: 'marker', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 24, color: '#757575', configuredColor: null,
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, positionTransition: 'auto', circleConfig: {}, geoJsonConfig: {},
  };
  const map = { distance: jest.fn((a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng) * M), getZoom: jest.fn(() => 10) };
  const entity = new Entity(config, hass, map, jest.fn(), jest.fn(), jest.fn(), false);
  return { entity, at: () => entity.marker.getLatLng() };
}

describe('a first sight catches up along the line', () => {
  const BEND = [[41.0, -88.0], [41.0, -87.99], [41.01, -87.99]];
  // In metres, as TrackPath.metres measures: the east leg is shorter than the north one.
  const k = Math.cos((41.0 * Math.PI) / 180);
  const EAST = 0.01 * k * M, NORTH = 0.01 * M, TOTAL = EAST + NORTH;

  it('starts half way ALONG the path, past the bend, and stays on it', () => {
    const { entity, at } = firstSight();
    entity.setup();
    expect(at().lng).toBeCloseTo(-87.99, 9);                       // on the north leg
    expect((at().lat - 41.0) * M).toBeCloseTo(TOTAL / 2 - EAST, 0);
    let worst = 0;
    for (let i = 0; i < 50; i++) { tick(1000); worst = Math.max(worst, offLine(at(), BEND)); }
    expect(worst).toBeLessThan(1);
    expect(at().lat).toBeCloseTo(41.01, 6);
  });

  it('a quarter of the way: on the first leg', () => {
    const { entity, at } = firstSight({ observed_at: iso(WALL0 - 25000) });
    entity.setup();
    expect(at().lat).toBeCloseTo(41.0, 9);                         // on the east leg
    expect((at().lng + 88.0) * k * M).toBeCloseTo(TOTAL / 4, 0);
  });

  it('a path that is not this segment\'s: the straight catch-up, as before', () => {
    const { entity, at } = firstSight({ track_path: [[41.0, -88.01], [41.0, -87.99], [41.01, -87.99]] });
    entity.setup();
    expect(at().lat).toBeCloseTo(41.005, 6);             // half way along the chord
    expect(at().lng).toBeCloseTo(-87.995, 6);
  });

  it('no path: the straight catch-up, as before', () => {
    const { entity, at } = firstSight({ track_path: undefined });
    entity.setup();
    expect(at().lat).toBeCloseTo(41.005, 6);
  });

  it('is BUILT facing along its first leg on the line (east), not the chord (north-east)', () => {
    const { entity } = firstSight({ observed_at: iso(WALL0 - 25000) });
    const built = [];
    const create = entity.createMapMarker.bind(entity);
    jest.spyOn(entity, 'createMapMarker').mockImplementation((at) => { built.push(entity._travel); return create(at); });
    entity.setup();
    expect(built).toHaveLength(1);
    expect(built[0]).toBeCloseTo(90, 0);
  });

  it('a path that ends elsewhere: the straight catch-up', () => {
    const { entity, at } = firstSight({ track_path: [[41.0, -88.0], [41.0, -87.99], [41.02, -87.99]] });
    entity.setup();
    expect(at().lat).toBeCloseTo(41.005, 6);
    expect(at().lng).toBeCloseTo(-87.995, 6);
  });
});

describe('pathAt', () => {
  const P2 = [[41.0, -88.0], [41.0, -87.99]];
  const prev = { lat: 41.0, lng: -88.0 }, to = { lat: 41.0, lng: -87.99 };
  it('clamps the fraction to the path', () => {
    expect(pathAt(P2, prev, to, 1.5).start.lng).toBeCloseTo(-87.99, 9);
    expect(pathAt(P2, prev, to, -0.5).start.lng).toBeCloseTo(-88.0, 9);
  });
  it('gives nothing for a fraction that is not a number', () => {
    expect(pathAt(P2, prev, to, NaN)).toBeNull();
  });
});
