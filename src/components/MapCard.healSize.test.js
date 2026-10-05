import { jest, describe, it, expect } from '@jest/globals';
import MapCard from './MapCard.js';

jest.mock('leaflet');
jest.mock('lit', () => ({
  LitElement: class LitElement {
    static get properties() { return {}; }
    static get styles() { return ''; }
    requestUpdate() {}
    connectedCallback() {}
  },
  html: (strings) => strings.join(''),
  css: (strings) => strings.join('')
}));
jest.mock('../util/Logger.js');

// A map built while its box had no size draws one tile in a corner and stays
// that way (Lee's screenshot, 2026-10-05). Every render re-measures when
// Leaflet's remembered size is not the box's.

/**
 * @param {{x: number, y: number}} size what Leaflet remembers
 * @param {number} w box width
 * @param {number} h box height
 * @returns {MapCard}
 */
function card(size, w, h) {
  const c = new MapCard();
  c.map = { getContainer: () => ({ clientWidth: w, clientHeight: h }), getSize: () => size, invalidateSize: jest.fn() };
  return c;
}

describe('_healSize', () => {
  it('a map remembered at 0 x 0 in a real box is re-measured', () => {
    const c = card({ x: 0, y: 0 }, 1586, 1129);
    expect(c._healSize()).toBe(true);
    expect(c.map.invalidateSize).toHaveBeenCalledTimes(1);
  });

  it.each([[1586, 1000], [1000, 1129]])('a change in either dimension (%p x %p) re-measures', (w, h) => {
    const c = card({ x: 1586, y: 1129 }, w, h);
    expect(c._healSize()).toBe(true);
  });

  it('sizes that agree: nothing done', () => {
    const c = card({ x: 1586, y: 1129 }, 1586, 1129);
    expect(c._healSize()).toBe(false);
    expect(c.map.invalidateSize).not.toHaveBeenCalled();
  });

  it.each([[0, 0], [0, 900], [900, 0]])('a box still without size (%p x %p): nothing done', (w, h) => {
    const c = card({ x: 0, y: 0 }, w, h);
    expect(c._healSize()).toBe(false);
    expect(c.map.invalidateSize).not.toHaveBeenCalled();
  });

  it('no map, or a map without the methods, or one that throws: no error', () => {
    const c = new MapCard();
    expect(c._healSize()).toBe(false);
    c.map = {};
    expect(c._healSize()).toBe(false);
    c.map = { getContainer: () => { throw new Error('gone'); }, getSize: () => ({ x: 0, y: 0 }) };
    expect(() => c._healSize()).not.toThrow();
  });

  it('render() heals before drawing', () => {
    const c = card({ x: 0, y: 0 }, 800, 600);
    const order = [];
    c.map.invalidateSize = jest.fn(() => order.push('heal'));
    for (const s of ['pluginsRenderService', 'tileLayersService', 'geoJsonRenderService', 'entitiesRenderService', 'initialViewRenderService']) {
      c[s] = { render: jest.fn(() => order.push(s)) };
    }
    c.setupNeeded = false;
    try { c.render(); } catch { /* the rest of render needs more than this stand-in */ }
    expect(order[0]).toBe('heal');
    expect(order).toContain('entitiesRenderService');
  });
});
