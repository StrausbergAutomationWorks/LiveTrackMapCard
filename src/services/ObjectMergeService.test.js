import { describe, it, expect } from '@jest/globals';
import { mergedAway, parseObjectIds, distanceKm, toItem } from './ObjectMergeService.js';

// 06_MAP_CONTRACT.md D11 (Lee, 2026-09-24): one object, one marker.

const ship = (id, extra = {}) => ({
  id, lat: 59.40, lng: 10.70,
  attributes: { source: 'live_track_ships', map_layer: 'water', ...extra },
});
const sar = (id, extra = {}) => ship(id, { object_kind: 'sar_aircraft', map_layer: 'air_low', ...extra });
const plane = (id, extra = {}) => ({
  id, lat: 59.40, lng: 10.70,
  attributes: { source: 'live_track_aircraft', map_layer: 'air', ...extra },
});
const at = (e, lat, lng) => ({ ...e, lat, lng });

describe('parseObjectIds', () => {
  it('keeps only listed keys in their normalised string form', () => {
    expect(parseObjectIds({
      mmsi: '111257002', imo: '9321483', icao24: '4aaa4b', registration: 'SE-JRK', callsign: 'SE JRK',
    })).toEqual([['mmsi', '111257002'], ['imo', '9321483'], ['icao24', '4aaa4b'], ['registration', 'SE-JRK']]);
  });
  it('drops malformed values rather than repairing them', () => {
    expect(parseObjectIds({
      mmsi: 111257002, imo: '932148', icao24: '4AAA4B', registration: 'se-jrk',
    })).toEqual([]);
    expect(parseObjectIds({ mmsi: ' 111257002' })).toEqual([]);
  });
  it('treats a missing or non-object attribute as no identifiers', () => {
    for (const v of [undefined, null, 'x', 5, ['mmsi']]) expect(parseObjectIds(v)).toEqual([]);
  });
});

describe('distanceKm', () => {
  it('is about 111 km per degree of latitude', () => {
    expect(distanceKm(0, 0, 1, 0)).toBeCloseTo(111.2, 0);
    expect(distanceKm(59.4, 10.7, 59.4, 10.7)).toBe(0);
  });
});

describe('mergedAway: identity', () => {
  it('hides the lower-precedence entity when two sources share an identifier', () => {
    const a = sar('geo_location.a_vessel', { object_ids: { mmsi: '111257002', registration: 'SE-JRK' } });
    const b = plane('geo_location.z_aircraft', { object_ids: { icao24: '4aaa4b', registration: 'SE-JRK' } });
    // far apart: identity alone decides
    expect(mergedAway([a, at(b, 40, -88)])).toEqual(new Set(['geo_location.a_vessel']));
  });
  it('never merges two entities of the same source', () => {
    const a = ship('geo_location.v1', { object_ids: { mmsi: '257000001' } });
    const b = ship('geo_location.v2', { object_ids: { mmsi: '257000001' } });
    expect(mergedAway([a, b]).size).toBe(0);
  });
  it('needs the same key: an equal value under a different key is not a match', () => {
    const a = ship('geo_location.v', { object_ids: { mmsi: '123456789' } });
    const b = { ...plane('geo_location.p'), attributes: { source: 'x', object_ids: { imo: '1234567' } } };
    expect(mergedAway([a, b]).size).toBe(0);
  });
  it('without listed precedence, the entity_id that sorts first wins', () => {
    const a = { id: 'geo_location.b', lat: 1, lng: 1, attributes: { source: 's1', object_ids: { imo: '9321483' } } };
    const b = { id: 'geo_location.a', lat: 1, lng: 1, attributes: { source: 's2', object_ids: { imo: '9321483' } } };
    expect(mergedAway([a, b])).toEqual(new Set(['geo_location.b']));
    expect(mergedAway([b, a])).toEqual(new Set(['geo_location.b']));
  });
  it('an entity with no source never merges', () => {
    const a = { id: 'geo_location.a', lat: 1, lng: 1, attributes: { object_ids: { imo: '9321483' } } };
    const b = { id: 'geo_location.b', lat: 1, lng: 1, attributes: { source: 's', object_ids: { imo: '9321483' } } };
    expect(mergedAway([a, b]).size).toBe(0);
  });
});

describe('mergedAway: proximity, only for the listed pair', () => {
  it('merges a Ships SAR aircraft within 1 km of a Live Track Aircraft entity; aircraft wins', () => {
    // 'geo_location.a...' sorts before 'geo_location.v...': precedence, not id order, decides
    const s = sar('geo_location.a_sar');
    const p = at(plane('geo_location.z_plane'), 59.405, 10.70); // ~0.56 km
    expect(mergedAway([s, p])).toEqual(new Set(['geo_location.a_sar']));
  });
  it('does not merge beyond 1 km', () => {
    const p = at(plane('geo_location.p'), 59.41, 10.70); // ~1.1 km
    expect(mergedAway([sar('geo_location.s'), p]).size).toBe(0);
  });
  it('does not merge when both carry speed and they differ by more than 60 km/h', () => {
    const s = sar('geo_location.s', { speed_kmh: 100 });
    expect(mergedAway([s, plane('geo_location.p', { speed_kmh: 161 })]).size).toBe(0);
    expect(mergedAway([s, plane('geo_location.p', { speed_kmh: 160 })])).toEqual(new Set(['geo_location.s']));
  });
  it('ignores speed when either side lacks it', () => {
    expect(mergedAway([sar('geo_location.s', { speed_kmh: 0 }), plane('geo_location.p')])).toEqual(new Set(['geo_location.s']));
  });
  it('never merges an ordinary vessel with an aircraft on proximity', () => {
    expect(mergedAway([ship('geo_location.v'), plane('geo_location.p')]).size).toBe(0);
  });
  it('two boats rafted together stay two boats', () => {
    const other = { id: 'geo_location.o', lat: 59.40, lng: 10.70, attributes: { source: 'other_ais' } };
    expect(mergedAway([ship('geo_location.v'), other]).size).toBe(0);
  });
  it('two aircraft near one SAR helicopter both stay; only the SAR marker goes', () => {
    const p1 = plane('geo_location.p1');
    const p2 = at(plane('geo_location.p2'), 59.402, 10.70);
    expect(mergedAway([p1, sar('geo_location.s'), p2])).toEqual(new Set(['geo_location.s']));
  });
  it('without map_layer yet, the aircraft still wins because its id sorts first', () => {
    const s = { id: 'geo_location.vessel_111257002', lat: 59.4, lng: 10.7,
      attributes: { source: 'live_track_ships', object_kind: 'sar_aircraft' } };
    const p = { id: 'geo_location.aircraft_4aaa4b', lat: 59.4, lng: 10.7,
      attributes: { source: 'live_track_aircraft' } };
    expect(mergedAway([s, p])).toEqual(new Set(['geo_location.vessel_111257002']));
  });
  it('skips proximity for an entity without a finite position', () => {
    const s = { ...sar('geo_location.s'), lat: undefined };
    expect(mergedAway([s, plane('geo_location.p')]).size).toBe(0);
  });
});

describe('toItem', () => {
  it('tolerates missing attributes', () => {
    expect(toItem({ id: 'x', lat: 1, lng: 2 })).toMatchObject({ id: 'x', source: null, ids: [] });
  });
});
