import { jest, describe, it, expect } from '@jest/globals';
import EntitiesRenderService, { selfContained } from './EntitiesRenderService.js';
import { placement } from '../../markers/MarkerPlacement.js';
import { stats } from '../../markers/MarkerStats.js';

jest.mock('leaflet');
jest.mock('leaflet.markercluster', () => ({}));
jest.mock('../../util/Logger.js');

// Map capacity (card SSOT 2026-10-25): an entity whose state object Home Assistant has not
// replaced since its last update is not updated again. Home Assistant replaces the object
// on every change, so the same object is the same state.

const ID = 'geo_location.a';
const state = (lat = 41.9) => ({ state: '1', attributes: { latitude: lat, longitude: -87.9 } });

/**
 * @param {object} [over] fields over the stand-in
 * @returns {object} a stand-in Entity that already has a marker
 */
function fakeEntity(over = {}) {
  return {
    id: ID, attributes: {}, config: { id: ID }, latLng: { lat: 41.9, lng: -87.9 }, display: 'marker',
    marker: {}, historyManager: { hasHistory: false }, update: jest.fn(), hide: jest.fn(), ...over,
  };
}

/**
 * @param {object} ent
 * @param {Set<string>} [stale]
 * @returns {EntitiesRenderService}
 */
function service(ent, stale = new Set()) {
  const svc = new EntitiesRenderService({}, {}, { isNone: true }, [], null, null, null, false, false, (id) => stale.has(id));
  svc.entities = [ent];
  return svc;
}

describe('the per-entity skip', () => {
  it('updates once for one state object, however many renders', async () => {
    const ent = fakeEntity();
    const svc = service(ent);
    const hass = { states: { [ID]: state() } };
    const skipped = stats.skipped;
    await svc.render(hass);
    await svc.render({ states: { ...hass.states } });
    await svc.render({ states: { ...hass.states } });
    expect(ent.update).toHaveBeenCalledTimes(1);
    expect(stats.skipped).toBe(skipped + 2);
  });

  it('updates again when Home Assistant replaces the object', async () => {
    const ent = fakeEntity();
    const svc = service(ent);
    await svc.render({ states: { [ID]: state(41.9) } });
    await svc.render({ states: { [ID]: state(41.9) } });
    expect(ent.update).toHaveBeenCalledTimes(2);
  });

  it('still hands every entity the new hass before it skips, so its hover box reads the newest', async () => {
    const ent = fakeEntity();
    const svc = service(ent);
    const st = state();
    await svc.render({ states: { [ID]: st } });
    const h2 = { states: { [ID]: st }, tag: 2 };
    await svc.render(h2);
    expect(ent.update).toHaveBeenCalledTimes(1);
    expect(ent.hass).toBe(h2);
  });

  it('never skips an entity with no marker yet', async () => {
    const ent = fakeEntity({ marker: null });
    const svc = service(ent);
    const st = state();
    await svc.render({ states: { [ID]: st } });
    await svc.render({ states: { [ID]: st } });
    expect(ent.update).toHaveBeenCalledTimes(2);
  });

  it('never skips an entity with no state object', async () => {
    const ent = fakeEntity();
    const svc = service(ent);
    await svc.render({ states: {} });
    await svc.render({ states: {} });
    expect(ent.update).toHaveBeenCalledTimes(2);
  });

  it('a hidden entity is hidden, and updated when it comes back even with the same object', async () => {
    const ent = fakeEntity();
    const stale = new Set();
    const svc = service(ent, stale);
    const st = state();
    await svc.render({ states: { [ID]: st } });
    stale.add(ID);
    await svc.render({ states: { [ID]: st } });
    expect(ent.hide).toHaveBeenCalledTimes(1);
    stale.delete(ID);
    await svc.render({ states: { [ID]: st } });
    expect(ent.update).toHaveBeenCalledTimes(2);
  });

  it('an entity fed by something else is updated every render', async () => {
    const ent = fakeEntity({ historyManager: { hasHistory: true } });
    const svc = service(ent);
    const st = state();
    await svc.render({ states: { [ID]: st } });
    await svc.render({ states: { [ID]: st } });
    expect(ent.update).toHaveBeenCalledTimes(2);
  });
});

describe('selfContained', () => {
  const base = () => fakeEntity();
  it('a plain entity is', () => expect(selfContained(base())).toBe(true));
  it.each([
    ['a distance entity', (e) => { e.config.distanceEntity = 'sensor.d'; }],
    ['a circle', (e) => { e.config.circleConfig = { enabled: true }; }],
    ['GeoJSON', (e) => { e.config.geoJsonConfig = { enabled: true }; }],
    ['history', (e) => { e.historyManager = { hasHistory: true }; }],
    ['a zone pill', (e) => { e.display = 'pill'; }],
    ['device trackers', (e) => { e.attributes = { device_trackers: ['device_tracker.p'] }; }],
    ['history playback', (e) => { e.currentTimelineEntry = {}; }],
    ['a fixed position', (e) => { e.config.fixedX = 1; e.config.fixedY = 2; }],
  ])('%s is not', (_, change) => {
    const e = base();
    change(e);
    expect(selfContained(e)).toBe(false);
  });
  it('an empty device_trackers list or one fixed coordinate does not count', () => {
    const e = base();
    e.attributes = { device_trackers: [] };
    e.config.fixedX = 1;
    expect(selfContained(e)).toBe(true);
  });
});

describe('the drawing choice', () => {
  // markerDrawing is the 12th argument since the rebase onto main (isFiltered, D4f, took the 11th).
  const make = (map, cluster, drawing) => new EntitiesRenderService(map, {}, { isNone: true }, [], null, null, null, false, cluster, null, null, drawing);
  it('is applied to the map', () => {
    const map = {};
    make(map, false, { canvas: true, cull: true });
    expect(placement(map)).toEqual({ canvas: true, cull: true });
  });
  it('with clustering, neither canvas nor culling, whatever was asked', () => {
    const map = {};
    make(map, true, { canvas: true, cull: true });
    expect(placement(map)).toEqual({ canvas: false, cull: false });
  });
  it('not given, the map is left alone', () => {
    const map = {};
    make(map, false, null);
    expect(map.__ltmcPlacement).toBeUndefined();
  });
});
