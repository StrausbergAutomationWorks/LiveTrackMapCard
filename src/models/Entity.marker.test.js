import Entity, { MARKER_TAG } from './Entity.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

const noop = jest.fn();

function makeEntity({
  display = 'marker', picture = 'https://ha/pic-a.svg',
  rotationAttribute = null, rotationTransition = 0, bearing,
} = {}) {
  const hass = {
    states: {
      'geo_location.x': {
        state: '1.0',
        attributes: {
          friendly_name: 'X',
          entity_picture: picture,
          latitude: 41.9,
          longitude: -87.9,
          ...(bearing === undefined ? {} : { icon_rotation_deg: bearing }),
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
    rotationAttribute, rotationTransition,
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

// rotation_attribute: turn the marker's picture by an entity attribute, with
// a CSS transition so a course change slides instead of snapping. Mutated in
// place like the picture - a rebuild would cancel a position transition.
describe('marker rotation', () => {
  function liveMarker(opts) {
    const made = makeEntity({ rotationAttribute: 'icon_rotation_deg', ...opts });
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
  const setBearing = (hass, v) => {
    const a = hass.states['geo_location.x'].attributes;
    if (v === undefined) delete a.icon_rotation_deg; else a.icon_rotation_deg = v;
  };
  const rotationWrites = (el) =>
    el.setAttribute.mock.calls.filter(([name]) => name === 'rotation').map(([, v]) => v);
  const html = (fake) => fake.options.icon.options.html;

  describe('rotationDegrees()', () => {
    it('is null when rotation is not configured', () => {
      const { entity } = makeEntity({ bearing: 90 });
      expect(entity.rotationDegrees()).toBeNull();
    });

    it('is null when the attribute is absent or not a number', () => {
      for (const v of [undefined, null, '', '  ', 'north', true, NaN]) {
        const { entity } = makeEntity({ rotationAttribute: 'icon_rotation_deg', bearing: v });
        expect(entity.rotationDegrees()).toBeNull();
      }
    });

    it('accepts a numeric string', () => {
      const { entity } = makeEntity({ rotationAttribute: 'icon_rotation_deg', bearing: '45.5' });
      expect(entity.rotationDegrees()).toBe(45.5);
    });

    it('starts from the bearing, normalised into 0-360', () => {
      expect(makeEntity({ rotationAttribute: 'icon_rotation_deg', bearing: 90 }).entity.rotationDegrees()).toBe(90);
      expect(makeEntity({ rotationAttribute: 'icon_rotation_deg', bearing: 370 }).entity.rotationDegrees()).toBe(10);
      expect(makeEntity({ rotationAttribute: 'icon_rotation_deg', bearing: -10 }).entity.rotationDegrees()).toBe(350);
    });

    // A CSS transition interpolates the number it is given. 350 -> 10 written
    // as 10 would spin the marker 340 degrees the wrong way.
    it.each([
      ['across north, clockwise', [350, 10], 370],
      ['across north, anticlockwise', [10, 350], -10],
      ['without crossing north', [170, 190], 190],
      ['round and back again', [350, 10, 30, 340], 340],
      ['twice round', [0, 120, 240, 0, 120, 240, 0], 720],
    ])('takes the short way %s', (_, bearings, expected) => {
      const { entity, hass } = makeEntity({ rotationAttribute: 'icon_rotation_deg', bearing: bearings[0] });
      let r;
      for (const b of bearings) { setBearing(hass, b); r = entity.rotationDegrees(); }
      expect(r).toBeCloseTo(expected, 9);
    });

    it('stays continuous across a gap in the attribute', () => {
      const { entity, hass } = makeEntity({ rotationAttribute: 'icon_rotation_deg', bearing: 350 });
      entity.rotationDegrees();
      setBearing(hass, undefined);
      expect(entity.rotationDegrees()).toBeNull();
      setBearing(hass, 10);
      expect(entity.rotationDegrees()).toBe(370);
    });

    it('is stable when asked twice for the same bearing', () => {
      const { entity } = makeEntity({ rotationAttribute: 'icon_rotation_deg', bearing: 350 });
      expect(entity.rotationDegrees()).toBe(entity.rotationDegrees());
    });
  });

  describe('building the marker', () => {
    it('writes rotation and rotation-transition onto the element', () => {
      const { entity } = makeEntity({ rotationAttribute: 'icon_rotation_deg', rotationTransition: 2, bearing: 90 });
      const h = entity.createMapMarker().options.icon.options.html;
      expect(h).toContain('rotation="90"');
      expect(h).toContain('rotation-transition="2"');
      expect(entity._currentRotation).toBe(90);
    });

    it('writes an empty rotation when rotation is off', () => {
      const { entity } = makeEntity({ bearing: 90 });
      const h = entity.createMapMarker().options.icon.options.html;
      expect(h).toContain('rotation=""');
      expect(h).toContain('rotation-transition="0"');
    });
  });

  describe('update()', () => {
    it('pushes a changed angle onto the live element, by OUR tag', async () => {
      const { entity, hass, el, root } = liveMarker({ bearing: 350 });
      setBearing(hass, 10);
      await entity.update();
      expect(root.querySelector).toHaveBeenCalledWith(MARKER_TAG);
      expect(rotationWrites(el)).toEqual(['370']);
      expect(entity._currentRotation).toBe(370);
    });

    it('never recreates the marker', async () => {
      const { entity, hass, fake, createSpy } = liveMarker({ bearing: 350 });
      setBearing(hass, 10);
      await entity.update();
      expect(fake.remove).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(entity.marker).toBe(fake);
    });

    it('rewrites rotation in the stored html and leaves rotation-transition alone', async () => {
      const { entity, hass, fake } = liveMarker({ bearing: 350, rotationTransition: 3 });
      setBearing(hass, 10);
      await entity.update();
      expect(html(fake)).toContain('rotation="370"');
      expect(html(fake)).toContain('rotation-transition="3"');
      expect(html(fake)).not.toContain('rotation="350"');
    });

    it('does nothing when the angle has not changed', async () => {
      const { entity, el, fake } = liveMarker({ bearing: 90 });
      const before = html(fake);
      await entity.update();
      expect(rotationWrites(el)).toEqual([]);
      expect(html(fake)).toBe(before);
    });

    it('does nothing when rotation is not configured', async () => {
      const { entity, hass, el } = liveMarker({ rotationAttribute: null, bearing: 90 });
      setBearing(hass, 180);
      await entity.update();
      expect(rotationWrites(el)).toEqual([]);
    });

    it('clears the angle when the attribute goes, and resumes continuously', async () => {
      const { entity, hass, el, fake } = liveMarker({ bearing: 350 });
      setBearing(hass, undefined);
      await entity.update();
      expect(html(fake)).toContain('rotation=""');
      setBearing(hass, 10);
      await entity.update();
      expect(rotationWrites(el)).toEqual(['', '370']);
    });

    it('applies a new picture and a new angle in the same update', async () => {
      const { entity, hass, el } = liveMarker({ bearing: 90 });
      hass.states['geo_location.x'].attributes.entity_picture = 'https://ha/pic-b.svg';
      setBearing(hass, 180);
      await entity.update();
      expect(el.setAttribute).toHaveBeenCalledWith('picture', 'https://ha/pic-b.svg');
      expect(rotationWrites(el)).toEqual(['180']);
    });

    it('still updates the stored html before the marker is in the DOM', async () => {
      const { entity, hass, fake } = liveMarker({ bearing: 90 });
      fake.getElement.mockReturnValue(null);
      setBearing(hass, 100);
      await entity.update();
      expect(html(fake)).toContain('rotation="100"');
    });
  });
});

// An entity leaving the list must take EVERYTHING it put on the map with it:
// marker, circle, GeoJSON, history trail, and its history stream.
describe('Entity.remove()', () => {
  function withParts(opts) {
    const made = makeEntity(opts);
    const { entity } = made;
    const marker = { remove: jest.fn() };
    entity.marker = marker;
    entity.circle.remove = jest.fn();
    entity.geoJson.remove = jest.fn();
    entity.historyManager.remove = jest.fn();
    made.map.off = jest.fn();
    return { ...made, marker };
  }

  it('takes the marker out of the cluster group it is in', () => {
    const { entity, marker } = withParts();
    const cluster = { hasLayer: jest.fn(() => true), removeLayer: jest.fn() };
    entity.remove(cluster);
    expect(cluster.removeLayer).toHaveBeenCalledWith(marker);
    expect(entity.marker).toBeNull();
  });

  it('takes the marker off the map when it is not clustered', () => {
    const { entity, marker } = withParts();
    entity.remove(null);
    expect(marker.remove).toHaveBeenCalled();
    expect(entity.marker).toBeNull();
  });

  it('does not ask a cluster group to remove a marker it does not hold', () => {
    const { entity, marker } = withParts();
    const cluster = { hasLayer: jest.fn(() => false), removeLayer: jest.fn() };
    entity.remove(cluster);
    expect(cluster.removeLayer).not.toHaveBeenCalled();
    expect(marker.remove).toHaveBeenCalled();
  });

  it('removes the circle, the GeoJSON and the history', () => {
    const { entity } = withParts();
    const { circle, geoJson, historyManager } = entity;
    entity.remove(null);
    expect(circle.remove).toHaveBeenCalled();
    expect(geoJson.remove).toHaveBeenCalled();
    expect(historyManager.remove).toHaveBeenCalledWith({ unsubscribe: true });
  });

  it('can keep the history stream when another marker shares the entity', () => {
    const { entity } = withParts();
    entity.remove(null, { unsubscribeHistory: false });
    expect(entity.historyManager.remove).toHaveBeenCalledWith({ unsubscribe: false });
  });

  it('unbinds the pill zoom handler', () => {
    const { entity, map } = withParts();
    const handler = jest.fn();
    entity._onZoomEnd = handler;
    entity.remove(null);
    expect(map.off).toHaveBeenCalledWith('zoomend', handler);
    expect(entity._onZoomEnd).toBeNull();
  });

  it('is safe with no marker, and safe to call twice', () => {
    const { entity } = withParts();
    entity.marker = null;
    expect(() => { entity.remove(null); entity.remove(null); }).not.toThrow();
  });

  it('stops a removed entity from drawing again', async () => {
    const { entity } = withParts();
    entity.remove(null);
    entity.createMapMarker = jest.fn();
    await entity.update(null);
    expect(entity.createMapMarker).not.toHaveBeenCalled();
    expect(entity.marker).toBeNull();
  });
});
