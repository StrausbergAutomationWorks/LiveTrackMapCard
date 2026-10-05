import Entity from './Entity.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('./EntityHistoryManager.js');

// Backlog 275 (06_MAP_CONTRACT.md D4c): the entity hands the marker element
// delay-badge, delay-level and pulse, from delay_min and stalled alone, and
// re-decides them on every update, in place.

/**
 * A Metra train on a fake map.
 * @param {object} [o]
 * @param {object} [o.attrs] attributes to merge or, with undefined values, delete
 * @param {object} [o.config] EntityConfig fields to override
 * @returns {{entity: Entity, attributes: object}}
 */
function makeEntity({ attrs = {}, config = {} } = {}) {
  const attributes = {
    friendly_name: 'Metra 835', latitude: 41.9, longitude: -87.8, marker_label: '835',
    marker_color: '#0B3B8C', source: 'live_track_commuter_rail', delay_min: 12,
  };
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) delete attributes[k]; else attributes[k] = v;
  }
  const hass = {
    states: { 'geo_location.x': { state: '1', attributes } },
    formatEntityState: () => 'S', formatEntityAttributeValue: () => '835', hassUrl: (u) => u,
  };
  const cfg = {
    id: 'geo_location.x', display: 'attribute', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 28, color: '#757575', configuredColor: null,
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, positionTransition: 0, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 3,
    arrowAttribute: 'icon_rotation_deg', configuredLabelColor: null,
    ...config,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  return { entity: new Entity(cfg, hass, map, jest.fn(), jest.fn(), jest.fn(), false), attributes };
}

const attrIn = (html, name) => (html.match(new RegExp(`\\s${name}="([^"]*)"`)) ?? [])[1];

/**
 * An entity whose marker is a stand-in holding the real DivIcon html.
 * @param {object} [o] as makeEntity
 * @returns {object}
 */
function live(o) {
  const made = makeEntity(o);
  const real = made.entity.createMapMarker();
  const el = { setAttribute: jest.fn() };
  made.entity.marker = { options: real.options, getElement: () => ({ querySelector: () => el }),
    remove: jest.fn(), setLatLng: jest.fn(), getLatLng: jest.fn() };
  made.entity._lastSetLatLng = made.entity.latLng;
  made.entity._currentPlaceIcon = made.entity.placeIcon;
  made.entity._currentTitle = made.entity.title;
  const createSpy = jest.spyOn(made.entity, 'createMapMarker');
  const html = () => made.entity.marker.options.icon.options.html;
  return { ...made, el, createSpy, html };
}

describe('markerLateness', () => {
  it('12 minutes late, moving: amber badge, no pulse', () => {
    expect(makeEntity().entity.markerLateness).toEqual({ 'delay-badge': '+12', 'delay-level': 'amber', 'pulse': '' });
  });

  it('late and stalled: pulse', () => {
    expect(makeEntity({ attrs: { stalled: true } }).entity.markerLateness['pulse']).toBe('true');
  });

  it('is NOT dropped under a dashboard fill: it is data, not the emitter\'s styling', () => {
    const { entity } = makeEntity({ attrs: { stalled: true, delay_min: 15 }, config: { configuredColor: '#8B0000' } });
    expect(entity.markerLateness).toEqual({ 'delay-badge': '+15', 'delay-level': 'red', 'pulse': 'true' });
  });

  it('a string delay is no badge, and the label is never read', () => {
    const { entity } = makeEntity({ attrs: { delay_min: '12', marker_label: '835 +12', stalled: true } });
    expect(entity.markerLateness).toEqual({ 'delay-badge': '', 'delay-level': '', 'pulse': '' });
  });
});

describe('the marker element', () => {
  it('is built with the three attributes', () => {
    const html = makeEntity({ attrs: { stalled: true, delay_min: 21 } }).entity.createMapMarker().options.icon.options.html;
    expect(attrIn(html, 'delay-badge')).toBe('+21');
    expect(attrIn(html, 'delay-level')).toBe('red');
    expect(attrIn(html, 'pulse')).toBe('true');
  });

  it('is built with all three empty when on time, and the fill untouched either way', () => {
    const on = makeEntity({ attrs: { delay_min: 3, stalled: true } }).entity.createMapMarker().options.icon.options.html;
    expect(attrIn(on, 'delay-badge')).toBe('');
    expect(attrIn(on, 'delay-level')).toBe('');
    expect(attrIn(on, 'pulse')).toBe('');
    const late = makeEntity({ attrs: { stalled: true } }).entity.createMapMarker().options.icon.options.html;
    expect(attrIn(late, 'color')).toBe(attrIn(on, 'color'));
    expect(attrIn(late, 'ring-color')).toBe(attrIn(on, 'ring-color'));
  });

  it('re-decided on every update, IN PLACE, only what changed, never a rebuild', async () => {
    const { entity, attributes, el, createSpy, html } = live();
    await entity.update();
    expect(el.setAttribute).not.toHaveBeenCalled();

    // Stops between stations: pulses.
    attributes.stalled = true;
    await entity.update();
    expect(el.setAttribute.mock.calls).toEqual([['pulse', 'true']]);
    expect(attrIn(html(), 'pulse')).toBe('true');

    // Loses more time: red, still pulsing.
    el.setAttribute.mockClear();
    attributes.delay_min = 16;
    await entity.update();
    expect(el.setAttribute.mock.calls).toEqual([['delay-badge', '+16'], ['delay-level', 'red']]);

    // Moves off: the pulse stops, the badge stays.
    el.setAttribute.mockClear();
    delete attributes.stalled;
    await entity.update();
    expect(el.setAttribute.mock.calls).toEqual([['pulse', '']]);

    // Stalls again but has made up time to 5: nothing at all.
    el.setAttribute.mockClear();
    attributes.stalled = true;
    attributes.delay_min = 5;
    await entity.update();
    expect(el.setAttribute.mock.calls).toEqual([['delay-badge', ''], ['delay-level', '']]);
    expect(attrIn(html(), 'delay-badge')).toBe('');
    expect(attrIn(html(), 'delay-level')).toBe('');
    expect(attrIn(html(), 'pulse')).toBe('');

    // delay_min goes away: still nothing, and nothing written.
    el.setAttribute.mockClear();
    delete attributes.delay_min;
    await entity.update();
    expect(el.setAttribute).not.toHaveBeenCalled();

    expect(createSpy).not.toHaveBeenCalled();
  });

  it('a lateness change leaves the fill, label colour and styling alone', async () => {
    const { entity, attributes, el } = live();
    attributes.delay_min = 30;
    attributes.stalled = true;
    await entity.update();
    const names = el.setAttribute.mock.calls.map((c) => c[0]).sort();
    expect(names).toEqual(['delay-badge', 'delay-level', 'pulse']);
  });
});
