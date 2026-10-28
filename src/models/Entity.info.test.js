import Entity from './Entity.js';
import MapCardEntityMarker from '../components/MapCardEntityMarker.js';
import { jest, describe, it, expect } from '@jest/globals';

// 06_MAP_CONTRACT.md D4e (Live Track Weather item 310; Lee 2026-10-28: "a dot ... that when clicked gives the
// forecast"): a marker carrying `marker_info` opens it in a popup on click instead of the entity dialog.

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');
jest.mock('lit', () => ({ LitElement: class {}, html: () => ({}), css: () => '' }));

const noop = jest.fn();

/**
 * @param {*} info the marker_info attribute, or undefined for none
 * @returns {{entity: Entity, hass: object}}
 */
function makeEntity(info) {
  const hass = {
    states: {
      'geo_location.p': {
        state: '1.0',
        attributes: {
          friendly_name: 'Longyearbyen forecast', latitude: 78.2232, longitude: 15.6267, marker_label: '1°',
          ...(info === undefined ? {} : { marker_info: info }),
        },
      },
    },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => '1°'),
    hassUrl: jest.fn(u => u),
  };
  const config = {
    id: 'geo_location.p', display: 'attribute', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 28, color: 'red',
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  return { entity: new Entity(config, hass, map, noop, noop, noop, false), hass };
}

describe('marker_info (D4e)', () => {
  it('a marker with info: flagged for the element, and a popup with its text', () => {
    const { entity, hass } = makeEntity({ title: 'Longyearbyen', text: 'Now: 0.7 °C\n<b>6 h</b>' });
    const m = entity.createMapMarker();
    expect(m.options.icon.options.html).toContain('info="true"');
    const popup = m.getPopup();
    expect(popup).toBeTruthy();
    expect(popup.options.maxWidth).toBe(360);
    expect(popup.options.offset).toEqual([0, -14]);
    const content = popup._content;
    expect(typeof content).toBe('function');
    expect(content()).toBe('<div class="ltmc-shape-info"><b>Longyearbyen</b><br>Now: 0.7 °C<br>&lt;b&gt;6 h&lt;/b&gt;</div>');
    // the text is read when the popup opens: a newer forecast shows
    hass.states['geo_location.p'].attributes.marker_info = { title: 'Longyearbyen', text: 'Now: 1.0 °C' };
    expect(content()).toContain('Now: 1.0 °C');
    hass.states['geo_location.p'].attributes.marker_info = null;
    expect(content()).toBe('');
  });

  it('a marker without info: no flag, no popup; a malformed one counts as none', () => {
    for (const info of [undefined, 'text', { title: ' ' }]) {
      const m = makeEntity(info).entity.createMapMarker();
      expect(m.options.icon.options.html).toContain('info=""');
      expect(m.getPopup()).toBeUndefined();
    }
  });

  it('the element lets a click with info through to Leaflet, and otherwise opens the entity dialog', () => {
    const tap = MapCardEntityMarker.prototype._badgeTap;
    const withInfo = { info: 'true', entityId: 'geo_location.p', tapAction: {}, dispatchEvent: jest.fn() };
    const ev1 = { stopPropagation: jest.fn() };
    tap.call(withInfo, ev1);
    expect(ev1.stopPropagation).not.toHaveBeenCalled();
    expect(withInfo.dispatchEvent).not.toHaveBeenCalled();
    const plain = { info: '', entityId: 'geo_location.p', tapAction: { action: 'more-info' }, dispatchEvent: jest.fn() };
    const ev2 = { stopPropagation: jest.fn() };
    tap.call(plain, ev2);
    expect(ev2.stopPropagation).toHaveBeenCalled();
    expect(plain.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(plain.dispatchEvent.mock.calls[0][0].type).toBe('hass-action');
  });
});
