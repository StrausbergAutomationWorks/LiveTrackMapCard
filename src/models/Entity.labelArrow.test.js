import Entity from './Entity.js';
import { jest, describe, it, expect } from '@jest/globals';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
// EntityConfig NOT mocked: parseMarkerColor() is part of the rule under test.
jest.mock('./EntityHistoryManager.js');

// Backlog 238: marker_label_color and a separately turning arrow.
// First emitter, Live Track South Shore: Lakeshore #EF8322 fill with a
// #7F281F label, Monon the swap, bearing in icon_rotation_deg.

/**
 * An entity on a fake map, with Lakeshore attributes unless overridden.
 * @param {object} [o]
 * @param {object} [o.attrs] attributes to merge or, with undefined values, delete
 * @param {object} [o.config] EntityConfig fields to override
 * @returns {{entity: Entity, attributes: object}}
 */
function makeEntity({ attrs = {}, config = {} } = {}) {
  const attributes = {
    friendly_name: 'X', latitude: 41.6, longitude: -87.3, marker_label: '601',
    marker_color: '#EF8322', marker_label_color: '#7F281F', icon_rotation_deg: 64.5,
  };
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) delete attributes[k]; else attributes[k] = v;
  }
  const hass = {
    states: { 'geo_location.x': { state: '1', attributes } },
    formatEntityState: () => 'S', formatEntityAttributeValue: () => 'A', hassUrl: (u) => u,
  };
  const cfg = {
    id: 'geo_location.x', display: 'marker', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 24, color: '#757575', configuredColor: null,
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, positionTransition: 0, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 2,
    arrowAttribute: 'icon_rotation_deg', configuredLabelColor: null,
    ...config,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  return { entity: new Entity(cfg, hass, map, jest.fn(), jest.fn(), jest.fn(), false), attributes };
}

const attrIn = (html, name) => (html.match(new RegExp(`\\s${name}="([^"]*)"`)) ?? [])[1];

describe('markerLabelColor', () => {
  it('reads marker_label_color', () => {
    expect(makeEntity().entity.markerLabelColor).toBe('#7F281F');
  });

  it.each(['#7F281Fff', '#abc', 'red', 'rgb(1,2,3)', '', null, 7])('ignores %p as absent (D4a rule 2)', (v) => {
    expect(makeEntity({ attrs: { marker_label_color: v } }).entity.markerLabelColor).toBeNull();
  });

  it('is null when the attribute is absent', () => {
    expect(makeEntity({ attrs: { marker_label_color: undefined } }).entity.markerLabelColor).toBeNull();
  });

  it("the dashboard's label_color wins", () => {
    expect(makeEntity({ config: { configuredLabelColor: '#FFFF00' } }).entity.markerLabelColor).toBe('#FFFF00');
  });

  it("is IGNORED under a dashboard fill: the emitter chose it for its own fill", () => {
    expect(makeEntity({ config: { configuredColor: '#8B0000' } }).entity.markerLabelColor).toBeNull();
  });

  it('a dashboard fill with a dashboard label_color uses the latter', () => {
    const { entity } = makeEntity({ config: { configuredColor: '#8B0000', configuredLabelColor: '#FFFFFF' } });
    expect(entity.markerLabelColor).toBe('#FFFFFF');
  });
});

describe('arrowDegrees', () => {
  it('reads the configured attribute', () => {
    expect(makeEntity().entity.arrowDegrees()).toBe(64.5);
  });

  it('is null with no arrow_attribute, whatever the entity carries', () => {
    expect(makeEntity({ config: { arrowAttribute: null } }).entity.arrowDegrees()).toBeNull();
  });

  it.each([undefined, null, '', 'north', NaN, Infinity])('is null for %p - no arrow (D0)', (v) => {
    expect(makeEntity({ attrs: { icon_rotation_deg: v } }).entity.arrowDegrees()).toBeNull();
  });

  it('accepts a numeric string and normalises the first angle', () => {
    expect(makeEntity({ attrs: { icon_rotation_deg: '370' } }).entity.arrowDegrees()).toBe(10);
    expect(makeEntity({ attrs: { icon_rotation_deg: -10 } }).entity.arrowDegrees()).toBe(350);
  });

  it('stays continuous across north, both ways, and across a gap', () => {
    const { entity, attributes } = makeEntity({ attrs: { icon_rotation_deg: 350 } });
    const seq = [];
    for (const v of [350, 10, 20, 340, undefined, 330]) {
      if (v === undefined) delete attributes.icon_rotation_deg; else attributes.icon_rotation_deg = v;
      seq.push(entity.arrowDegrees());
    }
    expect(seq).toEqual([350, 370, 380, 340, null, 330]);
  });

  it('runs separately from the picture rotation', () => {
    const { entity, attributes } = makeEntity({ config: { rotationAttribute: 'heading' }, attrs: { heading: 350 } });
    entity.rotationDegrees();
    attributes.heading = 10;
    expect(entity.rotationDegrees()).toBe(370);
    expect(entity.arrowDegrees()).toBe(64.5);
  });
});

