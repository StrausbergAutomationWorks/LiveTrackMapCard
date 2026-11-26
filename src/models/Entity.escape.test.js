import Entity, { MARKER_TAG } from './Entity.js';
import { parseAttrs } from '../markers/CanvasMarkerLayer.js';
import { FALLBACK_MARKER_COLOR } from '../configs/EntityConfig.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('./EntityHistoryManager.js');

// LiveTrackMapCard#1 (backlog 368), finding 1: the marker's DivIcon html. Leaflet sets it with innerHTML, so a
// friendly name, state or picture holding a quote must stay inside its attribute.
const noop = jest.fn();
const ID = 'geo_location.vessel_1';
const HOSTILE = 'x" onmouseover="alert(1)" a=\'<img src=x onerror=alert(2)><b>bold</b>&amp;&#39;';
const ATTRS = 36;

/**
 * @param {object} [opts]
 * @param {object} [opts.attrs] attributes over the hostile ones
 * @param {object} [opts.config] config over the hostile one
 * @returns {Entity}
 */
function makeEntity({ attrs = {}, config = {} } = {}) {
  const attributes = { friendly_name: `SG-312 "KAPER-2" ${HOSTILE}`, latitude: 54.1, longitude: 10.2,
    entity_picture: `/p.svg?${HOSTILE}`, marker_label: HOSTILE, ...attrs };
  const hass = {
    states: { [ID]: { state: HOSTILE, attributes } },
    formatEntityState: jest.fn(() => HOSTILE),
    formatEntityAttributeValue: jest.fn(() => HOSTILE),
    hassUrl: jest.fn(u => u),
  };
  const base = {
    id: ID, display: 'marker', attribute: null,
    prefix: HOSTILE, suffix: HOSTILE, label: HOSTILE, size: 46,
    configuredColor: null, color: FALLBACK_MARKER_COLOR,
    zIndexOffset: 0, tapAction: { action: 'navigate', navigation_path: `/x'y"z${HOSTILE}` }, css: `color: red;${HOSTILE}`,
    pillCalloutMinZoom: 15, positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  return new Entity({ ...base, ...config }, hass, map, noop, noop, noop, false);
}

/**
 * @param {string} html
 * @returns {Element} a div holding the html as the browser parses it
 */
function parsed(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('the marker html (LiveTrackMapCard#1 finding 1)', () => {
  it('the precondition: the hostile text reaches the entity', () => {
    const entity = makeEntity();
    expect(String(entity.title)).toContain(HOSTILE);
  });

  it('a hostile name, state, label, picture or tap action adds no element and no attribute', () => {
    const div = parsed(makeEntity().createMapMarker().options.icon.options.html);
    expect(div.children).toHaveLength(1);
    expect(div.querySelectorAll('img, b, script')).toHaveLength(0);
    const el = div.querySelector(MARKER_TAG);
    expect(el).not.toBeNull();
    expect(el.attributes).toHaveLength(ATTRS);
    expect(el.hasAttribute('onmouseover')).toBe(false);
    expect(el.hasAttribute('a')).toBe(false);
  });

  it('every value reads back as written: the browser and the canvas parse agree', () => {
    const entity = makeEntity();
    const html = entity.createMapMarker().options.icon.options.html;
    const el = parsed(html).querySelector(MARKER_TAG);
    expect(el.getAttribute('title')).toBe(String(entity.title));
    expect(el.getAttribute('label')).toBe(HOSTILE);
    expect(el.getAttribute('prefix')).toBe(HOSTILE);
    expect(el.getAttribute('style')).toBe(`color: red;${HOSTILE}`);
    expect(JSON.parse(el.getAttribute('tap-action'))).toEqual({ action: 'navigate', navigation_path: `/x'y"z${HOSTILE}` });
    const a = parseAttrs(html);
    expect(Object.keys(a)).toHaveLength(ATTRS);
    for (const at of el.attributes) expect([at.name, a[at.name]]).toEqual([at.name, at.value]);
  });

  it('a value written back later (_setMarkerAttribute) stays inside its attribute', () => {
    const entity = makeEntity();
    entity.marker = entity.createMapMarker();
    entity._setMarkerAttribute('picture', HOSTILE);
    entity._setMarkerAttribute('color', `#fff" x="${HOSTILE}`);
    const html = entity.marker.options.icon.options.html;
    const div = parsed(html);
    expect(div.querySelectorAll('img, b')).toHaveLength(0);
    const el = div.querySelector(MARKER_TAG);
    expect(el.attributes).toHaveLength(ATTRS);
    expect(el.getAttribute('picture')).toBe(HOSTILE);
    expect(el.getAttribute('color')).toBe(`#fff" x="${HOSTILE}`);
    expect(parseAttrs(html).picture).toBe(HOSTILE);
    // and written again, the previous value is replaced, not left beside the new one
    entity._setMarkerAttribute('picture', '/p2.svg');
    expect(parseAttrs(entity.marker.options.icon.options.html).picture).toBe('/p2.svg');
    expect(parsed(entity.marker.options.icon.options.html).querySelector(MARKER_TAG).attributes).toHaveLength(ATTRS);
  });

  it('ordinary values are written exactly as before', () => {
    const entity = makeEntity({ attrs: { friendly_name: 'Plain', entity_picture: '/p.svg', marker_label: '63' },
      config: { prefix: '', suffix: '', label: null, css: '', tapAction: {} } });
    const html = entity.createMapMarker().options.icon.options.html;
    expect(entity.title).toMatch(/^[A-Za-z0-9 ]+$/);
    expect(html).toContain(` title="${entity.title}"`);
    expect(html).toContain(' prefix=""');
    expect(html).toContain(' label=""');
    expect(html).toContain(" tap-action='{}'");
  });
});
