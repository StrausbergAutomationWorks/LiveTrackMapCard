import { jest, describe, beforeEach, it, expect } from '@jest/globals';

const mockSetEntities = jest.fn();
const mockRender = jest.fn();
const mockDraws = jest.fn((id) => id === 'person.ana');
jest.mock('../presence/PresenceRenderService.js', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((map, options) => ({
    options, setEntities: mockSetEntities, render: mockRender, drawsId: mockDraws, setup: jest.fn(), cleanup: jest.fn(),
  })),
}));
jest.mock('lit', () => ({
  LitElement: class LitElement {
    static get properties() { return {}; }
    static get styles() { return ''; }
    requestUpdate() {}
    connectedCallback() {}
    disconnectedCallback() {}
  },
  html: (strings) => strings.join(''),
  css: (strings) => strings.join('')
}));
jest.mock('../util/Logger.js');

import MapCard from './MapCard.js';
import PresenceRenderService from '../presence/PresenceRenderService.js';

// Lee 2026-11-19: the card hands people, devices and zones to the presence
// service, which draws them as Home Assistant does; the option turns it off.
describe('MapCard and the presence markers', () => {
  let card;
  beforeEach(() => {
    jest.clearAllMocks();
    card = new MapCard();
    card.map = { remove: jest.fn() };
    card.entitiesRenderService = { updateEntityConfigs: jest.fn() };
  });

  it('builds the service with the option and the dashboard entities, and hands persons over', () => {
    const entities = [{ id: 'person.ana' }];
    card._config = { presenceMarkers: true, entities };
    card._setupPresence();
    expect(PresenceRenderService).toHaveBeenCalledWith(card.map, expect.objectContaining({ enabled: true }));
    expect(PresenceRenderService.mock.calls[0][1].styleHost()).toBe(card);
    expect(mockSetEntities).toHaveBeenCalledWith(entities);
    expect(card.entitiesRenderService.drawnElsewhere('person.ana')).toBe(true);
    expect(card.entitiesRenderService.drawnElsewhere('geo_location.flight')).toBe(false);
  });

  it('presence_markers: false reaches the service', () => {
    card._config = { presenceMarkers: false, entities: [] };
    card._setupPresence();
    expect(PresenceRenderService.mock.calls[0][1].enabled).toBe(false);
  });

  it('an in-place entity update reaches the service too', () => {
    card._config = { presenceMarkers: true, entities: [] };
    card._setupPresence();
    mockSetEntities.mockClear();
    card.config = { type: 'custom:live-track-map-card', x: 41.9, y: -88, entities: ['person.ana'] };
    card.setupNeeded = false;
    card.hasError = false;
    card.setConfig({ type: 'custom:live-track-map-card', x: 41.9, y: -88, entities: ['person.ana', 'person.ben'] });
    expect(mockSetEntities).toHaveBeenCalledTimes(1);
    expect(mockSetEntities.mock.calls[0][0].map((e) => e.id)).toEqual(['person.ana', 'person.ben']);
    expect(card.entitiesRenderService.updateEntityConfigs).toHaveBeenCalled();
  });

  it('render draws presence after the entities', () => {
    card._config = { presenceMarkers: true, entities: [] };
    card._setupPresence();
    const svc = () => ({ render: jest.fn() });
    Object.assign(card, {
      setupNeeded: false, hass: { states: {}, themes: {} }, themeMode: 'light',
      pluginsRenderService: svc(), tileLayersService: svc(), geoJsonRenderService: svc(), shapeLayersService: svc(),
      pointLayersService: svc(), radarOverlayService: svc(), initialViewRenderService: svc(),
    });
    card.entitiesRenderService.render = jest.fn();
    card._healSize = jest.fn();
    card._config.title = '';
    card._config.mapHeight = 400;
    card.render();
    expect(card.entitiesRenderService.render).toHaveBeenCalledWith(card.hass);
    expect(mockRender).toHaveBeenCalledWith(card.hass);
  });
});