describe('the marker element', () => {
  it('is built with label-color and arrow, and no picture rotation', () => {
    const html = makeEntity().entity.createMapMarker().options.icon.options.html;
    expect(attrIn(html, 'label-color')).toBe('#7F281F');
    expect(attrIn(html, 'arrow')).toBe('64.5');
    expect(attrIn(html, 'rotation')).toBe('');
    expect(attrIn(html, 'color')).toBe('#EF8322');
  });

  it('is built with both empty when there is nothing to draw', () => {
    const { entity } = makeEntity({ attrs: { marker_label_color: undefined, icon_rotation_deg: undefined } });
    const html = entity.createMapMarker().options.icon.options.html;
    expect(attrIn(html, 'label-color')).toBe('');
    expect(attrIn(html, 'arrow')).toBe('');
  });

  /**
   * An entity whose marker is a stand-in holding the real DivIcon html.
   * @param {object} [o] as makeEntity
   * @returns {object}
   */
  function live(o) {
    const made = makeEntity(o);
    const real = made.entity.createMapMarker();
    const el = { setAttribute: jest.fn() };
    made.entity.marker = { options: real.options, getElement: () => ({ querySelector: () => el }),
      remove: jest.fn(), setLatLng: jest.fn(), getLatLng: jest.fn() };
    made.entity._lastSetLatLng = made.entity.latLng;
    made.entity._currentPlaceIcon = made.entity.placeIcon;
    made.entity._currentTitle = made.entity.title;
    const createSpy = jest.spyOn(made.entity, 'createMapMarker');
    const html = () => made.entity.marker.options.icon.options.html;
    return { ...made, el, createSpy, html };
  }

  it('updates both IN PLACE on update(), in the element and the stored html, without a rebuild', async () => {
    const { entity, attributes, el, createSpy, html } = live();
    attributes.icon_rotation_deg = 250;
    attributes.marker_label_color = '#EF8322';
    await entity.update();
    // 64.5 -> 250 is 174.5 anticlockwise, the short way: -110, not 250.
    expect(el.setAttribute).toHaveBeenCalledWith('arrow', '-110');
    expect(el.setAttribute).toHaveBeenCalledWith('label-color', '#EF8322');
    expect(attrIn(html(), 'arrow')).toBe('-110');
    expect(attrIn(html(), 'label-color')).toBe('#EF8322');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('clears the arrow when the bearing goes away, and writes nothing when nothing changed', async () => {
    const { entity, attributes, el, html } = live();
    await entity.update();
    expect(el.setAttribute).not.toHaveBeenCalledWith('arrow', expect.anything());
    delete attributes.icon_rotation_deg;
    await entity.update();
    expect(el.setAttribute).toHaveBeenCalledWith('arrow', '');
    expect(attrIn(html(), 'arrow')).toBe('');
  });

  it('a fill change does not touch label-color, nor a label change the fill', async () => {
    const { entity, attributes, html } = live();
    attributes.marker_color = '#7F281F';
    await entity.update();
    expect(attrIn(html(), 'color')).toBe('#7F281F');
    expect(attrIn(html(), 'label-color')).toBe('#7F281F');
    attributes.marker_label_color = '#EF8322';
    await entity.update();
    expect(attrIn(html(), 'color')).toBe('#7F281F');
    expect(attrIn(html(), 'label-color')).toBe('#EF8322');
  });
});

describe('emitter styling: label outline, arrow colour, arrow outline', () => {
  const STYLE = { marker_label_outline_color: '#EF8322', marker_arrow_color: '#123456', marker_arrow_outline_color: '#FFFFFF' };
  const NONE = { 'label-outline': '', 'arrow-color': '', 'arrow-outline': '', 'ring-color': '', 'ring-width': '', 'shape': '',
  'label-placement': '', 'symbol-color': '', 'symbol-outline': '', symbol: '', alternate: '' };

  it('reads all three', () => {
    expect(makeEntity({ attrs: STYLE }).entity.markerStyling)
      .toEqual({ ...NONE, 'label-outline': '#EF8322', 'arrow-color': '#123456', 'arrow-outline': '#FFFFFF' });
  });

  it.each(['none', ' None '])('label outline %p is "none", no outline (Lee 2026-10-10 00:46)', (v) => {
    expect(makeEntity({ attrs: { marker_label_outline_color: v } }).entity.markerStyling['label-outline']).toBe('none');
    // Only the label outline: "none" is not a colour anywhere else.
    expect(makeEntity({ attrs: { marker_arrow_outline_color: v } }).entity.markerStyling['arrow-outline']).toBe('');
    // A dashboard fill still wins.
    expect(makeEntity({ attrs: { marker_label_outline_color: v }, config: { configuredColor: '#8B0000' } })
      .entity.markerStyling['label-outline']).toBe('');
  });

  it('absent: every one empty, the card default', () => {
    expect(makeEntity().entity.markerStyling).toEqual(NONE);
  });

  it.each(['#abc', 'white', '#FFFFFFFF', 5, null])('ignores %p as absent (D4a rule 2)', (v) => {
    const s = makeEntity({ attrs: { marker_label_outline_color: v, marker_arrow_color: v, marker_arrow_outline_color: v } }).entity.markerStyling;
    expect(s).toEqual(NONE);
  });

  it('ALL are ignored under a dashboard fill, like the label colour', () => {
    const { entity } = makeEntity({ attrs: STYLE, config: { configuredColor: '#8B0000' } });
    expect(entity.markerStyling).toEqual(NONE);
    expect(entity.markerLabelColor).toBeNull();
  });

  it('are built into the marker element', () => {
    const html = makeEntity({ attrs: STYLE }).entity.createMapMarker().options.icon.options.html;
    expect(attrIn(html, 'label-outline')).toBe('#EF8322');
    expect(attrIn(html, 'arrow-color')).toBe('#123456');
    expect(attrIn(html, 'arrow-outline')).toBe('#FFFFFF');
    expect(attrIn(html, 'arrow')).toBe('64.5');
    expect(attrIn(html, 'color')).toBe('#EF8322');
  });

  it('change IN PLACE, only what changed, without a rebuild', async () => {
    const made = makeEntity({ attrs: STYLE });
    const real = made.entity.createMapMarker();
    const el = { setAttribute: jest.fn() };
    made.entity.marker = { options: real.options, getElement: () => ({ querySelector: () => el }),
      remove: jest.fn(), setLatLng: jest.fn(), getLatLng: jest.fn() };
    made.entity._lastSetLatLng = made.entity.latLng;
    made.entity._currentPlaceIcon = made.entity.placeIcon;
    made.entity._currentTitle = made.entity.title;
    const createSpy = jest.spyOn(made.entity, 'createMapMarker');
    await made.entity.update();
    expect(el.setAttribute).not.toHaveBeenCalled();
    made.attributes.marker_arrow_outline_color = '#000000';
    delete made.attributes.marker_label_outline_color;
    await made.entity.update();
    expect(el.setAttribute.mock.calls).toEqual([['arrow-outline', '#000000'], ['label-outline', '']].sort((a, b) =>
      ['label-outline', 'arrow-color', 'arrow-outline'].indexOf(a[0]) - ['label-outline', 'arrow-color', 'arrow-outline'].indexOf(b[0])));
    const html = made.entity.marker.options.icon.options.html;
    expect(attrIn(html, 'arrow-outline')).toBe('#000000');
    expect(attrIn(html, 'label-outline')).toBe('');
    expect(attrIn(html, 'arrow-color')).toBe('#123456');
    expect(attrIn(html, 'arrow')).toBe('64.5');
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('emitter styling: the ring around the disc (marker_ring_color, marker_ring_width)', () => {
  const NONE = { 'label-outline': '', 'arrow-color': '', 'arrow-outline': '', 'ring-color': '', 'ring-width': '', 'shape': '',
  'label-placement': '', 'symbol-color': '', 'symbol-outline': '', symbol: '', alternate: '' };
  const RING = { marker_ring_color: '#000000', marker_ring_width: 2 };

  it('reads colour and width', () => {
    expect(makeEntity({ attrs: RING }).entity.markerStyling)
      .toEqual({ ...NONE, 'ring-color': '#000000', 'ring-width': '2' });
  });

  it('each on its own: a colour with no width, a width with no colour', () => {
    expect(makeEntity({ attrs: { marker_ring_color: '#000000' } }).entity.markerStyling)
      .toEqual({ ...NONE, 'ring-color': '#000000' });
    expect(makeEntity({ attrs: { marker_ring_width: 3 } }).entity.markerStyling)
      .toEqual({ ...NONE, 'ring-width': '3' });
  });

  it.each([0.5, 1, 1.5, 4])('accepts %p px: a number from 0.5 to 4, fractions allowed', (v) => {
    expect(makeEntity({ attrs: { marker_ring_width: v } }).entity.markerStyling['ring-width']).toBe(String(v));
  });

  it.each([0, 0.25, 4.5, 5, -1, '1.5', '', null, true, NaN, Infinity, [2], { w: 2 }])(
    'ignores width %p as absent: a number from 0.5 to 4 and nothing else', (v) => {
      expect(makeEntity({ attrs: { marker_ring_width: v } }).entity.markerStyling['ring-width']).toBe('');
    });

  it.each(['#000', 'black', '#000000FF', 0, null])('ignores colour %p as absent (D4a rule 2)', (v) => {
    expect(makeEntity({ attrs: { marker_ring_color: v } }).entity.markerStyling['ring-color']).toBe('');
  });

  it('BOTH are ignored under a dashboard fill, width included', () => {
    const { entity } = makeEntity({ attrs: RING, config: { configuredColor: '#8B0000' } });
    expect(entity.markerStyling).toEqual(NONE);
  });

  it('are built into the marker element, without disturbing `color`', () => {
    const html = makeEntity({ attrs: RING }).entity.createMapMarker().options.icon.options.html;
    expect(attrIn(html, 'ring-color')).toBe('#000000');
    expect(attrIn(html, 'ring-width')).toBe('2');
    expect(attrIn(html, 'color')).toBe('#EF8322');
  });

  it('change IN PLACE, only what changed, and a fill change leaves ring-color alone', async () => {
    const made = makeEntity({ attrs: RING });
    const real = made.entity.createMapMarker();
    const el = { setAttribute: jest.fn() };
    made.entity.marker = { options: real.options, getElement: () => ({ querySelector: () => el }),
      remove: jest.fn(), setLatLng: jest.fn(), getLatLng: jest.fn() };
    made.entity._lastSetLatLng = made.entity.latLng;
    made.entity._currentPlaceIcon = made.entity.placeIcon;
    made.entity._currentTitle = made.entity.title;
    const createSpy = jest.spyOn(made.entity, 'createMapMarker');
    await made.entity.update();
    expect(el.setAttribute).not.toHaveBeenCalled();
    made.attributes.marker_ring_width = 3;
    await made.entity.update();
    expect(el.setAttribute.mock.calls).toEqual([['ring-width', '3']]);
    el.setAttribute.mockClear();
    made.attributes.marker_color = '#7F281F';
    delete made.attributes.marker_ring_color;
    await made.entity.update();
    expect(el.setAttribute).toHaveBeenCalledWith('ring-color', '');
    expect(el.setAttribute).toHaveBeenCalledWith('color', '#7F281F');
    const html = made.entity.marker.options.icon.options.html;
    expect(attrIn(html, 'ring-color')).toBe('');
    expect(attrIn(html, 'ring-width')).toBe('3');
    expect(attrIn(html, 'color')).toBe('#7F281F');
    expect(createSpy).not.toHaveBeenCalled();
  });
});
