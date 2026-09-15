import Entity, { MARKER_TAG } from './Entity.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

const noop = jest.fn();

function makeEntity({ display = 'marker', picture = 'https://ha/pic-a.svg' } = {}) {
  const hass = {
    states: {
      'geo_location.x': {
        state: '1.0',
        attributes: {
          friendly_name: 'X',
          entity_picture: picture,
          latitude: 41.9,
          longitude: -87.9,
        },
      },
    },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => 'ATTR'),
    hassUrl: jest.fn(u => u),
  };
  const config = {
    id: 'geo_location.x', display, attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 24, color: 'red',
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  const entity = new Entity(config, hass, map, noop, noop, noop, false);
  return { entity, hass, config, map };
}

describe('marker element name', () => {
  it('is the name index.js registers, not upstream\'s', () => {
    expect(MARKER_TAG).toBe('live-track-map-card-entity-marker');
  });

  it('is the element every marker is built from', () => {
    const { entity } = makeEntity();
    const html = entity.createMapMarker().options.icon.options.html;
    expect(html).toContain(`<${MARKER_TAG}`);
    expect(html).toContain(`</${MARKER_TAG}>`);
    expect(html).not.toMatch(/<\/?map-card-entity-marker[\s>]/);
  });
});
