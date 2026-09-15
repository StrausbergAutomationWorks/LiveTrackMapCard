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

// A CHANGED entity_picture must reach an EXISTING marker, without recreating
// it. Found on Live Track Aircraft, which serves a rotated icon per bearing:
// 47 of 74 picture URLs changed inside 90 s and not one marker turned,
// because the picture was read once at creation and update() only recreates
// on title/place changes. Recreating is the wrong fix - it cancels an
// in-flight position transition - so the attribute is set in place.
describe('a changed entity_picture', () => {
  function withLiveMarker(opts) {
    const made = makeEntity(opts);
    const real = made.entity.createMapMarker();
    const el = { setAttribute: jest.fn() };
    const root = { querySelector: jest.fn(() => el) };
    const fake = {
      options: real.options,
      getElement: jest.fn(() => root),
      remove: jest.fn(),
      setLatLng: jest.fn(),
    };
    made.entity.marker = fake;
    made.entity._lastSetLatLng = made.entity.latLng;
    made.entity._currentPlaceIcon = made.entity.placeIcon;
    made.entity._currentTitle = made.entity.title;
    const createSpy = jest.spyOn(made.entity, 'createMapMarker');
    return { ...made, fake, el, root, createSpy };
  }
  const setPicture = (hass, url) => {
    hass.states['geo_location.x'].attributes.entity_picture = url;
  };
  const storedHtml = (fake) => fake.options.icon.options.html;

  it('is remembered when the marker is built', () => {
    const { entity } = makeEntity({ picture: 'https://ha/pic-a.svg' });
    entity.createMapMarker();
    expect(entity._currentPicture).toBe('https://ha/pic-a.svg');
  });

  it('is pushed onto the live element, looked up by OUR tag', async () => {
    const { entity, hass, el, root } = withLiveMarker();
    setPicture(hass, 'https://ha/pic-b.svg');
    await entity.update();
    expect(root.querySelector).toHaveBeenCalledWith(MARKER_TAG);
    expect(el.setAttribute).toHaveBeenCalledWith('picture', 'https://ha/pic-b.svg');
    expect(entity._currentPicture).toBe('https://ha/pic-b.svg');
  });

  it('never recreates the marker', async () => {
    const { entity, hass, fake, createSpy } = withLiveMarker();
    setPicture(hass, 'https://ha/pic-b.svg');
    await entity.update();
    expect(fake.remove).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(entity.marker).toBe(fake);
  });

  it('rewrites the stored DivIcon html, so a re-parse does not revert it', async () => {
    const { entity, hass, fake } = withLiveMarker();
    expect(storedHtml(fake)).toContain('picture="https://ha/pic-a.svg"');
    setPicture(hass, 'https://ha/pic-b.svg');
    await entity.update();
    expect(storedHtml(fake)).toContain('picture="https://ha/pic-b.svg"');
    expect(storedHtml(fake)).not.toContain('pic-a.svg');
  });

  it('leaves the other attributes in the stored html alone', async () => {
    const { entity, hass, fake } = withLiveMarker();
    const before = storedHtml(fake).replace(/ picture="[^"]*"/, '');
    setPicture(hass, 'https://ha/pic-b.svg');
    await entity.update();
    expect(storedHtml(fake).replace(/ picture="[^"]*"/, '')).toBe(before);
  });

  it('does nothing when the picture has not changed', async () => {
    const { entity, el, fake } = withLiveMarker();
    const before = storedHtml(fake);
    await entity.update();
    expect(el.setAttribute).not.toHaveBeenCalled();
    expect(storedHtml(fake)).toBe(before);
  });

  it('clears the picture when the entity stops serving one', async () => {
    const { entity, hass, el, fake } = withLiveMarker();
    setPicture(hass, undefined);
    await entity.update();
    expect(el.setAttribute).toHaveBeenCalledWith('picture', '');
    expect(storedHtml(fake)).toContain('picture=""');
    expect(entity._currentPicture).toBeNull();
  });

  it('still updates the stored html before the marker is in the DOM', async () => {
    const { entity, hass, fake } = withLiveMarker();
    fake.getElement.mockReturnValue(undefined);
    setPicture(hass, 'https://ha/pic-b.svg');
    await expect(entity.update()).resolves.toBeUndefined();
    expect(storedHtml(fake)).toContain('picture="https://ha/pic-b.svg"');
    expect(entity._currentPicture).toBe('https://ha/pic-b.svg');
  });

  it.each(['icon', 'state', 'attribute'])(
    'is ignored for display: %s, which never shows a picture',
    async (display) => {
      const { entity, hass, el, fake } = withLiveMarker({ display });
      expect(storedHtml(fake)).toContain('picture=""');
      setPicture(hass, 'https://ha/pic-b.svg');
      await entity.update();
      expect(el.setAttribute).not.toHaveBeenCalled();
      expect(storedHtml(fake)).toContain('picture=""');
    });

  it('still moves the marker in the same update', async () => {
    const { entity, hass, map, fake } = withLiveMarker();
    map.distance.mockReturnValue(500);
    hass.states['geo_location.x'].attributes.latitude = 42.0;
    setPicture(hass, 'https://ha/pic-b.svg');
    await entity.update();
    expect(fake.setLatLng).toHaveBeenCalledTimes(1);
  });
});
