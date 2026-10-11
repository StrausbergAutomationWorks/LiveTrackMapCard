import Entity from './Entity.js';
import {
  ALTERNATE_S_DEFAULT, ALTERNATE_S_MAX, ALTERNATE_S_MIN, FALLBACK_MARKER_COLOR, parseAlternateSeconds, parseMarkerAlternate,
} from '../configs/EntityConfig.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('./EntityHistoryManager.js');

const noop = jest.fn();
const ID = 'geo_location.amtrak_train_63_11';
// The Maple Leaf (Lee 2026-10-11 16:11): Amtrak 63's star, and VIA 98's maple badge as its alternate.
const VIA98 = { marker_shape: 'maple', marker_label: '98', marker_color: '#323198', marker_ring_color: '#FFCC00',
  marker_symbol_color: '#FF0000', marker_symbol_outline_color: '#FFFFFF', marker_label_placement: 'heading' };

/**
 * @param {{configuredColor?: string|null, attrs?: object}} [opts]
 * @returns {{entity: Entity, hass: object}}
 */
function makeEntity({ configuredColor = null, attrs = {} } = {}) {
  const attributes = { friendly_name: 'X', latitude: 43.1, longitude: -79.2, marker_label: '63',
    marker_shape: 'star', marker_color: '#FFFFFF', marker_ring_color: '#3C3B6E', ...attrs };
  const hass = {
    states: { [ID]: { state: '1.0', attributes } },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => '63'),
    hassUrl: jest.fn(u => u),
  };
  const config = {
    id: ID, display: 'attribute', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 46,
    configuredColor, color: configuredColor ?? FALLBACK_MARKER_COLOR,
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  return { entity: new Entity(config, hass, map, noop, noop, noop, false), hass };
}
const decode = (s) => JSON.parse(decodeURIComponent(s));

describe('parseMarkerAlternate', () => {
  it('reads each key by the primary rule, into the marker property names', () => {
    expect(parseMarkerAlternate(VIA98)).toEqual({ shape: 'maple', title: '98', color: '#323198', ringColor: '#FFCC00',
      symbolColor: '#FF0000', symbolOutline: '#FFFFFF', labelPlacement: 'heading' });
  });

  it('every look key it knows', () => {
    const all = { marker_label: 7097, marker_color: '#111111', marker_label_color: '#222222', marker_label_outline_color: 'None',
      marker_arrow_color: '#333333', marker_arrow_outline_color: '#444444', marker_ring_color: '#555555', marker_ring_width: 2.5,
      marker_shape: 'star', marker_symbol: 'star', marker_label_placement: 'heading', marker_symbol_color: '#666666',
      marker_symbol_outline_color: '#777777' };
    expect(parseMarkerAlternate(all)).toEqual({ title: '7097', color: '#111111', labelColor: '#222222', labelOutline: 'none',
      arrowColor: '#333333', arrowOutline: '#444444', ringColor: '#555555', ringWidth: '2.5', shape: 'star', symbol: 'star',
      labelPlacement: 'heading', symbolColor: '#666666', symbolOutline: '#777777' });
    expect(parseMarkerAlternate({ marker_label_outline_color: '#ABCDEF' })).toEqual({ labelOutline: '#ABCDEF' });
  });

  it('drops what the primary rule would refuse, keeps the rest', () => {
    expect(parseMarkerAlternate({ ...VIA98, marker_color: 'blue', marker_shape: 'Maple', marker_ring_width: 9,
      marker_label_placement: 'Heading', marker_symbol: 'moon', marker_label: '   ' }))
      .toEqual({ ringColor: '#FFCC00', symbolColor: '#FF0000', symbolOutline: '#FFFFFF' });
    expect(parseMarkerAlternate({ marker_label: 'ABCDEFGHIJKLM' })).toBeNull();
    expect(parseMarkerAlternate({ marker_label: 'ABCDEFGHIJKL' })).toEqual({ title: 'ABCDEFGHIJKL' });
    expect(parseMarkerAlternate({ marker_label: ' 98 ' })).toEqual({ title: '98' });
    expect(parseMarkerAlternate({ marker_label: 1234567890123 })).toBeNull();
    expect(parseMarkerAlternate({ marker_label: Number.NaN })).toBeNull();
  });

  it.each([undefined, null, 'maple', 98, true, [], [VIA98], {}, { marker_shape: 'leaf' }])('nothing for %p', (v) => {
    expect(parseMarkerAlternate(v)).toBeNull();
  });

  it('seconds: a number in bounds, else the default', () => {
    expect(ALTERNATE_S_DEFAULT).toBe(4);
    expect(parseAlternateSeconds(ALTERNATE_S_MIN)).toBe(ALTERNATE_S_MIN);
    expect(parseAlternateSeconds(ALTERNATE_S_MAX)).toBe(ALTERNATE_S_MAX);
    expect(parseAlternateSeconds(6.5)).toBe(6.5);
    for (const v of [1.9, 30.1, '6', null, undefined, Number.NaN, Infinity, true]) {
      expect(parseAlternateSeconds(v)).toBe(ALTERNATE_S_DEFAULT);
    }
  });
});

describe('marker_alternate reaches the marker', () => {
  it('encoded with its seconds, in the styling and the html', () => {
    const { entity } = makeEntity({ attrs: { marker_alternate: VIA98, marker_alternate_s: 5 } });
    const s = entity.markerStyling.alternate;
    expect(s).not.toMatch(/["\s]/);
    expect(decode(s)).toEqual({ ...parseMarkerAlternate(VIA98), s: 5 });
    expect(entity.createMapMarker().options.icon.options.html).toContain(` alternate="${s}"`);
  });

  it('the default seconds when none are sent', () => {
    expect(decode(makeEntity({ attrs: { marker_alternate: VIA98 } }).entity.markerStyling.alternate).s).toBe(4);
  });

  it('absent or empty: no attribute value', () => {
    expect(makeEntity().entity.markerStyling.alternate).toBe('');
    expect(makeEntity({ attrs: { marker_alternate: { marker_shape: 'leaf' } } }).entity.markerStyling.alternate).toBe('');
  });

  it('ignored under a dashboard color, with the rest of the emitter set', () => {
    expect(makeEntity({ configuredColor: '#00FF00', attrs: { marker_alternate: VIA98 } }).entity.markerStyling.alternate).toBe('');
  });

  it('a change arriving later is written in place', () => {
    const { entity, hass } = makeEntity();
    const real = entity.createMapMarker();
    const el = { setAttribute: jest.fn() };
    entity.marker = { options: real.options, getElement: jest.fn(() => ({ querySelector: () => el })) };
    entity._currentStyling = entity.markerStyling;
    hass.states[ID].attributes.marker_alternate = VIA98;
    entity.refreshMarkerStyling();
    expect(el.setAttribute).toHaveBeenCalledTimes(1);
    expect(el.setAttribute.mock.calls[0][0]).toBe('alternate');
    expect(decode(el.setAttribute.mock.calls[0][1]).title).toBe('98');
    expect(entity.marker.options.icon.options.html).toContain(` alternate="${entity.markerStyling.alternate}"`);
  });
});
