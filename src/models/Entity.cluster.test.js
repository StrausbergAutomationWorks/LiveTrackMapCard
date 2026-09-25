import Entity from './Entity.js';
import L from './leafletGlobal.testhelper.js';
import 'leaflet.markercluster';
import { LatLng } from 'leaflet';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

// Backlog 231: with cluster_markers on, markercluster answered every
// setLatLng of a slide with removeLayer + addLayer (_moveChild), which
// rebuilt the marker's DOM ~17 times a second and killed the rotation
// transition. A slide now moves the marker the way a DRAG does in that
// library - `__dragStart` set, moves ignored - and the group re-indexes it
// ONCE, through its own dragend path, when the slide ends or is interrupted.
// These tests run the REAL MarkerClusterGroup, not a mock of it.

let clock, frames, nextFrame, map, group, div;

beforeEach(() => {
  clock = 1000; frames = new Map(); nextFrame = 1;
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  globalThis.requestAnimationFrame = jest.fn((cb) => { const id = nextFrame++; frames.set(id, cb); return id; });
  globalThis.cancelAnimationFrame = jest.fn((id) => frames.delete(id));
  window.matchMedia = jest.fn((q) => ({ matches: false, media: q }));
  div = document.createElement('div');
  Object.defineProperty(div, 'clientWidth', { value: 800 });
  Object.defineProperty(div, 'clientHeight', { value: 600 });
  document.body.appendChild(div);
  map = L.map(div, { maxZoom: 18, animate: false, zoomAnimation: false, fadeAnimation: false }).setView([41.05, -88.0], 12);
  group = L.markerClusterGroup({ animate: false });
  map.addLayer(group);
  jest.spyOn(group, '_moveChild');
});
afterEach(() => { map.remove(); div.remove(); jest.restoreAllMocks(); delete window.matchMedia; });

/**
 * Advance the clock and run the frames that were pending.
 * @param {number} ms
 */
function tick(ms) {
  clock += ms;
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb(clock);
}
/**
 * Run frames at ~60 fps for a span of time.
 * @param {number} totalMs
 * @param {number} [step]
 */
function runFrames(totalMs, step = 16) { for (let t = 0; t < totalMs; t += step) tick(step); }

/**
 * An entity at 41.0, -88.0 on the real map.
 * @param {object} [o]
 * @param {number|string} [o.positionTransition]
 * @param {number} [o.lat]
 * @param {number} [o.lng]
 * @returns {{entity: Entity, attributes: object}}
 */
function makeEntity({ positionTransition = 10, lat = 41.0, lng = -88.0 } = {}) {
  const attributes = { friendly_name: 'X', latitude: lat, longitude: lng };
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
  const entity = new Entity(config, hass, map, jest.fn(), jest.fn(), jest.fn(), false);
  return { entity, attributes };
}

/**
 * How many entries markercluster's distance grid holds at its max zoom.
 * @returns {number}
 */
function gridEntries() {
  const grid = group._gridUnclustered[group._maxZoom];
  let n = 0;
  for (const row of Object.values(grid._grid)) for (const cell of Object.values(row)) n += cell.length;
  return n;
}

describe('backlog 231: a slide inside a cluster group', () => {
  it('moves the drawn marker every frame but re-indexes it ONCE, at the end', () => {
    const { entity, attributes } = makeEntity();
    entity.setup(group);
    tick(20000);                                  // a real gap before the next fix
    attributes.latitude = 41.1;
    entity.updateMarkerPosition();
    runFrames(5000);
    const mid = entity.marker.getLatLng().lat;
    expect(mid).toBeGreaterThan(41.0);            // it moves while sliding
    expect(mid).toBeLessThan(41.1);
    expect(group._moveChild).not.toHaveBeenCalled();
    runFrames(6000);
    expect(entity.marker.getLatLng()).toEqual(new LatLng(41.1, -88.0));
    expect(group._moveChild).toHaveBeenCalledTimes(1);
    expect(entity.marker.__dragStart).toBeUndefined();
    expect(group.hasLayer(entity.marker)).toBe(true);
    expect(gridEntries()).toBe(1);
  });

  it('a new fix mid-slide carries on and still re-indexes once in total', () => {
    const { entity, attributes } = makeEntity();
    entity.setup(group);
    tick(20000);
    attributes.latitude = 41.1; entity.updateMarkerPosition();
    runFrames(4000);
    tick(4000);
    attributes.latitude = 41.2; entity.updateMarkerPosition();
    runFrames(12000);
    expect(entity.marker.getLatLng()).toEqual(new LatLng(41.2, -88.0));
    expect(group._moveChild).toHaveBeenCalledTimes(1);
    expect(gridEntries()).toBe(1);
  });

  it.each(['remove', 'hide'])('%s() mid-slide leaves no stale grid entry', (how) => {
    const { entity, attributes } = makeEntity();
    entity.setup(group);
    tick(20000);
    attributes.latitude = 41.1; entity.updateMarkerPosition();
    runFrames(4000);
    entity[how](group);
    expect(group.getLayers().length).toBe(0);
    expect(gridEntries()).toBe(0);
    expect(frames.size).toBe(0);
  });

  it('a placement with no slide (position_jump) is re-indexed at once', () => {
    const { entity, attributes } = makeEntity();
    entity.setup(group);
    tick(20000);
    attributes.latitude = 41.1; entity.updateMarkerPosition();
    runFrames(3000);
    attributes.latitude = 41.3; attributes.position_jump = true;
    entity.updateMarkerPosition();
    expect(entity.marker.getLatLng()).toEqual(new LatLng(41.3, -88.0));
    expect(entity.marker.__dragStart).toBeUndefined();
    expect(group._moveChild).toHaveBeenCalledTimes(1);
    expect(gridEntries()).toBe(1);
  });

  it('keeps the SAME marker element through the slide (no DOM rebuild)', () => {
    const { entity, attributes } = makeEntity();
    entity.setup(group);
    const el = entity.marker.getElement();
    expect(el).toBeTruthy();
    tick(20000);
    attributes.latitude = 41.08; entity.updateMarkerPosition();
    runFrames(5000);
    expect(entity.marker.getElement()).toBe(el);
  });
});

describe('backlog 231: nothing changes without a cluster group', () => {
  it('never sets __dragStart on a marker added straight to the map', () => {
    const { entity, attributes } = makeEntity();
    entity.setup(null);
    tick(20000);
    attributes.latitude = 41.1; entity.updateMarkerPosition();
    runFrames(3000);
    expect(entity.marker.__dragStart).toBeUndefined();
    runFrames(9000);
    expect(entity.marker.getLatLng()).toEqual(new LatLng(41.1, -88.0));
    expect(group._moveChild).not.toHaveBeenCalled();
  });
});
