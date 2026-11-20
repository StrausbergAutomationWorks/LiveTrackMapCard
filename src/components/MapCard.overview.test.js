import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';

const mockSvc = {
  enabled: true, entityIds: ['person.ana'], setOverview: jest.fn(), focus: jest.fn(() => true),
  zoneColor: jest.fn(() => '#123456'), setEntities: jest.fn(), render: jest.fn(), drawsId: jest.fn(), setup: jest.fn(), cleanup: jest.fn(),
};
jest.mock('../presence/PresenceRenderService.js', () => ({ __esModule: true, default: jest.fn().mockImplementation(() => mockSvc) }));
jest.mock('lit', () => ({
  LitElement: class LitElement {
    static get properties() { return {}; }
    static get styles() { return ''; }
    requestUpdate() {}
    connectedCallback() {}
    disconnectedCallback() {}
  },
  html: (strings) => strings.join(''),
  css: (strings) => strings.join(''),
  nothing: undefined,
}));
jest.mock('../util/Logger.js');

import MapCard from './MapCard.js';

// Step 2 (Lee 2026-11-19): the card shows the overview in a panel view (or with `overview: true`),
// keeps its selection in the URL as Home Assistant does, and hands tab and selection to the presence service.

let card, map;
// The test card is not a DOM node (LitElement is replaced); it is hung under a wrapper as auto-entities hangs it.
const panel = (inPanel) => {
  const view = document.createElement(inPanel ? 'hui-panel-view' : 'div');
  document.body.appendChild(view);
  const wrapper = document.createElement('div');
  view.appendChild(wrapper);
  card.parentNode = wrapper;
  return view;
};
const setPhone = (phone) => { globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} }); };

beforeEach(() => {
  jest.clearAllMocks();
  history.replaceState(null, '', '/live-track-map/railair-map');
  setPhone(false);
  card = new MapCard();
  card.requestUpdate = jest.fn();
  card._config = { overview: undefined, presenceMarkers: true };
  card.presenceRenderService = mockSvc;
  card.initialViewRenderService = { setup: jest.fn() };
  map = { on: jest.fn(), getContainer: () => box };
  card.map = map;
  mockSvc.enabled = true;
});
afterEach(() => { document.body.innerHTML = ''; });

let box;
beforeEach(() => {
  box = document.createElement('div');
  box.innerHTML = '<div class="leaflet-top leaflet-left"></div><div class="leaflet-bottom leaflet-left"></div><div class="leaflet-bottom leaflet-right"></div>';
});

describe('when the overview shows', () => {
  it('in a panel view, found through a wrapper card', () => {
    panel(true);
    card._setupOverview();
    expect(card._overviewOn).toBe(true);
    expect(mockSvc.setOverview).toHaveBeenCalledWith({ shown: true, tab: 'people', selected: undefined });
    expect(typeof mockSvc.onSelect).toBe('function');
    expect(map.on).toHaveBeenCalledWith('click', card._onMapClick);
  });
  it('not outside a panel view, unless the option says so', () => {
    panel(false);
    card._setupOverview();
    expect(card._overviewOn).toBe(false);
    card._config.overview = true;
    card._setupOverview();
    expect(card._overviewOn).toBe(true);
  });
  it('never with overview: false, nor with the presence markers off', () => {
    panel(true);
    card._config.overview = false;
    card._setupOverview();
    expect(card._overviewOn).toBe(false);
    card._config.overview = true;
    mockSvc.enabled = false;
    card._setupOverview();
    expect(card._overviewOn).toBe(false);
  });
  it('a selection in the URL is taken at setup, and focused once the initial view is set', () => {
    jest.useFakeTimers();
    history.replaceState(null, '', '/live-track-map/railair-map?entity_id=zone.home');
    panel(true);
    card._setupOverview();
    expect(card._overviewSelected).toBe('zone.home');
    expect(mockSvc.focus).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(mockSvc.focus).toHaveBeenCalledWith('zone.home', {});
    jest.useRealTimers();
  });
  it('the URL naming something else (a light) selects nothing', () => {
    history.replaceState(null, '', '/x?entity_id=light.kitchen');
    panel(true);
    card._setupOverview();
    expect(card._overviewSelected).toBeUndefined();
  });
});

