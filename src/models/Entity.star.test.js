import Entity from './Entity.js';
import { FALLBACK_MARKER_COLOR, parseMarkerShape } from '../configs/EntityConfig.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('./EntityHistoryManager.js');

const noop = jest.fn();
const ID = 'geo_location.amtrak_train_5_8';

// `marker_shape` (06_MAP_CONTRACT.md D4a; Lee 2026-10-09 16:43): an emitter
// asks for a star; the card draws it in the emitter's own colours.
/**
 * An entity with a white fill and a blue ring, and optionally a shape.
 * @param {{configuredColor?: string|null, shape?: *}} [opts]
 * @returns {{entity: Entity, hass: object}}
 */
function makeEntity({ configuredColor = null, shape } = {}) {
  const attributes = { friendly_name: 'X', latitude: 41.9, longitude: -87.9, marker_label: '5',
    marker_color: '#FFFFFF', marker_ring_color: '#3C3B6E' };
  if (shape !== undefined) attributes.marker_shape = shape;
  const hass = {
    states: { [ID]: { state: '1.0', attributes } },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => '5'),
    hassUrl: jest.fn(u => u),
  };
  const config = {
    id: ID, display: 'attribute', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 28,
    configuredColor, color: configuredColor ?? FALLBACK_MARKER_COLOR,
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  return { entity: new Entity(config, hass, map, noop, noop, noop, false), hass };
}

describe('parseMarkerShape', () => {
  it('accepts "star" exactly', () => {
    expect(parseMarkerShape('star')).toBe('star');
  });
  it.each([undefined, null, '', 'Star', ' star', 'disc', 'circle', 1, true, ['star']])('refuses %p', (v) => {
    expect(parseMarkerShape(v)).toBeNull();
  });
});

describe('marker_shape reaches the marker', () => {
  it('an emitted star is in the styling and in the marker html', () => {
    const { entity } = makeEntity({ shape: 'star' });
    expect(entity.markerStyling.shape).toBe('star');
    expect(entity.createMapMarker().options.icon.options.html).toMatch(/\sshape="star"/);
  });

  it('absent or unknown: the disc (empty)', () => {
    for (const shape of [undefined, 'hexagon']) {
      const { entity } = makeEntity({ shape });
      expect(entity.markerStyling.shape).toBe('');
      expect(entity.createMapMarker().options.icon.options.html).toMatch(/\sshape=""/);
    }
  });

  it('ignored under a dashboard color, with the rest of the emitter set', () => {
    const { entity } = makeEntity({ shape: 'star', configuredColor: '#00FF00' });
    expect(entity.markerStyling.shape).toBe('');
  });

  it('a star arriving later changes the live marker in place', () => {
    const { entity, hass } = makeEntity();
    const real = entity.createMapMarker();
    const el = { setAttribute: jest.fn() };
    entity.marker = { options: real.options, getElement: jest.fn(() => ({ querySelector: () => el })) };
    entity._currentStyling = entity.markerStyling;
    hass.states[ID].attributes.marker_shape = 'star';
    entity.refreshMarkerStyling();
    expect(el.setAttribute).toHaveBeenCalledWith('shape', 'star');
    expect(entity.marker.options.icon.options.html).toMatch(/\sshape="star"/);
  });
});
