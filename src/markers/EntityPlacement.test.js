import Entity from '../models/Entity.js';
import L from '../models/leafletGlobal.testhelper.js';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { layers } from './CanvasMarkerLayer.js';
import { canvasPane, domPane, setupPlacement } from './MarkerPlacement.js';

jest.mock('../models/Circle.js');
jest.mock('../models/GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../models/EntityHistoryManager.js');

// Entity.createMapMarker with the drawing EntitiesRenderService chose (MarkerPlacement):
// the class comes from map_layer (D10), a look that is not plain stays DOM in its class's
// pane, culling takes off-screen DOM markers off, and with nothing chosen nothing changes.

let clock, frames, nextId, map, div;
beforeEach(() => {
  clock = 1000; frames = new Map(); nextId = 1;
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  globalThis.requestAnimationFrame = jest.fn((cb) => { const id = nextId++; frames.set(id, cb); return id; });
  globalThis.cancelAnimationFrame = jest.fn((id) => frames.delete(id));
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  globalThis.fetch = jest.fn(() => Promise.reject(new Error('no network in tests')));
  window.matchMedia = jest.fn((q) => ({ matches: false, media: q }));
  div = document.createElement('div');
  Object.defineProperty(div, 'clientWidth', { value: 800 });
  Object.defineProperty(div, 'clientHeight', { value: 600 });
  document.body.appendChild(div);
  map = L.map(div, { animate: false, zoomAnimation: false, fadeAnimation: false }).setView([41.9, -67.9], 10);
});
afterEach(() => { map.remove(); div.remove(); jest.restoreAllMocks(); delete window.matchMedia; delete globalThis.fetch; });

const noop = jest.fn();
/**
 * @param {object} [o]
 * @param {string|null} [o.layer] map_layer
 * @param {string} [o.display]
 * @param {number[]} [o.ll]
 * @param {string} [o.picture]
 * @returns {{entity: Entity, attributes: object}}
 */
function makeEntity({ layer = 'air', display = 'marker', ll = [41.9, -67.9], picture = 'https://ha/b737.svg' } = {}) {
  const attributes = { friendly_name: 'X', entity_picture: picture, latitude: ll[0], longitude: ll[1], map_layer: layer, marker_label: 'X' };
  const hass = {
    states: { 'geo_location.x': { state: '1', attributes } },
    formatEntityState: () => 'S', formatEntityAttributeValue: () => 'A', hassUrl: (u) => u,
  };
  const config = {
    id: 'geo_location.x', display, attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 60, color: 'transparent', configuredColor: null,
    zIndexOffset: null, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, positionTransition: 0, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  return { entity: new Entity(config, hass, map, noop, noop, noop, false), attributes };
}
const isCanvas = (m) => Boolean(m && m.layer && m.dom);

describe('with the canvas and culling on', () => {
  beforeEach(() => setupPlacement(map, { canvas: true, cull: true }));

  it('an aircraft picture goes on the air canvas', () => {
    const { entity } = makeEntity({ layer: 'air' });
    entity.setup(null);
    expect(isCanvas(entity.marker)).toBe(true);
    expect(entity.marker.layer).toBe(layers(map)[5]);
    expect(layers(map)[5]._container.parentNode).toBe(map.getPane(canvasPane(5)));
  });

  it('a helicopter on air_low, a vessel on water: each on its own class\'s canvas', () => {
    const a = makeEntity({ layer: 'air_low' }).entity; a.setup(null);
    const b = makeEntity({ layer: 'water' }).entity; b.setup(null);
    expect(a.marker.layer.band).toBe(4);
    expect(b.marker.layer.band).toBe(2);
  });

  it('no map_layer is fixed, the bottom class', () => {
    const { entity, attributes } = makeEntity({ layer: null });
    delete attributes.map_layer;
    entity.setup(null);
    expect(entity.marker.layer.band).toBe(1);
  });

  it('a changed map_layer moves it, in place', () => {
    const { entity, attributes } = makeEntity({ layer: 'air' });
    entity.setup(null);
    const marker = entity.marker;
    attributes.map_layer = 'water';
    entity.refreshMarkerZIndex();
    expect(entity.marker).toBe(marker);
    expect(marker.layer.band).toBe(2);
    expect(marker.dom.options.pane).toBe(domPane(2));
  });

  it('a bare picture is not plain: a DOM marker in its class\'s pane', () => {
    const { entity } = makeEntity({ layer: 'rail', display: 'attribute' });
    entity.setup(null);
    expect(isCanvas(entity.marker)).toBe(false);
    expect(entity.marker.getElement().parentNode).toBe(map.getPane(domPane(3)));
  });

  it('a DOM marker far off screen is culled', () => {
    const { entity } = makeEntity({ layer: 'rail', display: 'attribute', ll: [10, 10] });
    entity.setup(null);
    expect(map.hasLayer(entity.marker)).toBe(false);
  });
});

describe('with only culling on (canvas_markers: false)', () => {
  beforeEach(() => setupPlacement(map, { canvas: false, cull: true }));

  it('every marker is a plain Leaflet marker in Leaflet\'s markerPane', () => {
    const { entity } = makeEntity();
    entity.setup(null);
    expect(entity.marker).toBeInstanceOf(L.Marker);
    expect(entity.marker.options.pane).toBe('markerPane');
    expect(entity.marker.getElement().parentNode).toBe(map.getPane('markerPane'));
    expect(layers(map).some(Boolean)).toBe(false);
  });

  it('and is still culled off screen', () => {
    const { entity } = makeEntity({ ll: [10, 10] });
    entity.setup(null);
    expect(map.hasLayer(entity.marker)).toBe(false);
  });
});

describe('with nothing chosen (clustering, or a caller that sets nothing)', () => {
  it('the marker is exactly the card\'s DOM marker', () => {
    const { entity } = makeEntity({ ll: [10, 10] });
    entity.setup(null);
    expect(entity.marker).toBeInstanceOf(L.Marker);
    expect(entity.marker.__ltmcCulled).toBeUndefined();
    expect(entity.marker.__ltmcBanded).toBeUndefined();
    expect(map.hasLayer(entity.marker)).toBe(true);
  });
});
