import Entity from './Entity.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

const noop = jest.fn();

// D4a-shadow (Lee 2026-10-21): the altitude a picture marker's ground shadow
// is cast from, rounded to 50 m, written in place like the picture.
/**
 * An entity with one geo_location state.
 * @param {object} [opts] options
 * @param {string} [opts.display] the card's display mode
 * @param {string|null} [opts.picture] the entity_picture
 * @param {*} [opts.altitude] altitude_m, absent when undefined
 * @returns {{entity: Entity, hass: object}}
 */
function makeEntity({ display = 'marker', picture = 'https://ha/b737.svg', altitude } = {}) {
  const attributes = { friendly_name: 'X', entity_picture: picture, latitude: 41.9, longitude: -87.9 };
  if (altitude !== undefined) attributes.altitude_m = altitude;
  const hass = {
    states: { 'geo_location.x': { state: '1.0', attributes } },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => 'ATTR'),
    hassUrl: jest.fn(u => u),
  };
  const config = {
    id: 'geo_location.x', display, attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 60, color: 'transparent',
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  const entity = new Entity(config, hass, map, noop, noop, noop, false);
  return { entity, hass };
}

const html = (entity) => entity.createMapMarker().options.icon.options.html;

describe('groundShadowAltitude', () => {
  it.each([
    [9753.6, '9750'], [10058.4, '10050'], [99.1, '100'], [0, '0'], [-30, '0'], ['3048', '3050'],
  ])('altitude_m %p -> %p', (altitude, want) => {
    expect(makeEntity({ altitude }).entity.groundShadowAltitude).toBe(want);
  });

  it.each([undefined, null, '', ' ', 'level', true, false, NaN])('none for altitude_m %p', (altitude) => {
    expect(makeEntity({ altitude }).entity.groundShadowAltitude).toBe('');
  });

  it('none when the marker draws no picture', () => {
    expect(makeEntity({ display: 'icon', altitude: 9750 }).entity.groundShadowAltitude).toBe('');
    expect(makeEntity({ picture: null, altitude: 9750 }).entity.groundShadowAltitude).toBe('');
  });

  it('a bare picture has one', () => {
    expect(makeEntity({ display: 'attribute', altitude: 9750 }).entity.groundShadowAltitude).toBe('9750');
  });
});

describe('the marker element', () => {
  it('is built with the altitude', () => {
    const { entity } = makeEntity({ altitude: 9753.6 });
    expect(html(entity)).toContain('ground-shadow="9750"');
    expect(entity._currentGroundShadow).toBe('9750');
  });

  it('is built with an empty one when there is no altitude', () => {
    expect(html(makeEntity().entity)).toContain('ground-shadow=""');
  });
});

describe('a changed altitude', () => {
  /**
   * An entity whose marker is a stand-in for a live one.
   * @param {object} [opts] as makeEntity
   * @returns {object}
   */
  function withLiveMarker(opts) {
    const made = makeEntity(opts);
    const real = made.entity.createMapMarker();
    const el = { setAttribute: jest.fn() };
    const root = { querySelector: jest.fn(() => el) };
    const fake = { options: real.options, getElement: jest.fn(() => root), remove: jest.fn(), setLatLng: jest.fn() };
    made.entity.marker = fake;
    made.entity._lastSetLatLng = made.entity.latLng;
    made.entity._currentPlaceIcon = made.entity.placeIcon;
    made.entity._currentTitle = made.entity.title;
    const createSpy = jest.spyOn(made.entity, 'createMapMarker');
    return { ...made, fake, el, createSpy };
  }
  const setAlt = (hass, a) => { hass.states['geo_location.x'].attributes.altitude_m = a; };
  const shadowCalls = (el) => el.setAttribute.mock.calls.filter(([n]) => n === 'ground-shadow');

  it('is written onto the live element and the stored html, never a rebuild', async () => {
    const { entity, hass, el, fake, createSpy } = withLiveMarker({ altitude: 3000 });
    setAlt(hass, 3600);
    await entity.update();
    expect(shadowCalls(el)).toEqual([['ground-shadow', '3600']]);
    expect(fake.options.icon.options.html).toContain('ground-shadow="3600"');
    expect(fake.remove).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('a few metres inside the same 50 m step writes nothing', async () => {
    const { entity, hass, el } = withLiveMarker({ altitude: 3001 });
    setAlt(hass, 3010);
    await entity.update();
    expect(shadowCalls(el)).toEqual([]);
  });

  it('an altitude that goes away takes the shadow with it', async () => {
    const { entity, hass, el } = withLiveMarker({ altitude: 3000 });
    setAlt(hass, null);
    await entity.update();
    expect(shadowCalls(el)).toEqual([['ground-shadow', '']]);
  });
});
