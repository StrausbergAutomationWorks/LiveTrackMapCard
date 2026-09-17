import Entity, { MARKER_TAG } from './Entity.js';
import { FALLBACK_MARKER_COLOR } from '../configs/EntityConfig.js';
import { jest, describe, it, expect } from '@jest/globals';

// EntityConfig is deliberately NOT mocked: the rule under test lives in its
// parseMarkerColor(), and an automock would turn that into a stub.
jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('./EntityHistoryManager.js');

const noop = jest.fn();
const ID = 'geo_location.x';

// Precedence (05_SHARED_LESSONS.md D4a, card SSOT §28): a dashboard `color`
// wins; else a valid `marker_color` attribute; else the neutral fallback.
// The live map sets `color` on every Brightline branch, so shipping this
// must change nothing there - the first group pins that.
/**
 * An entity with an optional configured colour and marker_color attribute.
 * @param {{configuredColor?: string|null, markerColor?: *}} [opts]
 * @returns {{entity: Entity, hass: object}}
 */
function makeEntity({ configuredColor = null, markerColor } = {}) {
  const attributes = { friendly_name: 'X', latitude: 41.9, longitude: -87.9, marker_label: 'X 1' };
  if (markerColor !== undefined) attributes.marker_color = markerColor;
  const hass = {
    states: { [ID]: { state: '1.0', attributes } },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => 'X 1'),
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
  const entity = new Entity(config, hass, map, noop, noop, noop, false);
  return { entity, hass };
}

/**
 * makeEntity() with a stand-in live marker, as Entity.marker.test.js does.
 * @param {object} [opts] passed to makeEntity()
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
  return { ...made, fake, el, root, createSpy };
}

const storedColor = (fake) => fake.options.icon.options.html.match(/\scolor="([^"]*)"/)[1];
const setAttr = (hass, value) => {
  if (value === undefined) delete hass.states[ID].attributes.marker_color;
  else hass.states[ID].attributes.marker_color = value;
};

describe('marker colour precedence', () => {
  it('a configured colour beats marker_color', () => {
    const { entity } = makeEntity({ configuredColor: '#299FD5', markerColor: '#2e8b57' });
    expect(entity.markerColor).toBe('#299FD5');
    expect(storedColor({ options: entity.createMapMarker().options })).toBe('#299FD5');
  });

  it('a configured `transparent` beats marker_color (picture markers)', () => {
    const { entity } = makeEntity({ configuredColor: 'transparent', markerColor: '#2e8b57' });
    expect(entity.markerColor).toBe('transparent');
  });

  it('marker_color is used when nothing is configured', () => {
    const { entity } = makeEntity({ markerColor: '#2e8b57' });
    expect(entity.markerColor).toBe('#2e8b57');
    expect(storedColor({ options: entity.createMapMarker().options })).toBe('#2e8b57');
  });

  it('with neither, the neutral fallback', () => {
    const { entity } = makeEntity();
    expect(entity.markerColor).toBe(FALLBACK_MARKER_COLOR);
  });

  it.each([null, '', 'red', '#abc', '#299FD5FF', ' #299FD5', 'hsl(3, 95%, 35%)', 42])(
    'an invalid marker_color %p falls back', (v) => {
      const { entity } = makeEntity({ markerColor: v });
      expect(entity.markerColor).toBe(FALLBACK_MARKER_COLOR);
    });

  it('is remembered when the marker is built', () => {
    const { entity } = makeEntity({ markerColor: '#2e8b57' });
    entity.createMapMarker();
    expect(entity._currentColor).toBe('#2e8b57');
  });
});

describe('a changed marker_color reaches an existing marker', () => {
  it('arriving after the marker exists: element and stored html, by OUR tag', async () => {
    const { entity, hass, fake, el, root } = withLiveMarker();
    expect(storedColor(fake)).toBe(FALLBACK_MARKER_COLOR);
    setAttr(hass, '#64BF4B');
    await entity.update();
    expect(root.querySelector).toHaveBeenCalledWith(MARKER_TAG);
    expect(el.setAttribute).toHaveBeenCalledWith('color', '#64BF4B');
    expect(storedColor(fake)).toBe('#64BF4B');
  });

  it('never recreates the marker', async () => {
    const { entity, hass, fake, createSpy } = withLiveMarker({ markerColor: '#2e8b57' });
    setAttr(hass, '#299FD5');
    await entity.update();
    expect(createSpy).not.toHaveBeenCalled();
    expect(fake.remove).not.toHaveBeenCalled();
    expect(entity.marker).toBe(fake);
  });

  it('writes nothing when unchanged', async () => {
    const { entity, el } = withLiveMarker({ markerColor: '#2e8b57' });
    await entity.update();
    expect(el.setAttribute).not.toHaveBeenCalledWith('color', expect.anything());
  });

  it('going away returns the marker to the fallback', async () => {
    const { entity, hass, fake, el } = withLiveMarker({ markerColor: '#2e8b57' });
    setAttr(hass, undefined);
    await entity.update();
    expect(el.setAttribute).toHaveBeenCalledWith('color', FALLBACK_MARKER_COLOR);
    expect(storedColor(fake)).toBe(FALLBACK_MARKER_COLOR);
  });

  it('is ignored while a colour is configured', async () => {
    const { entity, hass, fake, el } = withLiveMarker({ configuredColor: '#F29F05', markerColor: '#d97706' });
    setAttr(hass, '#2e8b57');
    await entity.update();
    expect(el.setAttribute).not.toHaveBeenCalledWith('color', expect.anything());
    expect(storedColor(fake)).toBe('#F29F05');
  });

  it('touches no other attribute in the stored html', async () => {
    const { entity, hass, fake } = withLiveMarker({ markerColor: '#2e8b57' });
    const before = fake.options.icon.options.html;
    setAttr(hass, '#299FD5');
    await entity.update();
    const after = fake.options.icon.options.html;
    expect(after).toBe(before.replace('color="#2e8b57"', 'color="#299FD5"'));
  });
});
