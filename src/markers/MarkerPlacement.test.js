import L from '../models/leafletGlobal.testhelper.js';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MAP_LAYER_OFFSETS } from '../configs/EntityConfig.js';
import {
  BANDS, BAND_STEP, BAND_BASE, PANE_BASE, bandOf, canvasPane, domPane, ensurePanes, setupPlacement, placement, bandMarker,
} from './MarkerPlacement.js';
import { stats } from './MarkerStats.js';

// 06_MAP_CONTRACT.md D10 (Lee 2026-10-25 23:10): with the canvas on, each class gets its
// canvas pane and its DOM pane, stacked in class order, so the contract holds across both.

let map, div;
beforeEach(() => {
  div = document.createElement('div');
  Object.defineProperty(div, 'clientWidth', { value: 800 });
  Object.defineProperty(div, 'clientHeight', { value: 600 });
  document.body.appendChild(div);
  map = L.map(div, { animate: false, zoomAnimation: false, fadeAnimation: false }).setView([41.9, -67.9], 10);
});
afterEach(() => { map.remove(); div.remove(); jest.restoreAllMocks(); });

const z = (name) => Number(map.getPane(name).style.zIndex);

describe('the classes', () => {
  it('are D10\'s, in the order of their offsets', () => {
    const byOffset = Object.entries(MAP_LAYER_OFFSETS).sort((a, b) => a[1] - b[1]).map(([n]) => n);
    expect(BANDS).toEqual(byOffset);
    BANDS.forEach((name, i) => expect(MAP_LAYER_OFFSETS[name]).toBe(-10000 + i * BAND_STEP));
    expect(BAND_BASE).toBe(-10000);
  });

  // D10 since 83f8d70: weather (-10000) 0, fixed (0) 1, water 2, rail 3, air_low 4, air 5.
  it.each([
    [0, 1], [9999, 1], [10000, 2], [19999, 2], [20000, 3], [30000, 4], [40000, 5], [40123, 5], [99999, 5],
    [-1, 0], [-10000, 0], [-10001, 0], [-50000, 0], [undefined, 1], [null, 1], [NaN, 1], ['20000', 3], ['x', 1],
  ])('bandOf(%p) is %p', (offset, band) => {
    expect(bandOf(offset)).toBe(band);
  });

  it('a class\'s offset falls in that class', () => {
    BANDS.forEach((name, i) => expect(bandOf(MAP_LAYER_OFFSETS[name])).toBe(i));
  });
});

describe('the panes', () => {
  it('are twelve, canvas then DOM for each class, from 601 up', () => {
    ensurePanes(map);
    const order = [];
    BANDS.forEach((_, b) => order.push(canvasPane(b), domPane(b)));
    order.forEach((name, i) => expect(z(name)).toBe(PANE_BASE + i));
    // Leaflet's own panes take their z-index from leaflet.css, which jsdom does not load:
    // markerPane 600, tooltipPane 650.
    expect(PANE_BASE).toBeGreaterThan(600);
    expect(z(domPane(5))).toBeLessThan(650);
  });

  it('every canvas pane lets the pointer through; DOM panes do not', () => {
    ensurePanes(map);
    BANDS.forEach((_, b) => {
      expect(map.getPane(canvasPane(b)).style.pointerEvents).toBe('none');
      expect(map.getPane(domPane(b)).style.pointerEvents).not.toBe('none');
    });
  });

  it('D10 across canvas and DOM: a higher class\'s canvas is above a lower class\'s DOM markers', () => {
    ensurePanes(map);
    for (let lo = 0; lo < BANDS.length; lo++) {
      for (let hi = lo + 1; hi < BANDS.length; hi++) {
        expect(z(canvasPane(hi))).toBeGreaterThan(z(domPane(lo)));
        expect(z(domPane(hi))).toBeGreaterThan(z(canvasPane(lo)));
      }
    }
  });

  it('are made once', () => {
    ensurePanes(map);
    const first = map.getPane(canvasPane(3));
    ensurePanes(map);
    expect(map.getPane(canvasPane(3))).toBe(first);
  });
});

describe('setupPlacement / placement', () => {
  it('is off for a map nobody set up', () => {
    expect(placement(map)).toEqual({ canvas: false, cull: false });
    expect(placement(null)).toEqual({ canvas: false, cull: false });
  });

  it('records the choice; the panes exist only with the canvas', () => {
    setupPlacement(map, { canvas: false, cull: true });
    expect(placement(map)).toEqual({ canvas: false, cull: true });
    expect(map.getPane(canvasPane(1))).toBeUndefined();
    setupPlacement(map, { canvas: true, cull: true });
    expect(placement(map)).toEqual({ canvas: true, cull: true });
    expect(map.getPane(canvasPane(1))).toBeDefined();
  });

  it('takes truthiness, and a null map does nothing', () => {
    setupPlacement(map, { canvas: 1, cull: 0 });
    expect(placement(map)).toEqual({ canvas: true, cull: false });
    expect(() => setupPlacement(null, { canvas: true })).not.toThrow();
  });
});

describe('bandMarker', () => {
  const marker = (offset) => L.marker([41.9, -67.9], { zIndexOffset: offset, icon: L.divIcon({ html: '<b></b>' }) });
  beforeEach(() => ensurePanes(map));

  it('puts a DOM marker in its class\'s pane', () => {
    const m = bandMarker(marker(20000), map).addTo(map);
    expect(m.options.pane).toBe(domPane(3));
    expect(m.getElement().parentNode).toBe(map.getPane(domPane(3)));
  });

  it('moves it to the new class\'s pane when its offset changes class, still on the map', () => {
    const m = bandMarker(marker(20000), map).addTo(map);
    const moves = stats.bandMoves;
    m.setZIndexOffset(40000);
    expect(m.getElement().parentNode).toBe(map.getPane(domPane(5)));
    expect(m.options.zIndexOffset).toBe(40000);
    expect(map.hasLayer(m)).toBe(true);
    expect(stats.bandMoves).toBe(moves + 1);
  });

  it('a change inside the class does not rebuild it', () => {
    const m = bandMarker(marker(20000), map).addTo(map);
    const el = m.getElement();
    m.setZIndexOffset(20005);
    expect(m.getElement()).toBe(el);
    expect(m.options.zIndexOffset).toBe(20005);
  });

  it('a marker off the map just carries the new pane', () => {
    const m = bandMarker(marker(10000), map);
    m.setZIndexOffset(30000);
    expect(map.hasLayer(m)).toBe(false);
    expect(m.options.pane).toBe(domPane(4));
    m.addTo(map);
    expect(m.getElement().parentNode).toBe(map.getPane(domPane(4)));
  });

  it('wraps once', () => {
    const m = bandMarker(marker(0), map);
    const setZ = m.setZIndexOffset;
    expect(bandMarker(m, map)).toBe(m);
    expect(m.setZIndexOffset).toBe(setZ);
  });
});
