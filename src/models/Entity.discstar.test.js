import Entity from './Entity.js';
import { FALLBACK_MARKER_COLOR, MARKER_SYMBOLS, parseMarkerSymbol } from '../configs/EntityConfig.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('./EntityHistoryManager.js');

const noop = jest.fn();
const ID = 'geo_location.seq_1sf8';

// SE Queensland's grey special shuttles (Lee 2026-10-11 05:23): `marker_symbol: "star"`.
/**
 * @param {{configuredColor?: string|null, attrs?: object}} [opts]
 * @returns {{entity: Entity, hass: object}}
 */
function makeEntity({ configuredColor = null, attrs = {} } = {}) {
  const attributes = { friendly_name: 'X', latitude: -27.46, longitude: 153.02, marker_label: '1SF8',
    marker_color: '#0A1116', marker_ring_color: '#666D8E', ...attrs };
  const hass = {
    states: { [ID]: { state: '1.0', attributes } },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => '1SF8'),
    hassUrl: jest.fn(u => u),
  };
  const config = {
    id: ID, display: 'attribute', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 36,
    configuredColor, color: configuredColor ?? FALLBACK_MARKER_COLOR,
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  return { entity: new Entity(config, hass, map, noop, noop, noop, false), hass };
}

describe('parseMarkerSymbol', () => {
  it('accepts "star" exactly; it is the only symbol', () => {
    expect(MARKER_SYMBOLS).toEqual(['star']);
    expect(parseMarkerSymbol('star')).toBe('star');
  });
  it.each([undefined, null, '', 'Star', ' star', 'star ', 'maple', 1, true, ['star']])('refuses %p', (v) => {
    expect(parseMarkerSymbol(v)).toBeNull();
  });
});

describe('marker_symbol reaches the marker', () => {
  it('in the styling and in the marker html', () => {
    const { entity } = makeEntity({ attrs: { marker_symbol: 'star' } });
    expect(entity.markerStyling.symbol).toBe('star');
    expect(entity.createMapMarker().options.icon.options.html).toMatch(/\ssymbol="star"/);
  });

  it('absent or malformed: empty', () => {
    expect(makeEntity().entity.markerStyling.symbol).toBe('');
    expect(makeEntity({ attrs: { marker_symbol: 'Star' } }).entity.markerStyling.symbol).toBe('');
  });

  it('ignored under a dashboard color, with the rest of the emitter set', () => {
    expect(makeEntity({ configuredColor: '#00FF00', attrs: { marker_symbol: 'star' } }).entity.markerStyling.symbol).toBe('');
  });

  it('a symbol arriving later is written in place, nothing else touched', () => {
    const { entity, hass } = makeEntity();
    const real = entity.createMapMarker();
    const el = { setAttribute: jest.fn() };
    entity.marker = { options: real.options, getElement: jest.fn(() => ({ querySelector: () => el })) };
    entity._currentStyling = entity.markerStyling;
    hass.states[ID].attributes.marker_symbol = 'star';
    entity.refreshMarkerStyling();
    expect(el.setAttribute).toHaveBeenCalledWith('symbol', 'star');
    expect(el.setAttribute).toHaveBeenCalledTimes(1);
    expect(entity.marker.options.icon.options.html).toMatch(/\ssymbol="star"/);
  });
});
