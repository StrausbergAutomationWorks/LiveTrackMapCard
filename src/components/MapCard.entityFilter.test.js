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

// `entity_filter` (Lee 2026-11-20): the card picks its own entities, so auto-entities can come off
// railair-map. Made-up entities in Lisbon.
const st = (id, state, attributes = {}) => ({ entity_id: id, state, attributes });
const plane = (id, lat = 38.77) => st(id, '12', { source: 'live_track_aircraft', latitude: lat, longitude: -9.13 });
const ship = (id) => st(id, '3', { source: 'live_track_ships', latitude: 38.69, longitude: -9.2 });

const config = {
  type: 'custom:live-track-map-card', x: 38.7, y: -9.1, zoom: 9,
  entity_filter: {
    include: [
      { attributes: { source: 'live_track_aircraft' }, options: { size: 60 } },
      { domain: 'geo_location', options: { size: 28 } },
      { domain: 'person', options: { size: 44, name: 'Ana' } },
    ],
    exclude: [{ state: 'unavailable' }],
  },
};

/**
 * @param {object} states
 * @returns {object} a hass with those states
 */
function hassWith(states) { return { states, themes: { darkMode: false } }; }

/**
 * A card whose map is built, with the two services the filter feeds.
 * @param {object} cfg
 * @param {object} states
 * @returns {MapCard}
 */
function built(cfg = config, states = { 'geo_location.pl_1': plane('geo_location.pl_1') }) {
  const c = new MapCard();
  c.hass = hassWith(states);
  c.setConfig(cfg);
  c.map = {};
  c.setupNeeded = false;
  c.hasError = false;
  c.entitiesRenderService = { updateEntityConfigs: jest.fn() };
  c.presenceRenderService = { setEntities: jest.fn() };
  return c;
}

