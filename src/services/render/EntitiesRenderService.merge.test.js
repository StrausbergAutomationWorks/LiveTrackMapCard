import { jest, describe, it, expect } from '@jest/globals';
import EntitiesRenderService from './EntitiesRenderService.js';
import { LatLngBounds } from 'leaflet';

jest.mock('leaflet');
jest.mock('leaflet.markercluster', () => ({}));
jest.mock('../../util/Logger.js');

// 06_MAP_CONTRACT.md D11: a duplicate from another source is hidden with
// Entity.hide(), not updated, and left out of fit-to-bounds. Recomputed on
// every render, so a pair that parts is drawn again.

/**
 * @param {string} id
 * @param {object} attributes
 * @param {{lat: number, lng: number}} latLng
 * @returns {object} a stand-in Entity
 */
function fakeEntity(id, attributes, latLng = { lat: 59.4, lng: 10.7 }) {
  return { id, attributes, config: { id, focusOnFit: true }, latLng, update: jest.fn(), hide: jest.fn() };
}

const SAR = { source: 'live_track_ships', object_kind: 'sar_aircraft', map_layer: 'air_low' };
const AIR = { source: 'live_track_aircraft', map_layer: 'air' };

/**
 * @param {Set<string>} [stale]
 * @returns {EntitiesRenderService}
 */
function service(stale = new Set()) {
  const svc = new EntitiesRenderService({}, {}, { isNone: true }, [], null, null, null, false, false, (id) => stale.has(id));
  svc.entities = [fakeEntity('geo_location.sar', SAR), fakeEntity('geo_location.plane', AIR)];
  return svc;
}

describe('EntitiesRenderService and merged duplicates', () => {
  it('hides the loser and updates the winner', async () => {
    const svc = service();
    await svc.render({ states: {} });
    const [sar, plane] = svc.entities;
    expect(sar.hide).toHaveBeenCalled();
    expect(sar.update).not.toHaveBeenCalled();
    expect(plane.update).toHaveBeenCalled();
    expect(plane.hide).not.toHaveBeenCalled();
  });

  it('draws the loser again once the pair parts', async () => {
    const svc = service();
    await svc.render({ states: {} });
    svc.entities[1].latLng = { lat: 60.5, lng: 10.7 };
    await svc.render({ states: {} });
    expect(svc.entities[0].update).toHaveBeenCalledTimes(1);
  });

  it('a stale winner does not suppress the loser', async () => {
    const svc = service(new Set(['geo_location.plane']));
    await svc.render({ states: {} });
    expect(svc.entities[0].update).toHaveBeenCalled();
    expect(svc.entities[1].hide).toHaveBeenCalled();
  });

  it('an entity without a position takes no part', async () => {
    const svc = service();
    svc.entities[1].latLng = null;
    await svc.render({ states: {} });
    expect(svc.entities[0].update).toHaveBeenCalled();
  });

  it('leaves a merged entity out of the fit-to-bounds', () => {
    const svc = service();
    svc.entities[0].latLng = { lat: 59.401, lng: 10.7 };
    svc.map = { once: jest.fn(), fitBounds: jest.fn() };
    svc.computeMerged();
    svc.setInitialView();
    expect(LatLngBounds.mock.calls.at(-1)[0]).toEqual([{ lat: 59.4, lng: 10.7 }]);
  });

  it('a throw in the merge draws everything rather than nothing', async () => {
    const svc = service();
    Object.defineProperty(svc.entities[0], 'attributes', { get() { throw new Error('boom'); } });
    await svc.render({ states: {} });
    expect(svc.entities[0].update).toHaveBeenCalled();
    expect(svc.entities[1].update).toHaveBeenCalled();
  });
});
