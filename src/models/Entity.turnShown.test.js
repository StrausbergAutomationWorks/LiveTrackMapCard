import Entity from './Entity.js';
import { jest, describe, it, expect, afterEach } from '@jest/globals';

// Card SSOT section 53: a picture's next turn continues from the angle it is
// AT on screen, not from the last number written. Seen live 2026-10-06: a
// vessel's element went 160 -> -43.1, a 203 deg turn the long way, because an
// update wrote its reported heading (125) and the slide starting in the same
// moment wrote the travel bearing (316.9) continuing from 125.

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

const noop = jest.fn();
let clock = 1000;
const nowSpy = jest.spyOn(performance, 'now').mockImplementation(() => clock);
afterEach(() => { clock = 1000; });

/**
 * @param {number} bearing the reported angle
 * @param {number} rotationTransition seconds
 * @returns {object} entity, hass and the writes made to the live element
 */
function live(bearing, rotationTransition) {
  const hass = {
    states: { 'geo_location.x': { state: '1', attributes: { friendly_name: 'X', latitude: 41.9, longitude: -87.9, icon_rotation_deg: bearing } } },
    formatEntityState: jest.fn(() => 'S'),
    formatEntityAttributeValue: jest.fn(() => 'A'),
    hassUrl: jest.fn((u) => u),
  };
  const config = {
    id: 'geo_location.x', display: 'marker', attribute: 'marker_label', prefix: '', suffix: '', label: null,
    size: 24, color: 'red', zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: 'icon_rotation_deg', rotationTransition,
  };
  const entity = new Entity(config, hass, { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) }, noop, noop, noop, false);
  const real = entity.createMapMarker();
  const el = { setAttribute: jest.fn() };
  entity.marker = { options: real.options, getElement: () => ({ querySelector: () => el }) };
  const writes = () => el.setAttribute.mock.calls.filter(([n, v]) => n === 'rotation' && v !== '').map(([, v]) => Number(v));
  const report = (v) => { hass.states['geo_location.x'].attributes.icon_rotation_deg = v; };
  return { entity, writes, report };
}

describe('_shownAngle', () => {
  it('is linear from `from` to `to` over `ms`, clamped at both ends', () => {
    const turn = { from: 0, to: 90, at: 1000, ms: 4000 };
    expect(Entity._shownAngle(turn, 900)).toBe(0);
    expect(Entity._shownAngle(turn, 1000)).toBe(0);
    expect(Entity._shownAngle(turn, 3000)).toBe(45);
    expect(Entity._shownAngle(turn, 5000)).toBe(90);
    expect(Entity._shownAngle(turn, 9000)).toBe(90);
  });
  it('a turn with no transition is already at `to`', () => {
    expect(Entity._shownAngle({ from: 0, to: 90, at: 1000, ms: 0 }, 1000)).toBe(90);
  });
});

describe('the next turn starts from the angle on screen', () => {
  it('the case seen live: reported heading then travel bearing in one moment turn the short way', () => {
    const { entity, writes, report } = live(160, 3);
    clock = 60000;
    report(125);
    entity.refreshMarkerRotation();
    entity._travel = 316.86;
    entity.refreshMarkerRotation();
    const last = writes().at(-1);
    expect(last).toBeCloseTo(316.86, 6);
    expect(last - 160).toBeCloseTo(156.86, 6);
  });

  it('a new angle mid-turn continues from where the picture is, not where it was going', () => {
    const { entity, writes, report } = live(0, 4);
    clock = 10000;
    report(90);
    entity.refreshMarkerRotation();
    clock = 12000;
    report(250);
    entity.refreshMarkerRotation();
    expect(writes()).toEqual([90, -110]);
  });

  it('once a turn is done, the next continues from its end, as before', () => {
    const { entity, writes, report } = live(350, 3);
    clock = 10000;
    report(10);
    entity.refreshMarkerRotation();
    clock = 20000;
    report(30);
    entity.refreshMarkerRotation();
    expect(writes()).toEqual([370, 390]);
  });

  it('with no transition the picture is always at the last angle written', () => {
    const { entity, writes, report } = live(350, 0);
    report(10);
    entity.refreshMarkerRotation();
    report(125);
    entity.refreshMarkerRotation();
    entity._travel = 316.86;
    entity.refreshMarkerRotation();
    expect(writes()[0]).toBe(370);
    expect(writes()[1]).toBe(485);
    expect(writes()[2]).toBeCloseTo(316.86, 6); // 485 - 168.14
  });

  it('each write is where the next turn starts: a full circle in thirds keeps going round', () => {
    const { entity, writes, report } = live(0, 0);
    for (const b of [120, 240, 0]) { report(b); entity.refreshMarkerRotation(); }
    expect(writes()).toEqual([120, 240, 360]);
  });

  it('a freshly built marker starts at its angle, with no turn in progress', () => {
    const { entity } = live(200, 3);
    expect(entity._turn).toEqual({ from: 200, to: 200, at: 1000, ms: 0 });
  });

  it('a cleared angle ends the turn; the next resumes continuously from the last angle', () => {
    const { entity, writes, report } = live(350, 3);
    clock = 10000;
    report(undefined);
    entity.refreshMarkerRotation();
    expect(entity._turn).toBeNull();
    report(10);
    entity.refreshMarkerRotation();
    expect(writes()).toEqual([370]);
  });
});

afterAll(() => nowSpy.mockRestore());
