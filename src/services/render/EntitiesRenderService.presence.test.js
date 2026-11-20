import { jest, describe, it, expect } from '@jest/globals';
import EntitiesRenderService from './EntitiesRenderService.js';
import { LatLngBounds } from 'leaflet';
import MapConfig from '../../configs/MapConfig.js';
import { mergedAway } from '../ObjectMergeService';

jest.mock('leaflet');
jest.mock('leaflet.markercluster', () => ({}));
jest.mock('../../util/Logger.js');
jest.mock('../ObjectMergeService', () => ({ mergedAway: jest.fn(() => new Set()) }));

// Lee 2026-11-19: people, devices and zones are drawn by
// presence/PresenceRenderService. Here their markers stay off the map, they
// join no merge and no credit, but they still count when the map fits; every
// other entity is drawn exactly as before.

/**
 * @param {string} id
 * @param {object} [attributes]
 * @param {object} [latLng]
 * @returns {object} a stand-in Entity
 */
function fakeEntity(id, attributes = {}, latLng = { lat: 41, lng: -88 }) {
  return { id, attributes, config: { id, focusOnFit: true }, latLng, update: jest.fn(), hide: jest.fn() };
}

/**
 * @param {Set<string>} elsewhere ids drawn by presence
 * @returns {EntitiesRenderService}
 */
function service(elsewhere) {
  const svc = new EntitiesRenderService({}, {}, { isNone: true }, [], null, null, null, false, false);
  svc.drawnElsewhere = (id) => elsewhere.has(id);
  svc.entities = [fakeEntity('geo_location.flight', { attribution: 'Data: adsb' }), fakeEntity('person.ana', { attribution: 'Data: me' }, { lat: 10, lng: 10 })];
  return svc;
}

describe('EntitiesRenderService with presence drawing people', () => {
  it('hides a person drawn elsewhere; the Live Track entity is updated as before', async () => {
    const svc = service(new Set(['person.ana']));
    await svc.render({ states: {} });
    const [flight, lee] = svc.entities;
    expect(flight.update).toHaveBeenCalled();
    expect(flight.hide).not.toHaveBeenCalled();
    expect(lee.hide).toHaveBeenCalled();
    expect(lee.update).not.toHaveBeenCalled();
  });

  it('hideMerged hides it at once (a new entity from auto-entities)', () => {
    const svc = service(new Set(['person.ana']));
    svc.merged = new Set();
    svc.hideMerged();
    expect(svc.entities[1].hide).toHaveBeenCalled();
    expect(svc.entities[0].hide).not.toHaveBeenCalled();
  });

  it('is no merge candidate (D11 sees only the Live Track entity)', () => {
    const svc = service(new Set(['person.ana']));
    mergedAway.mockClear();
    svc.computeMerged();
    expect(mergedAway.mock.calls[0][0].map((c) => c.id)).toEqual(['geo_location.flight']);
  });

  it('is not credited', () => {
    const ctl = { addAttribution: jest.fn(), removeAttribution: jest.fn() };
    const svc = service(new Set(['person.ana']));
    svc.map = { attributionControl: ctl };
    svc.refreshCredits();
    expect(svc.credits).toContain('Data: adsb');
    expect(svc.credits).not.toContain('Data: me');
  });

  it('still counts when the map fits its entities', () => {
    const svc = service(new Set(['person.ana']));
    svc.map = { once: jest.fn(), fitBounds: jest.fn() };
    svc.setInitialView();
    const points = LatLngBounds.mock.calls.at(-1)[0];
    expect(points).toEqual([{ lat: 41, lng: -88 }, { lat: 10, lng: 10 }]);
  });

  it('draws everything itself when nothing is drawn elsewhere (the default)', async () => {
    const svc = new EntitiesRenderService({}, {}, { isNone: true }, [], null, null, null, false, false);
    svc.entities = [fakeEntity('person.ana')];
    await svc.render({ states: {} });
    expect(svc.entities[0].update).toHaveBeenCalled();
  });
});

describe('presence_markers option (MapConfig)', () => {
  it('on unless set to false', () => {
    expect(new MapConfig({ x: 41, y: -87 }).presenceMarkers).toBe(true);
    expect(new MapConfig({ x: 41, y: -87, presence_markers: false }).presenceMarkers).toBe(false);
    expect(new MapConfig({ x: 41, y: -87, presence_markers: 0 }).presenceMarkers).toBe(true);
  });
});
