import { jest, describe, it, expect } from '@jest/globals';
import EntitiesRenderService from './EntitiesRenderService.js';
import { creditLine } from '../../util/EntityCredits.js';

jest.mock('leaflet');
jest.mock('leaflet.markercluster', () => ({}));
jest.mock('../../util/Logger.js');

// Backlog 228: the box carries ONE credit line for the entities drawn now
// (not stale, not merged away, with a position), each source once.

const AMTRAK = 'Data from Amtraker (amtraker.com), ODC-By v1.0';
const SHIPS = 'Data: aisstream.io (https://aisstream.io)';

/**
 * A Leaflet attribution control that counts, as Leaflet's does.
 * @returns {object} the stand-in control, with `shown()` listing what it holds
 */
function control() {
  const count = new Map();
  return {
    count,
    addAttribution: jest.fn((t) => count.set(t, (count.get(t) ?? 0) + 1)),
    removeAttribution: jest.fn((t) => { count.set(t, (count.get(t) ?? 0) - 1); if (count.get(t) <= 0) count.delete(t); }),
    shown: () => [...count.keys()],
  };
}

/**
 * @param {string} id
 * @param {*} attribution
 * @param {{lat: number, lng: number}|null} latLng
 * @returns {object} a stand-in Entity
 */
function fakeEntity(id, attribution, latLng = { lat: 41.9, lng: -87.9 }) {
  return { id, attributes: { attribution }, config: { id, focusOnFit: false }, latLng, update: jest.fn(), hide: jest.fn() };
}

/**
 * @param {object} ctl the attribution control
 * @param {object[]} entities stand-in entities
 * @param {Set<string>} [stale]
 * @returns {EntitiesRenderService}
 */
function service(ctl, entities, stale = new Set()) {
  const svc = new EntitiesRenderService({ attributionControl: ctl }, {}, { isNone: true }, [], null, null, null, false, false,
    (id) => stale.has(id));
  svc.entities = entities;
  return svc;
}

describe('EntitiesRenderService: the credit line in the attribution box', () => {
  it('one line, each source once, however many of its entities are drawn', async () => {
    const ctl = control();
    const svc = service(ctl, [fakeEntity('geo_location.a1', AMTRAK), fakeEntity('geo_location.a2', AMTRAK),
      fakeEntity('geo_location.s1', SHIPS)]);
    await svc.render({ states: {} });
    expect(ctl.shown()).toEqual([creditLine([AMTRAK, SHIPS])]);
    expect(ctl.addAttribution).toHaveBeenCalledTimes(1);
  });

  it('a render that changes nothing touches nothing', async () => {
    const ctl = control();
    const svc = service(ctl, [fakeEntity('geo_location.a1', AMTRAK)]);
    await svc.render({ states: {} });
    await svc.render({ states: {} });
    expect(ctl.addAttribution).toHaveBeenCalledTimes(1);
    expect(ctl.removeAttribution).not.toHaveBeenCalled();
  });

  it('a source leaves the line when its last drawn entity goes', async () => {
    const ctl = control();
    const svc = service(ctl, [fakeEntity('geo_location.a1', AMTRAK), fakeEntity('geo_location.s1', SHIPS)]);
    await svc.render({ states: {} });
    svc.entities = [svc.entities[1]];
    await svc.render({ states: {} });
    expect(ctl.shown()).toEqual([creditLine([SHIPS])]);
    expect(svc.credits).toBe(creditLine([SHIPS]));
  });

  it('the line goes when nothing credited is drawn', async () => {
    const ctl = control();
    const svc = service(ctl, [fakeEntity('geo_location.a1', AMTRAK)]);
    await svc.render({ states: {} });
    svc.entities = [];
    await svc.render({ states: {} });
    expect(ctl.shown()).toEqual([]);
    expect(svc.credits).toBe('');
    expect(ctl.addAttribution).toHaveBeenCalledTimes(1);
  });

  it('a stale entity, or one with no position, credits nothing', async () => {
    const ctl = control();
    const svc = service(ctl, [fakeEntity('geo_location.a1', AMTRAK), fakeEntity('geo_location.s1', SHIPS, null)],
      new Set(['geo_location.a1']));
    await svc.render({ states: {} });
    expect(ctl.addAttribution).not.toHaveBeenCalled();
  });

  it('an entity merged away credits nothing (D11)', () => {
    const ctl = control();
    const svc = service(ctl, [fakeEntity('geo_location.a1', AMTRAK), fakeEntity('geo_location.s1', SHIPS)]);
    svc.merged = new Set(['geo_location.a1']);
    svc.refreshCredits();
    expect(ctl.shown()).toEqual([creditLine([SHIPS])]);
  });

  it('an entity with no attribution, or not a string, credits nothing', async () => {
    const ctl = control();
    const svc = service(ctl, [fakeEntity('geo_location.x', undefined), fakeEntity('geo_location.y', 42)]);
    await svc.render({ states: {} });
    expect(ctl.addAttribution).not.toHaveBeenCalled();
  });

  it('a map with no attribution control is left alone', async () => {
    const svc = new EntitiesRenderService({}, {}, { isNone: true }, [], null, null, null, false, false);
    svc.entities = [fakeEntity('geo_location.a1', AMTRAK)];
    await expect(svc.render({ states: {} })).resolves.toBeUndefined();
    expect(svc.credits).toBe('');
  });

  it('a control that throws does not stop the map drawing', async () => {
    const ctl = control();
    ctl.addAttribution.mockImplementation(() => { throw new Error('boom'); });
    const svc = service(ctl, [fakeEntity('geo_location.a1', AMTRAK)]);
    await svc.render({ states: {} });
    expect(svc.entities[0].update).toHaveBeenCalled();
  });
});
