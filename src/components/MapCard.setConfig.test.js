import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import MapCard from './MapCard.js';

jest.mock('leaflet');
jest.mock('lit', () => ({
  LitElement: class LitElement {
    static get properties() { return {}; }
    static get styles() { return ''; }
    requestUpdate() {}
    connectedCallback() {}
  },
  html: (strings) => strings.join(''),
  css: (strings) => strings.join('')
}));
jest.mock('../util/Logger.js');

// auto-entities calls setConfig on every change to its filter result. A full
// rebuild each time redraws the map, resets the view and loses the cluster
// toggle, so a change to the entity list ALONE is applied in place.
describe('MapCard.setConfig', () => {
  const base = {
    type: 'custom:live-track-map-card', x: 41.9, y: -87.9, zoom: 9,
    cluster_markers: true,
    entities: [{ entity: 'geo_location.a' }, { entity: 'geo_location.b' }],
  };
  let card;

  // A card whose map is already built.
  function built(config = base) {
    const c = new MapCard();
    c.setConfig(config);
    c.map = {};
    c.setupNeeded = false;
    c.hasError = false;
    c.entitiesRenderService = { updateEntityConfigs: jest.fn() };
    return c;
  }

  beforeEach(() => { card = built(); });

  it('asks for a full setup the first time', () => {
    const fresh = new MapCard();
    fresh.setConfig(base);
    expect(fresh.setupNeeded).toBe(true);
  });

  it('updates in place when only the entity list changed', () => {
    const next = { ...base, entities: [{ entity: 'geo_location.b' }, { entity: 'geo_location.c' }] };
    card.setConfig(next);
    expect(card.setupNeeded).toBe(false);
    const passed = card.entitiesRenderService.updateEntityConfigs.mock.calls[0][0];
    expect(passed.map((c) => c.id)).toEqual(['geo_location.b', 'geo_location.c']);
    expect(card.config).toBe(next);
    expect(card._config.entities.map((c) => c.id)).toEqual(['geo_location.b', 'geo_location.c']);
  });

  it('updates in place when the list is unchanged', () => {
    card.setConfig({ ...base, entities: [...base.entities] });
    expect(card.setupNeeded).toBe(false);
    expect(card.entitiesRenderService.updateEntityConfigs).toHaveBeenCalledTimes(1);
  });

  it('updates in place when one entity\'s own options changed', () => {
    card.setConfig({ ...base, entities: [{ entity: 'geo_location.a', color: 'red' }, base.entities[1]] });
    expect(card.setupNeeded).toBe(false);
    expect(card.entitiesRenderService.updateEntityConfigs).toHaveBeenCalledTimes(1);
  });

  // auto-entities sends one entry per matching include branch.
  it('passes ONE config per entity to the in-place update - the first entry\'s', () => {
    card.setConfig({ ...base, entities: [
      { entity: 'geo_location.a', color: '#299FD5' },
      { entity: 'geo_location.b' },
      { entity: 'geo_location.a' },
      { entity: 'geo_location.a', position_transition: 'auto' },
    ] });
    expect(card.setupNeeded).toBe(false);
    const passed = card.entitiesRenderService.updateEntityConfigs.mock.calls[0][0];
    expect(passed.map((c) => c.id)).toEqual(['geo_location.a', 'geo_location.b']);
    expect(passed[0].color).toBe('#299FD5');
  });

  it('builds the first map with one config per entity too', () => {
    const fresh = new MapCard();
    fresh.setConfig({ ...base, entities: [{ entity: 'geo_location.a', color: '#299FD5' }, { entity: 'geo_location.a' }] });
    expect(fresh._config.entities.map((c) => c.id)).toEqual(['geo_location.a']);
    expect(fresh._config.entities[0].color).toBe('#299FD5');
  });

  it.each([
    ['zoom', { zoom: 12 }],
    ['clustering', { cluster_markers: false }],
    ['tile layers', { tile_layers: [{ url: 'https://t/{z}/{x}/{y}.png' }] }],
    ['a new top-level key', { focus_follow: 'contains' }],
  ])('rebuilds when %s changed', (_, change) => {
    card.setConfig({ ...base, ...change });
    expect(card.setupNeeded).toBe(true);
    expect(card.entitiesRenderService.updateEntityConfigs).not.toHaveBeenCalled();
  });

  it('rebuilds when there is no map yet', () => {
    card.map = undefined;
    card.setConfig({ ...base, entities: [] , x: 41.9 });
    expect(card.setupNeeded).toBe(true);
    expect(card.entitiesRenderService.updateEntityConfigs).not.toHaveBeenCalled();
  });

  it('rebuilds when a setup is already pending', () => {
    card.setupNeeded = true;
    card.setConfig({ ...base, entities: [base.entities[0]] });
    expect(card.setupNeeded).toBe(true);
    expect(card.entitiesRenderService.updateEntityConfigs).not.toHaveBeenCalled();
  });

  it('rebuilds when the last setup failed', () => {
    card.hasError = true;
    card.setConfig({ ...base, entities: [base.entities[0]] });
    expect(card.setupNeeded).toBe(true);
    expect(card.entitiesRenderService.updateEntityConfigs).not.toHaveBeenCalled();
  });

  it('falls back to a rebuild when the in-place update throws', () => {
    card.entitiesRenderService.updateEntityConfigs.mockImplementation(() => { throw new Error('x'); });
    card.setConfig({ ...base, entities: [base.entities[0]] });
    expect(card.setupNeeded).toBe(true);
  });

  it('still rejects an invalid config, and leaves the map alone', () => {
    const before = card.config;
    expect(() => card.setConfig({ type: 'custom:live-track-map-card' })).toThrow();
    expect(card.config).toBe(before);
    expect(card.setupNeeded).toBe(false);
    expect(card.entitiesRenderService.updateEntityConfigs).not.toHaveBeenCalled();
  });
});