describe('MapCard: entity_filter', () => {
  let card;
  beforeEach(() => { card = built(); });

  it('setConfig with a hass already present takes the filter\'s entities at once', () => {
    expect(card._config.entities.map((e) => e.id)).toEqual(['geo_location.pl_1']);
    expect(card._config.entities[0].size).toBe(60);
  });

  it('setConfig before any hass: no entities yet, and no error', () => {
    const c = new MapCard();
    c.setConfig(config);
    expect(c._config.entities).toEqual([]);
    expect(c.setupNeeded).toBe(true);
  });

  it('the first render after hass arrives fills the list before the map is built', () => {
    const c = new MapCard();
    c.setConfig(config);
    c.hass = hassWith({ 'geo_location.s_1': ship('geo_location.s_1') });
    c._applyEntityFilter();
    expect(c._config.entities.map((e) => e.id)).toEqual(['geo_location.s_1']);
  });

  it('an arrival updates the map in place, presence too', () => {
    card.hass = hassWith({ ...card.hass.states, 'geo_location.s_1': ship('geo_location.s_1') });
    card._applyEntityFilter();
    const passed = card.entitiesRenderService.updateEntityConfigs.mock.calls[0][0];
    expect(passed.map((e) => e.id)).toEqual(['geo_location.pl_1', 'geo_location.s_1']);
    expect(card.presenceRenderService.setEntities).toHaveBeenCalledWith(passed);
    expect(card.setupNeeded).toBe(false);
  });

  it('a moving entity changes nothing on the map\'s list', () => {
    card.hass = hassWith({ 'geo_location.pl_1': plane('geo_location.pl_1', 38.8) });
    card._applyEntityFilter();
    card.hass = hassWith({ 'geo_location.pl_1': plane('geo_location.pl_1', 38.9) });
    card._applyEntityFilter();
    expect(card.entitiesRenderService.updateEntityConfigs).not.toHaveBeenCalled();
  });

  it('the kept entity keeps its EntityConfig object across an update', () => {
    const first = card._config.entities[0];
    card.hass = hassWith({ ...card.hass.states, 'geo_location.s_1': ship('geo_location.s_1') });
    card._applyEntityFilter();
    expect(card._config.entities[0]).toBe(first);
  });

  it('a departure updates the map in place', () => {
    card.hass = hassWith({});
    card._applyEntityFilter();
    expect(card.entitiesRenderService.updateEntityConfigs.mock.calls[0][0]).toEqual([]);
  });

  it('render() runs the filter first', () => {
    const spy = jest.spyOn(card, '_applyEntityFilter');
    card.map = undefined;
    card.render();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('while a setup is pending the list is only prepared, not pushed to the services', () => {
    card.setupNeeded = true;
    card.hass = hassWith({ ...card.hass.states, 'geo_location.s_1': ship('geo_location.s_1') });
    card._applyEntityFilter();
    expect(card.entitiesRenderService.updateEntityConfigs).not.toHaveBeenCalled();
    expect(card._config.entities.map((e) => e.id)).toEqual(['geo_location.pl_1', 'geo_location.s_1']);
  });

  it('the dashboard\'s own entities come first and win; changing only them keeps the filter\'s work', () => {
    const cfg = { ...config, entities: [{ entity: 'geo_location.pl_1', color: '#123456' }] };
    const c = built(cfg, { 'geo_location.pl_1': plane('geo_location.pl_1'), 'geo_location.s_1': ship('geo_location.s_1') });
    expect(c._config.entities.map((e) => e.id)).toEqual(['geo_location.pl_1', 'geo_location.s_1']);
    expect(c._config.entities[0].color).toBe('#123456');
    const engine = c._entityFilter;
    c.setConfig({ ...cfg, entities: [] });
    expect(c._entityFilter).toBe(engine);
    expect(c.setupNeeded).toBe(false);
    const passed = c.entitiesRenderService.updateEntityConfigs.mock.calls[0][0];
    expect(passed.map((e) => e.id)).toEqual(['geo_location.pl_1', 'geo_location.s_1']);
    expect(passed[0].size).toBe(60);
  });

  it('a changed filter rebuilds the map with a new engine', () => {
    const engine = card._entityFilter;
    card.setConfig({ ...config, entity_filter: { include: [{ domain: 'person' }] } });
    expect(card.setupNeeded).toBe(true);
    expect(card._entityFilter).not.toBe(engine);
    expect(card._config.entities).toEqual([]);
  });

  it('removing the filter drops the engine', () => {
    card.setConfig({ type: 'custom:live-track-map-card', x: 38.7, y: -9.1, zoom: 9 });
    expect(card._entityFilter).toBeUndefined();
    card._applyEntityFilter();
    expect(card._config.entities).toEqual([]);
  });

  it('a malformed filter is refused and the map is left alone', () => {
    const before = card.config;
    expect(() => card.setConfig({ ...config, entity_filter: { include: [{ area: 'x' }] } })).toThrow(/area/);
    expect(card.config).toBe(before);
    expect(card.setupNeeded).toBe(false);
  });

  it('a failure while filtering keeps the last list and never throws out of render', () => {
    const before = card._config.entities;
    card._entityFilter.update = () => { throw new Error('boom'); };
    card.hass = hassWith({});
    expect(() => card._applyEntityFilter()).not.toThrow();
    expect(card._config.entities).toBe(before);
    expect(card.entitiesRenderService.updateEntityConfigs).not.toHaveBeenCalled();
  });

  it('a card without a filter is untouched by render\'s filter step', () => {
    const c = new MapCard();
    c.hass = hassWith({ 'geo_location.pl_1': plane('geo_location.pl_1') });
    c.setConfig({ type: 'custom:live-track-map-card', x: 38.7, y: -9.1, entities: ['geo_location.pl_1'] });
    const list = c._config.entities;
    c._applyEntityFilter();
    expect(c._config.entities).toBe(list);
  });

  it('the overview takes names from a rule\'s options, rebuilt only when the list changes', () => {
    const c = built(config, { 'person.ana_lopez': st('person.ana_lopez', 'not_home', {}) });
    const names = c._overviewNames();
    expect(names.get('person.ana_lopez')).toBe('Ana');
    expect(c._overviewNames()).toBe(names);
    c.hass = hassWith({ ...c.hass.states, 'geo_location.s_1': ship('geo_location.s_1') });
    c._applyEntityFilter();
    expect(c._overviewNames()).not.toBe(names);
  });
});
