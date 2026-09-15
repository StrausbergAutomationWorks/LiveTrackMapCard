import { jest, describe, it, expect } from '@jest/globals';
import Circle from './Circle.js';
import GeoJson from './GeoJson.js';
import EntityHistoryManager from './EntityHistoryManager.js';
import EntityConfig from '../configs/EntityConfig.js';

jest.mock('../util/Logger.js');

// The pieces an Entity puts on the map, each able to take itself off again.

describe('Circle.remove()', () => {
  it('removes the drawn circle and stops updating it', () => {
    const c = new Circle({ enabled: true }, {});
    const drawn = { remove: jest.fn(), setLatLng: jest.fn(), setRadius: jest.fn() };
    c.circle = drawn;
    c.remove();
    expect(drawn.remove).toHaveBeenCalled();
    c.update();
    expect(drawn.setLatLng).not.toHaveBeenCalled();
  });

  it('is safe when no circle was drawn', () => {
    expect(() => new Circle({ enabled: false }, {}).remove()).not.toThrow();
  });
});

describe('GeoJson.remove()', () => {
  it('takes its layer off the map', () => {
    const map = { removeLayer: jest.fn() };
    const g = new GeoJson({ enabled: true }, { map });
    const layer = {};
    g.geoJsonLayer = layer;
    g.remove();
    expect(map.removeLayer).toHaveBeenCalledWith(layer);
    expect(g.geoJsonLayer).toBeNull();
  });

  it('is safe with no layer', () => {
    const map = { removeLayer: jest.fn() };
    new GeoJson({ enabled: true }, { map }).remove();
    expect(map.removeLayer).not.toHaveBeenCalled();
  });
});

describe('EntityHistoryManager.remove()', () => {
  function manager() {
    const map = { removeLayer: jest.fn() };
    const entity = {
      id: 'geo_location.x', map, react: jest.fn(), updateMarkerPosition: jest.fn(),
      config: { hasHistory: true },
    };
    const historyService = { unsubscribeEntity: jest.fn(), subscribe: jest.fn() };
    const m = new EntityHistoryManager(entity, historyService, null, null);
    m.historyLayerGroup = { clearLayers: jest.fn() };
    return { m, map, entity, historyService };
  }

  it('takes the history trail off the map and closes the stream', () => {
    const { m, map, historyService } = manager();
    const group = m.historyLayerGroup;
    m.remove({ unsubscribe: true });
    expect(map.removeLayer).toHaveBeenCalledWith(group);
    expect(historyService.unsubscribeEntity).toHaveBeenCalledWith('geo_location.x');
  });

  it('can leave the stream open for another marker of the same entity', () => {
    const { m, historyService } = manager();
    m.remove({ unsubscribe: false });
    expect(historyService.unsubscribeEntity).not.toHaveBeenCalled();
  });

  it('cancels a pending redraw', () => {
    jest.useFakeTimers();
    try {
      const { m } = manager();
      m.update = jest.fn();
      m._updateTimeout = setTimeout(() => m.update(), 100);
      m.remove({ unsubscribe: true });
      jest.advanceTimersByTime(500);
      expect(m.update).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  // Date-range and linked-entity listeners are anonymous and cannot be
  // detached one by one, so a removed manager must ignore them.
  it('ignores late history messages and date changes once removed', () => {
    const { m, entity, historyService } = manager();
    m.remove({ unsubscribe: true });
    m.react({ originalEntityId: 'geo_location.x' });
    m.refreshHistory();
    m.update();
    expect(entity.react).not.toHaveBeenCalled();
    expect(historyService.subscribe).not.toHaveBeenCalled();
    expect(entity.updateMarkerPosition).not.toHaveBeenCalled();
  });
});

describe('EntityConfig.fingerprint', () => {
  const defaults = { historyStart: null, historyEnd: null };

  it('is the same for the same YAML', () => {
    const a = new EntityConfig({ entity: 'geo_location.x', color: 'red' }, defaults);
    const b = new EntityConfig({ entity: 'geo_location.x', color: 'red' }, defaults);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('differs when an option differs', () => {
    const a = new EntityConfig({ entity: 'geo_location.x', color: 'red' }, defaults);
    const b = new EntityConfig({ entity: 'geo_location.x', color: 'blue' }, defaults);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('works for the bare-string form', () => {
    const a = new EntityConfig('geo_location.x', defaults);
    expect(a.fingerprint).toBe(JSON.stringify('geo_location.x'));
  });
});
