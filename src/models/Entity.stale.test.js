import Entity from './Entity.js';
import { LatLng } from 'leaflet';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

// Two guards for an entity the page holds without Home Assistant having it:
// hide() takes the marker off and lets it come back, and `state`/`title`
// no longer throw on a missing state object.

let frames;
beforeEach(() => {
  frames = new Map();
  let next = 1;
  globalThis.requestAnimationFrame = jest.fn((cb) => { const id = next++; frames.set(id, cb); return id; });
  globalThis.cancelAnimationFrame = jest.fn((id) => frames.delete(id));
  window.matchMedia = jest.fn(() => ({ matches: false }));
});
afterEach(() => { jest.restoreAllMocks(); delete window.matchMedia; });

/**
 * An Entity with a stub marker at 41.0, -88.0.
 * @param {object} [o]
 * @param {string} [o.display] the entity's display mode
 * @param {string} [o.attribute] the attribute an `attribute` display shows
 * @param {boolean} [o.present] whether Home Assistant still has the entity
 * @returns {object} entity, marker, hass, attrs
 */
function makeEntity({ display = 'marker', attribute, present = true } = {}) {
  const attrs = { friendly_name: 'Aircraft A38141', latitude: 41.0, longitude: -88.0 };
  const states = present ? { 'geo_location.x': { state: '1', attributes: attrs } } : {};
  const hass = {
    states,
    formatEntityState: jest.fn((s) => s.attributes && 'S'),
    formatEntityAttributeValue: jest.fn((s, a) => s.attributes[a]),
    hassUrl: (u) => u,
  };
  const config = { id: 'geo_location.x', display, attribute, positionUpdateThreshold: 10, positionTransition: 10, circleConfig: {}, geoJsonConfig: {} };
  const map = { distance: jest.fn(() => 50000) };
  const entity = new Entity(config, hass, map, jest.fn(), jest.fn(), jest.fn(), false);
  let drawn = new LatLng(41.0, -88.0);
  const marker = {
    setLatLng: jest.fn((ll) => { drawn = Array.isArray(ll) ? new LatLng(ll[0], ll[1]) : ll; }),
    getLatLng: jest.fn(() => drawn),
    remove: jest.fn(),
  };
  entity.marker = marker;
  entity._lastSetLatLng = new LatLng(41.0, -88.0);
  return { entity, marker, hass, attrs };
}

describe('hide()', () => {
  it('takes the marker off the map and out of its cluster', () => {
    const { entity, marker } = makeEntity();
    const cluster = { hasLayer: jest.fn(() => true), removeLayer: jest.fn() };
    entity.hide(cluster);
    expect(cluster.removeLayer).toHaveBeenCalledWith(marker);
    expect(marker.remove).toHaveBeenCalled();
    expect(entity.marker).toBeNull();
  });

  it('cancels a slide in flight', () => {
    const { entity, attrs } = makeEntity();
    attrs.latitude = 41.5;
    entity._lastMoveAt = performance.now() - 5000;
    entity.updateMarkerPosition();
    expect(entity._transitionFrame).not.toBeNull();
    entity.hide();
    expect(entity._transitionFrame).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('is NOT remove(): the entity stays usable and is not marked removed', () => {
    const { entity } = makeEntity();
    entity.hide();
    expect(entity.removed).toBe(false);
    expect(entity.circle.remove).not.toHaveBeenCalled();
    expect(entity.historyManager.remove).not.toHaveBeenCalled();
  });

  it('forgets the last position, so a returning entity is placed, not slid', () => {
    const { entity } = makeEntity();
    entity.hide();
    expect(entity._lastSetLatLng).toBeNull();
    expect(entity._lastMoveAt).toBeUndefined();
  });

  it('does nothing without a marker', () => {
    const { entity } = makeEntity();
    entity.marker = null;
    expect(() => entity.hide()).not.toThrow();
  });
});

describe('state and title of an entity Home Assistant no longer has', () => {
  it.each(['state', 'attribute', 'marker'])('display %s: title does not throw', (display) => {
    const { entity } = makeEntity({ display, attribute: 'callsign', present: false });
    expect(() => entity.title).not.toThrow();
  });

  it('state is empty rather than a throw', () => {
    const { entity, hass } = makeEntity({ present: false });
    expect(entity.state).toBe('');
    expect(hass.formatEntityState).not.toHaveBeenCalled();
  });

  it('state still formats a present entity', () => {
    const { entity } = makeEntity({ display: 'state' });
    expect(entity.state).toBe('S');
    expect(entity.title).toBe('S');
  });

  it('an attribute title still formats a present entity', () => {
    const { entity, attrs } = makeEntity({ display: 'attribute', attribute: 'callsign' });
    attrs.callsign = 'UAL1';
    expect(entity.title).toBe('UAL1');
  });
});
