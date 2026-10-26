import L from '../models/leafletGlobal.testhelper.js';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { cullMarker, CULL_PAD } from './MarkerCull.js';
import { stats } from './MarkerStats.js';

// A DOM marker more than CULL_PAD of the view off screen leaves the map and comes back when
// the view or its own move brings it in (map capacity, card SSOT 2026-10-25).

let map, div;
const VIEW = [41.9, -67.9];
/**
 * A real map, with its view set unless `view` is false.
 * @param {boolean} [view]
 */
function makeMap(view = true) {
  div = document.createElement('div');
  Object.defineProperty(div, 'clientWidth', { value: 800 });
  Object.defineProperty(div, 'clientHeight', { value: 600 });
  document.body.appendChild(div);
  map = L.map(div, { animate: false, zoomAnimation: false, fadeAnimation: false });
  if (view) map.setView(VIEW, 10);
}
afterEach(() => { map.remove(); div.remove(); jest.restoreAllMocks(); });

const html = '<i></i>';
const marker = (ll) => cullMarker(L.marker(ll, { icon: L.divIcon({ html }) }), map);
/**
 * A point `f` view-widths east of the view's centre.
 * @param {number} f
 * @returns {number[]}
 */
function east(f) {
  const b = map.getBounds();
  return [VIEW[0], VIEW[1] + f * (b.getEast() - b.getWest())];
}

describe('cullMarker', () => {
  beforeEach(() => makeMap());

  it('a marker in view goes on the map; one far off screen does not', () => {
    const near = marker(VIEW).addTo(map);
    const far = marker(east(2)).addTo(map);
    expect(map.hasLayer(near)).toBe(true);
    expect(map.hasLayer(far)).toBe(false);
  });

  it('keeps a margin: inside the padding it stays, past it it goes', () => {
    const inPad = marker(east(0.5 + CULL_PAD * 0.8)).addTo(map);
    const outPad = marker(east(0.5 + CULL_PAD * 1.2)).addTo(map);
    expect(map.hasLayer(inPad)).toBe(true);
    expect(map.hasLayer(outPad)).toBe(false);
  });

  it('its own move brings it in, and takes it out again', () => {
    const m = marker(east(2)).addTo(map);
    const inBefore = stats.culledIn, outBefore = stats.culledOut;
    m.setLatLng(VIEW);
    expect(map.hasLayer(m)).toBe(true);
    expect(stats.culledIn).toBe(inBefore + 1);
    m.setLatLng(east(2));
    expect(map.hasLayer(m)).toBe(false);
    expect(stats.culledOut).toBe(outBefore + 1);
    expect(m.getLatLng().lng).toBeCloseTo(east(2)[1]);
  });

  it('a pan brings it in at moveend', () => {
    const target = east(2);
    const m = marker(target).addTo(map);
    map.setView(target, 10);
    expect(map.hasLayer(m)).toBe(true);
    map.setView(VIEW, 10);
    expect(map.hasLayer(m)).toBe(false);
  });

  it('comes back with the html it was given while it was off', () => {
    const m = marker(east(2)).addTo(map);
    m.options.icon.options.html = '<i data-x="2"></i>';
    m.setLatLng(VIEW);
    expect(m.getElement().innerHTML).toContain('data-x="2"');
  });

  it('remove() takes it off for good: a later move does not bring it back', () => {
    const m = marker(VIEW).addTo(map);
    m.remove();
    expect(map.hasLayer(m)).toBe(false);
    m.setLatLng(VIEW);
    map.setView(VIEW, 11);
    expect(map.hasLayer(m)).toBe(false);
  });

  it('a marker never added is never put on by a move', () => {
    const m = marker(east(2));
    m.setLatLng(VIEW);
    expect(map.hasLayer(m)).toBe(false);
  });

  it('wraps once', () => {
    const m = marker(VIEW);
    const add = m.addTo;
    expect(cullMarker(m, map)).toBe(m);
    expect(m.addTo).toBe(add);
  });
});

describe('a map with no view yet', () => {
  it('keeps every marker on until it loads, then culls', () => {
    makeMap(false);
    const m = cullMarker(L.marker([0, 0], { icon: L.divIcon({ html }) }), map).addTo(map);
    expect(map.hasLayer(m)).toBe(true);
    map.setView(VIEW, 10);
    expect(map.hasLayer(m)).toBe(false);
    expect(m.getElement()).toBeFalsy();
  });

  it('keeps the one in view, and draws it', () => {
    makeMap(false);
    const m = cullMarker(L.marker(VIEW, { icon: L.divIcon({ html }) }), map).addTo(map);
    map.setView(VIEW, 10);
    expect(map.hasLayer(m)).toBe(true);
    expect(m.getElement()).toBeTruthy();
  });

  it('one removed before the first view is never drawn', () => {
    makeMap(false);
    const m = cullMarker(L.marker(VIEW, { icon: L.divIcon({ html }) }), map).addTo(map);
    m.remove();
    map.setView(VIEW, 10);
    expect(map.hasLayer(m)).toBe(false);
    expect(m.getElement()).toBeFalsy();
  });
});
