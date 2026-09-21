import { jest, describe, it, expect } from '@jest/globals';
import EntitiesRenderService from './EntitiesRenderService.js';
import { LatLngBounds } from 'leaflet';

jest.mock('leaflet');
jest.mock('leaflet.markercluster', () => ({}));
jest.mock('../../util/Logger.js');

// An entity HaStaleStateService has recorded is hidden, not updated, and
// does not pull the map's fit-to-bounds towards where it was last seen.

/**
 * @param {string} id
 * @returns {object} a stand-in Entity
 */
function fakeEntity(id) {
  return { id, config: { id, focusOnFit: true }, latLng: { lat: 41, lng: -88 }, update: jest.fn(), hide: jest.fn() };
}

/**
 * @param {Set<string>} stale ids to report as stale
 * @returns {EntitiesRenderService} with a live and a ghost entity
 */
function service(stale) {
  const focus = { isNone: true };
  const svc = new EntitiesRenderService({}, {}, focus, [], null, null, null, false, false, (id) => stale.has(id));
  svc.entities = [fakeEntity('geo_location.live'), fakeEntity('geo_location.ghost')];
  return svc;
}

describe('EntitiesRenderService and stale entities', () => {
  it('hides a stale entity and updates the rest', async () => {
    const svc = service(new Set(['geo_location.ghost']));
    await svc.render({ states: {} });
    const [live, ghost] = svc.entities;
    expect(live.update).toHaveBeenCalled();
    expect(live.hide).not.toHaveBeenCalled();
    expect(ghost.hide).toHaveBeenCalled();
    expect(ghost.update).not.toHaveBeenCalled();
  });

  it('updates an entity once it is no longer stale', async () => {
    const stale = new Set(['geo_location.ghost']);
    const svc = service(stale);
    await svc.render({ states: {} });
    stale.clear();
    await svc.render({ states: {} });
    expect(svc.entities[1].update).toHaveBeenCalledTimes(1);
  });

  it('leaves a stale entity out of the fit-to-bounds', () => {
    const svc = service(new Set(['geo_location.ghost']));
    svc.entities[1].latLng = { lat: 10, lng: 10 };
    svc.map = { once: jest.fn(), fitBounds: jest.fn() };
    svc.setInitialView();
    const points = LatLngBounds.mock.calls.at(-1)[0];
    expect(points).toEqual([{ lat: 41, lng: -88 }]);
  });

  it('treats nothing as stale when no check is given', async () => {
    const svc = new EntitiesRenderService({}, {}, { isNone: true }, [], null, null, null, false, false);
    svc.entities = [fakeEntity('geo_location.a')];
    await svc.render({ states: {} });
    expect(svc.entities[0].update).toHaveBeenCalled();
  });
});