describe('selecting', () => {
  beforeEach(() => { panel(true); card._setupOverview(); jest.clearAllMocks(); });

  it('records the selection in the URL, tells the service, focuses it with the panel padding', () => {
    const changed = jest.fn();
    window.addEventListener('location-changed', changed);
    card._overviewSize = { width: 360, height: 400 };
    card._overviewSelect('person.ana');
    expect(location.search).toBe('?entity_id=person.ana');
    expect(changed).toHaveBeenCalled();
    expect(mockSvc.setOverview).toHaveBeenCalledWith({ shown: true, tab: 'people', selected: 'person.ana' });
    expect(mockSvc.focus).toHaveBeenCalledWith('person.ana', { left: 384 });
    window.removeEventListener('location-changed', changed);
  });
  it('clearing removes it from the URL and returns the map to its initial view', () => {
    card._overviewSelect('person.ana');
    card._overviewSelect(undefined);
    expect(location.search).toBe('');
    expect(card.initialViewRenderService.setup).toHaveBeenCalledTimes(1);
    expect(mockSvc.setOverview).toHaveBeenLastCalledWith({ shown: true, tab: 'people', selected: undefined });
  });
  it('clearing when nothing was selected does nothing; the same selection again only refocuses', () => {
    card._overviewSelect(undefined);
    expect(card.initialViewRenderService.setup).not.toHaveBeenCalled();
    card._overviewSelect('person.ana');
    mockSvc.setOverview.mockClear();
    card._overviewSelect('person.ana');
    expect(mockSvc.setOverview).not.toHaveBeenCalled();
    expect(mockSvc.focus).toHaveBeenCalledTimes(2);
  });
  it('a tap on the map clears it; with nothing selected it does nothing', () => {
    card._onMapClick();
    expect(card.initialViewRenderService.setup).not.toHaveBeenCalled();
    card._overviewSelect('zone.home');
    card._onMapClick();
    expect(card._overviewSelected).toBeUndefined();
  });
  it('the service hears taps: a tap on a marker selects it', () => {
    mockSvc.onSelect('person.ana');
    expect(card._overviewSelected).toBe('person.ana');
  });
  it("the panel's own events select and clear", () => {
    card._onOverviewSelect({ detail: { entityId: 'zone.home' } });
    expect(card._overviewSelected).toBe('zone.home');
    card._onOverviewSelect({ detail: { entityId: undefined } });
    expect(card._overviewSelected).toBeUndefined();
  });
  it('back and forward follow the URL on this page, and push nothing', () => {
    const push = jest.spyOn(history, 'pushState');
    history.replaceState(null, '', '/live-track-map/railair-map?entity_id=person.ana');
    card._syncSelection();
    expect(card._overviewSelected).toBe('person.ana');
    expect(push).not.toHaveBeenCalled();
    history.replaceState(null, '', '/another/page?entity_id=zone.home');
    card._syncSelection();
    expect(card._overviewSelected).toBe('person.ana');
    push.mockRestore();
  });
  it('without the overview a selection is refused', () => {
    card._overviewOn = false;
    card._overviewSelect('person.ana');
    expect(card._overviewSelected).toBeUndefined();
    expect(location.search).toBe('');
  });
});

describe('tabs, size and insets', () => {
  beforeEach(() => { panel(true); card._setupOverview(); jest.clearAllMocks(); });

  it('a tab is handed to the service; the same tab again is ignored', () => {
    card._onOverviewTab({ detail: { tab: 'devices' } });
    expect(card._overviewTab).toBe('devices');
    expect(mockSvc.setOverview).toHaveBeenCalledWith({ shown: true, tab: 'devices', selected: undefined });
    card._onOverviewTab({ detail: { tab: 'devices' } });
    card._onOverviewTab({ detail: {} });
    expect(mockSvc.setOverview).toHaveBeenCalledTimes(1);
  });
  it('desktop: the left controls move beside the panel (width + 24)', () => {
    card._onOverviewResize({ detail: { width: 360, height: 200 } });
    expect(card._leftInset()).toBe(384);
    expect(box.querySelector('.leaflet-top.leaflet-left').style.left).toBe('384px');
    expect(box.querySelector('.leaflet-bottom.leaflet-left').style.left).toBe('384px');
    expect(box.querySelector('.leaflet-bottom.leaflet-right').style.bottom).toBe('');
  });
  it('phone: no side inset; the bottom controls sit above the sheet', () => {
    setPhone(true);
    card._onOverviewResize({ detail: { width: 390, height: 370, fitHeight: 370 } });
    expect(card._leftInset()).toBe(0);
    expect(box.querySelector('.leaflet-top.leaflet-left').style.left).toBe('');
    expect(box.querySelector('.leaflet-bottom.leaflet-right').style.bottom).toBe('378px');
    expect(card._overviewPaddingNow()).toEqual({ bottom: 382 });
  });
  it('a collapsed or gone panel takes no space', () => {
    card._onOverviewResize({ detail: { width: 360, height: 200 } });
    card._onOverviewResize({ detail: { width: 360, height: 0 } });
    expect(card._overviewSize).toEqual({ width: 0, height: 0 });
    expect(box.querySelector('.leaflet-top.leaflet-left').style.left).toBe('');
    expect(card._overviewPaddingNow()).toBeUndefined();
  });
  it("a selection is refocused when the panel's padding changes, not when it stays", () => {
    card._overviewSelect('person.ana');
    mockSvc.focus.mockClear();
    card._onOverviewResize({ detail: { width: 360, height: 300 } });
    expect(mockSvc.focus).toHaveBeenCalledWith('person.ana', { left: 384 });
    mockSvc.focus.mockClear();
    card._onOverviewResize({ detail: { width: 360, height: 420 } });
    expect(mockSvc.focus).not.toHaveBeenCalled();
  });
});

describe('names and colours for the panel', () => {
  it('a dashboard name: per entity, from the raw entries', () => {
    card.config = { entities: ['person.ben', { entity: 'person.ana', name: 'Mom' }, { entity: 'zone.home' }] };
    expect([...card._overviewNames()]).toEqual([['person.ana', 'Mom']]);
    expect(card._overviewNames()).toBe(card._overviewNames());
  });
  it("a zone's colour comes from the presence service", () => {
    expect(card._overviewZoneColor('zone.home')).toBe('#123456');
    expect(mockSvc.zoneColor).toHaveBeenCalledWith({ id: 'zone.home' });
    card.presenceRenderService = undefined;
    expect(card._overviewZoneColor('zone.home')).toBe('var(--primary-color)');
  });
});
