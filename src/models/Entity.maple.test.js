import Entity from './Entity.js';
import { FALLBACK_MARKER_COLOR, parseLabelPlacement, parseMarkerShape } from '../configs/EntityConfig.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('./EntityHistoryManager.js');

const noop = jest.fn();
const ID = 'geo_location.via_rail_train_61_11';

// VIA Rail (Lee 2026-10-11): `marker_shape: "maple"`, `marker_symbol_color`,
// `marker_symbol_outline_color` and `marker_label_placement: "heading"`.
/**
 * @param {{configuredColor?: string|null, attrs?: object}} [opts]
 * @returns {{entity: Entity, hass: object}}
 */
function makeEntity({ configuredColor = null, attrs = {} } = {}) {
  const attributes = { friendly_name: 'X', latitude: 45.4, longitude: -75.7, marker_label: '61',
    marker_color: '#FFCC00', marker_ring_color: '#323198', ...attrs };
  const hass = {
    states: { [ID]: { state: '1.0', attributes } },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => '61'),
    hassUrl: jest.fn(u => u),
  };
  const config = {
    id: ID, display: 'attribute', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 40,
    configuredColor, color: configuredColor ?? FALLBACK_MARKER_COLOR,
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  return { entity: new Entity(config, hass, map, noop, noop, noop, false), hass };
}

describe('parseMarkerShape and parseLabelPlacement', () => {
  it('accept "maple" and "heading" exactly', () => {
    expect(parseMarkerShape('maple')).toBe('maple');
    expect(parseMarkerShape('star')).toBe('star');
    expect(parseLabelPlacement('heading')).toBe('heading');
  });
  it.each([undefined, null, '', 'Maple', ' maple', 'leaf', 1, ['maple']])('shape refuses %p', (v) => {
    expect(parseMarkerShape(v)).toBeNull();
  });
  it.each([undefined, null, '', 'Heading', 'heading ', 'inside', 'top', 1, true])('placement refuses %p', (v) => {
    expect(parseLabelPlacement(v)).toBeNull();
  });
});

describe('the VIA keys reach the marker', () => {
  const full = { marker_shape: 'maple', marker_label_placement: 'heading',
    marker_symbol_color: '#FF0000', marker_symbol_outline_color: '#FFFFFF' };

  it('in the styling and in the marker html', () => {
    const { entity } = makeEntity({ attrs: full });
    const s = entity.markerStyling;
    expect([s.shape, s['label-placement'], s['symbol-color'], s['symbol-outline']])
      .toEqual(['maple', 'heading', '#FF0000', '#FFFFFF']);
    const html = entity.createMapMarker().options.icon.options.html;
    expect(html).toMatch(/\sshape="maple"/);
    expect(html).toMatch(/\slabel-placement="heading"/);
    expect(html).toMatch(/\ssymbol-color="#FF0000"/);
    expect(html).toMatch(/\ssymbol-outline="#FFFFFF"/);
  });

  it('absent or malformed: the defaults (empty)', () => {
    const { entity } = makeEntity({ attrs: { marker_label_placement: 'Heading', marker_symbol_color: 'red',
      marker_symbol_outline_color: '#FFF' } });
    const s = entity.markerStyling;
    expect([s['label-placement'], s['symbol-color'], s['symbol-outline']]).toEqual(['', '', '']);
  });

  it('ignored under a dashboard color, with the rest of the emitter set', () => {
    const { entity } = makeEntity({ configuredColor: '#00FF00', attrs: full });
    const s = entity.markerStyling;
    expect([s.shape, s['label-placement'], s['symbol-color'], s['symbol-outline']]).toEqual(['', '', '', '']);
  });

  it('a change arriving later is written in place, without touching the colour attribute', () => {
    const { entity, hass } = makeEntity({ attrs: full });
    const real = entity.createMapMarker();
    const el = { setAttribute: jest.fn() };
    entity.marker = { options: real.options, getElement: jest.fn(() => ({ querySelector: () => el })) };
    entity._currentStyling = entity.markerStyling;
    hass.states[ID].attributes.marker_symbol_outline_color = '#000000';
    entity.refreshMarkerStyling();
    expect(el.setAttribute).toHaveBeenCalledWith('symbol-outline', '#000000');
    expect(el.setAttribute).toHaveBeenCalledTimes(1);
    const html = entity.marker.options.icon.options.html;
    expect(html).toMatch(/\ssymbol-outline="#000000"/);
    expect(html).toMatch(/\scolor="#FFCC00"/);
    expect(html).toMatch(/\ssymbol-color="#FF0000"/);
  });
});
