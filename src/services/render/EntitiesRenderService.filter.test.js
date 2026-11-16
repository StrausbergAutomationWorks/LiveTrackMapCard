import { jest, describe, it, expect } from '@jest/globals';
import EntitiesRenderService from './EntitiesRenderService.js';
import { LatLngBounds } from 'leaflet';

jest.mock('leaflet');
jest.mock('leaflet.markercluster', () => ({}));
jest.mock('../../util/Logger.js');

// D4f, backlog 345: an entity whose group the viewer hid is hidden, not
// updated, not merged with another source's marker, not credited, and does
// not pull the fit-to-bounds; showing the group again draws it again.

function fakeEntity(id, attributes = {}) {
  return { id, attributes, config: { id, focusOnFit: true }, latLng: { lat: 41, lng: -88 }, update: jest.fn(), hide: jest.fn() };
}

function service(filtered, entities) {
  const svc = new EntitiesRenderService({}, {}, { isNone: true }, [], null, null, null, false, false, null, (id) => filtered.has(id));
  svc.entities = entities ?? [fakeEntity('geo_location.vessel_1'), fakeEntity('geo_location.vessel_2')];
  return svc;
}

describe('EntitiesRenderService and the viewer\'s group filter', () => {
  it('hides a filtered entity and updates the rest', async () => {
    const svc = service(new Set(['geo_location.vessel_2']));
    await svc.render({ states: {} });
    const [a, b] = svc.entities;
    expect(a.update).toHaveBeenCalled();
    expect(a.hide).not.toHaveBeenCalled();
    expect(b.hide).toHaveBeenCalled();
    expect(b.update).not.toHaveBeenCalled();
    expect(svc.isHidden('geo_location.vessel_2')).toBe(true);
  });

  it('draws it again once the group is shown', async () => {
    const filtered = new Set(['geo_location.vessel_2']);
    const svc = service(filtered);
    await svc.render({ states: {} });
    filtered.clear();
    await svc.render({ states: {} });
    expect(svc.entities[1].update).toHaveBeenCalledTimes(1);
  });

  it('hideMerged also hides a filtered entity (a new entity from auto-entities is hidden at once)', () => {
    const svc = service(new Set(['geo_location.vessel_1']));
    svc.merged = new Set();
    svc.hideMerged();
    expect(svc.entities[0].hide).toHaveBeenCalled();
    expect(svc.entities[1].hide).not.toHaveBeenCalled();
  });

  it('a filtered entity is no candidate for the D11 merge', () => {
    // A Ships SAR aircraft and Live Track Aircraft's same airframe: hiding
    // Ships' SAR group must not take the Aircraft marker with it.
    const ships = fakeEntity('geo_location.vessel_111232506', { source: 'live_track_ships', object_kind: 'sar_aircraft', object_ids: { mmsi: '111232506' } });
    const svc = service(new Set(['geo_location.vessel_111232506']), [ships]);
    svc.computeMerged();
    expect(svc.merged.size).toBe(0);
  });

  it('leaves a filtered entity out of the fit-to-bounds', () => {
    const svc = service(new Set(['geo_location.vessel_2']));
    svc.entities[1].latLng = { lat: 10, lng: 10 };
    svc.map = { once: jest.fn(), fitBounds: jest.fn() };
    svc.setInitialView();
    const points = LatLngBounds.mock.calls.at(-1)[0];
    expect(points).toEqual([{ lat: 41, lng: -88 }]);
  });

  it('a filtered entity is not credited', () => {
    const ctl = { addAttribution: jest.fn(), removeAttribution: jest.fn() };
    const svc = service(new Set(['geo_location.vessel_2']), [
      fakeEntity('geo_location.vessel_1', { attribution: 'Data: one' }),
      fakeEntity('geo_location.vessel_2', { attribution: 'Data: two' }),
    ]);
    svc.map = { attributionControl: ctl };
    svc.refreshCredits();
    expect(svc.credits).toContain('Data: one');
    expect(svc.credits).not.toContain('Data: two');
  });

  it('filters nothing when no check is given', async () => {
    const svc = new EntitiesRenderService({}, {}, { isNone: true }, [], null, null, null, false, false);
    svc.entities = [fakeEntity('geo_location.a')];
    await svc.render({ states: {} });
    expect(svc.entities[0].update).toHaveBeenCalled();
  });
});
