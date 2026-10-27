import Entity from './Entity.js';
import EntityConfig, { layerOffset, parseZIndexOffset, MAP_LAYER_OFFSETS } from '../configs/EntityConfig.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('./EntityHistoryManager.js');

// 06_MAP_CONTRACT.md D10 (Lee, 2026-09-24): an integration names its layer,
// the card owns the numbers; a dashboard z_index_offset wins; absent or
// unknown is 0.

const noop = jest.fn();
const DEFAULTS = { historyStart: null, historyEnd: null };
const ID = 'geo_location.x';

/**
 * @param {{configured?: number|null, layer?: *}} [opts]
 * @returns {{entity: Entity, hass: object}}
 */
function makeEntity({ configured = null, layer } = {}) {
  const attributes = { friendly_name: 'X', latitude: 41.9, longitude: -87.9 };
  if (layer !== undefined) attributes.map_layer = layer;
  const hass = {
    states: { [ID]: { state: '1.0', attributes } },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => 'X'),
    hassUrl: jest.fn(u => u),
  };
  const config = {
    id: ID, display: 'marker', prefix: '', suffix: '', label: null, size: 28,
    configuredColor: null, color: '#757575',
    zIndexOffset: configured, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  return { entity: new Entity(config, hass, map, noop, noop, noop, false), hass };
}

describe('layerOffset', () => {
  it('maps the six names to the contract offsets', () => {
    expect(MAP_LAYER_OFFSETS).toEqual({ fixed: 0, water: 10000, rail: 20000, air_low: 30000, air: 40000, weather: -10000 });
    for (const [name, v] of Object.entries(MAP_LAYER_OFFSETS)) expect(layerOffset(name)).toBe(v);
  });
  it('is 0 for absent, unknown or non-string names', () => {
    for (const v of [undefined, null, '', 'AIR', 'space', 40000, {}, 'toString', '__proto__']) {
      expect(layerOffset(v)).toBe(0);
    }
  });
});

describe('parseZIndexOffset (the dashboard override)', () => {
  it('keeps any finite number, 0 and negatives included', () => {
    expect(parseZIndexOffset(0)).toBe(0);
    expect(parseZIndexOffset(10000)).toBe(10000);
    expect(parseZIndexOffset(-5)).toBe(-5);
  });
  it('is null for absent or non-numbers', () => {
    for (const v of [undefined, null, '100', NaN, Infinity, true]) expect(parseZIndexOffset(v)).toBeNull();
  });
  it('EntityConfig: an explicit 0 stays 0; absent is null, no longer 1', () => {
    expect(new EntityConfig({ entity: ID, z_index_offset: 0 }, DEFAULTS).zIndexOffset).toBe(0);
    expect(new EntityConfig({ entity: ID }, DEFAULTS).zIndexOffset).toBeNull();
    expect(new EntityConfig({ entity: ID, z_index_offset: 10000 }, DEFAULTS).zIndexOffset).toBe(10000);
  });
});

describe('Entity.zIndexOffset', () => {
  it('takes the offset of map_layer when the dashboard sets none', () => {
    expect(makeEntity({ layer: 'air_low' }).entity.zIndexOffset).toBe(30000);
    expect(makeEntity({ layer: 'water' }).entity.zIndexOffset).toBe(10000);
  });
  it('is 0 with no map_layer and no override', () => {
    expect(makeEntity().entity.zIndexOffset).toBe(0);
    expect(makeEntity({ layer: 'bogus' }).entity.zIndexOffset).toBe(0);
  });
  it('a dashboard value wins, 0 included', () => {
    expect(makeEntity({ configured: 20000, layer: 'air' }).entity.zIndexOffset).toBe(20000);
    expect(makeEntity({ configured: 0, layer: 'air' }).entity.zIndexOffset).toBe(0);
  });
  it('the marker is built with it', () => {
    const { entity } = makeEntity({ layer: 'air' });
    expect(entity.createMapMarker().options.zIndexOffset).toBe(40000);
  });
  it('a changed map_layer reaches the existing marker in place, once', () => {
    const { entity, hass } = makeEntity({ layer: 'water' });
    entity.createMapMarker();
    entity.marker = { setZIndexOffset: jest.fn() };
    entity.refreshMarkerZIndex();
    expect(entity.marker.setZIndexOffset).not.toHaveBeenCalled();
    hass.states[ID].attributes.map_layer = 'air';
    entity.refreshMarkerZIndex();
    entity.refreshMarkerZIndex();
    expect(entity.marker.setZIndexOffset).toHaveBeenCalledTimes(1);
    expect(entity.marker.setZIndexOffset).toHaveBeenCalledWith(40000);
  });
});
