import L from '../models/leafletGlobal.testhelper.js';
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  ShadowEase, SHADOW_EASE_MS, SHADOW_EASE_STEPS, SPRITE_BUDGET_BYTES, shadowParams, isPlain, parseAttrs, canvasMarkerFor, layers, layerFor, topHit,
} from './CanvasMarkerLayer.js';
import { bandMarker, canvasPane, domPane, ensurePanes } from './MarkerPlacement.js';
import { stats } from './MarkerStats.js';

// Map capacity (card SSOT 2026-10-25; Lee 23:10): one canvas per D10 class under that class's
// DOM markers; the pointer tries the top class first; the ground shadow eases over 3 s.

const TAG = 'live-track-map-card-entity-marker';
let clock, frames, nextId, map, div, filters, ctxs;

/**
 * A 2D context that records what is drawn. jsdom has no canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {object}
 */
function fakeCtx(canvas) {
  const ctx = {
    canvas, arcs: [], images: [], texts: [], _filter: 'none',
    get filter() { return this._filter; },
    set filter(v) { this._filter = v; filters.push(v); },
  };
  for (const name of ['setTransform', 'clearRect', 'beginPath', 'fill', 'stroke', 'save', 'restore', 'translate',
    'rotate', 'scale', 'moveTo', 'lineTo', 'closePath', 'clip']) ctx[name] = () => {};
  ctx.arc = (x, y, r) => ctx.arcs.push({ x, y, r });
  ctx.drawImage = (...a) => ctx.images.push(a);
  ctx.fillText = (t, x, y) => ctx.texts.push({ t, x, y });
  ctxs.push(ctx);
  return ctx;
}

beforeEach(() => {
  clock = 1000; frames = new Map(); nextId = 1; filters = []; ctxs = [];
  jest.spyOn(performance, 'now').mockImplementation(() => clock);
  globalThis.requestAnimationFrame = jest.fn((cb) => { const id = nextId++; frames.set(id, cb); return id; });
  globalThis.cancelAnimationFrame = jest.fn((id) => frames.delete(id));
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
    return this.__ctx || (this.__ctx = fakeCtx(this));
  });
  globalThis.fetch = jest.fn(() => Promise.reject(new Error('no network in tests')));
  div = document.createElement('div');
  Object.defineProperty(div, 'clientWidth', { value: 800 });
  Object.defineProperty(div, 'clientHeight', { value: 600 });
  document.body.appendChild(div);
  map = L.map(div, { animate: false, zoomAnimation: false, fadeAnimation: false }).setView([41.9, -67.9], 10);
  ensurePanes(map);
});
afterEach(() => { map.remove(); div.remove(); jest.restoreAllMocks(); delete globalThis.fetch; });

/**
 * Advance the clock and run the frames that were pending.
 * @param {number} [ms]
 */
function tick(ms = 16) {
  clock += ms;
  const pending = [...frames.values()];
  frames.clear();
  for (const cb of pending) cb(clock);
}
/**
 * Let the animation check's fetch chain settle (timers are real here; only frames are faked).
 * @returns {Promise<void>}
 */
const flush = () => new Promise((r) => setTimeout(r, 0));
/**
 * ASCII text as bytes (jsdom's environment has no TextEncoder).
 * @param {string} s
 * @returns {Uint8Array}
 */
const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/**
 * A DOM marker as Entity builds one: its look in the DivIcon html.
 * @param {object} [o]
 * @param {number} [o.z] zIndexOffset
 * @param {number[]} [o.ll] position
 * @param {object} [o.attrs] marker attributes over the defaults
 * @returns {object} a Leaflet marker, not on the map
 */
function domMarker({ z = 0, ll = [41.9, -67.9], attrs = {} } = {}) {
  const a = { 'entity-id': 'geo_location.x', size: '24', color: '#ff0000', ...attrs };
  const s = Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
  return L.marker(ll, { zIndexOffset: z, icon: L.divIcon({ html: `<${TAG} ${s}></${TAG}>` }) });
}
const entity = (id = 'geo_location.x') => ({ id, map, config: {}, _startTooltipClock: jest.fn(), _stopTooltipClock: jest.fn() });

/**
 * What createMapMarker does with the canvas on: the DOM marker banded, then a canvas stand-in if plain.
 * @param {object} [o] as domMarker
 * @returns {object} the marker on the map, canvas or DOM
 */
function place(o) {
  const dom = bandMarker(domMarker(o), map);
  const c = canvasMarkerFor(dom, entity(), TAG);
  return (c || dom).addTo(map);
}

describe('shadowParams', () => {
  // D4a-shadow: at the live 60 px marker, 1.5 px on the ground to 8.7 px at 40,000 ft.
  it('pins the contract\'s numbers at 60 px', () => {
    expect(shadowParams('0', 60)).toEqual({ off: 1.5, blur: 1.1, op: 0.55, key: '1.5/1.1/0.55' });
    expect(shadowParams('12192', 60)).toEqual({ off: 8.7, blur: 3.6, op: 0.3, key: '8.7/3.6/0.3' });
    expect(shadowParams('99999', 60)).toEqual(shadowParams('12192', 60));
    expect(shadowParams('-30', 60)).toEqual(shadowParams('0', 60));
  });
  it.each([undefined, null, '', 'level', 'undefined'])('none for %p', (alt) => {
    expect(shadowParams(alt, 60)).toBeNull();
  });
  it('none without a size', () => expect(shadowParams('3000', 0)).toBeNull());
});

describe('ShadowEase', () => {
  const lo = shadowParams('0', 60), hi = shadowParams('12192', 60);

  it('shows its first shadow at once', () => {
    const e = new ShadowEase(lo);
    expect(e.at(0)).toBe(lo);
    expect(e.moving(0)).toBe(false);
  });

  it('eases linearly over 3 s, as `transition: filter 3s linear`', () => {
    const e = new ShadowEase(lo);
    e.to(hi, 0);
    expect(e.at(0).off).toBe(lo.off);
    expect(e.at(SHADOW_EASE_MS / 2).off).toBeCloseTo((lo.off + hi.off) / 2, 1);
    expect(e.at(SHADOW_EASE_MS / 2).op).toBeCloseTo((lo.op + hi.op) / 2, 2);
    expect(e.at(SHADOW_EASE_MS)).toBe(hi);
    expect(e.moving(SHADOW_EASE_MS / 2)).toBe(true);
    expect(e.moving(SHADOW_EASE_MS)).toBe(false);
    expect(SHADOW_EASE_MS).toBe(3000);
  });

  it('a change mid-ease starts from what is shown, not from where the last one began', () => {
    const e = new ShadowEase(lo);
    e.to(hi, 0);
    const shown = e.at(1500);
    e.to(lo, 1500);
    expect(e.at(1500).off).toBeCloseTo(shown.off, 1);
    expect(e.at(1500 + SHADOW_EASE_MS)).toBe(lo);
  });

  it('the same shadow again does not restart it', () => {
    const e = new ShadowEase(lo);
    e.to(hi, 0);
    e.to(shadowParams('12192', 60), 1500);
    expect(e.at(SHADOW_EASE_MS)).toBe(hi);
  });

  it('a shadow that appears eases in from nothing', () => {
    const e = new ShadowEase(null);
    e.to(hi, 0);
    expect(e.at(0)).toMatchObject({ off: 0, blur: 0, op: 0 });
    expect(e.at(1500).off).toBeCloseTo(hi.off / 2, 0);
    expect(e.at(3000)).toBe(hi);
  });

  it('a shadow that goes away is gone at once', () => {
    const e = new ShadowEase(lo);
    e.to(hi, 0);
    e.to(null, 1000);
    expect(e.at(1000)).toBeNull();
    expect(e.moving(1000)).toBe(false);
  });

  it('moves in 100 ms steps, so the largest ease has at most 31 distinct shadows', () => {
    const e = new ShadowEase(lo);
    e.to(hi, 0);
    const keys = new Set();
    for (let t = 0; t <= SHADOW_EASE_MS; t += 16) {
      const p = e.at(t);
      expect(String(p.off)).toMatch(/^\d+(\.\d)?$/);
      keys.add(p.key);
    }
    expect(SHADOW_EASE_STEPS).toBe(30);
    expect(keys.size).toBeLessThanOrEqual(SHADOW_EASE_STEPS + 1);
    expect(keys.size).toBeGreaterThan(SHADOW_EASE_STEPS / 2);
    expect(e.at(99)).toEqual(e.at(0));
    expect(e.at(100)).not.toEqual(e.at(0));
  });
});

describe('isPlain', () => {
  const pic = { picture: '/p.svg', color: 'transparent' };
  it.each([
    ['a picture in its disc', pic, true],
    ['a disc with only a colour', { color: '#123456' }, true],
    ['a ring the colour of the fill', { color: '#123456', 'ring-color': '#123456' }, true],
    ['a bare picture', { ...pic, 'bare-picture': 'true' }, false],
    ['an icon alone', { icon: 'mdi:train' }, false],
    ['a ring of its own colour', { color: '#123456', 'ring-color': '#ffffff' }, false],
    ['a wide ring', { color: '#123456', 'ring-width': '3' }, false],
    ['a label', { color: '#123', label: 'x' }, false],
    ['a prefix', { color: '#123', prefix: 'x' }, false],
    ['a delay badge', { ...pic, 'delay-badge': '+3' }, false],
    ['a pulse', { ...pic, pulse: 'true' }, false],
    ['an alternate', { ...pic, alternate: 'x' }, false],
    ['a shape', { color: '#123', shape: 'star' }, false],
    ['a symbol', { color: '#123', symbol: 'maple' }, false],
    ['a heading tag', { ...pic, 'label-placement': 'heading' }, false],
    ['a place icon', { ...pic, 'place-icon': 'mdi:home' }, false],
  ])('%s: %p', (_, a, plain) => expect(isPlain(a)).toBe(plain));
  it('reads the attributes Entity writes', () => {
    expect(parseAttrs(`<${TAG} picture="/p.svg" size='60' entity-id="geo_location.x"></${TAG}>`))
      .toEqual({ picture: '/p.svg', size: '60', 'entity-id': 'geo_location.x' });
  });
});

describe('what goes on the canvas', () => {
  it('only geo_location entities: a person or a zone stays DOM, in its order with the others', () => {
    for (const id of ['person.lee', 'zone.home', 'device_tracker.phone', 'sensor.x']) {
      expect(canvasMarkerFor(bandMarker(domMarker({ attrs: { picture: '/me.jpg' } }), map), entity(id), TAG)).toBeNull();
    }
    expect(canvasMarkerFor(bandMarker(domMarker({ attrs: { picture: '/b737.svg' } }), map), entity('geo_location.a'), TAG)).not.toBeNull();
  });

  it('a picture that has not loaded draws its disc and border, as the DOM does, not nothing', () => {
    const m = place({ z: 0, attrs: { picture: '/broken.jpg', size: '40', color: '#757575' } });
    m.layer._img = () => null;
    m.layer.dirty();
    tick();
    const p = map.latLngToLayerPoint(m.getLatLng());
    const arcs = m.layer._ctx.arcs.filter((a) => a.x === p.x && a.y === p.y);
    expect(arcs.map((a) => a.r)).toEqual([20, 19.5]);
  });

  it('a transparent picture that has not loaded draws nothing, as the DOM shows nothing', () => {
    const m = place({ z: 40000, attrs: { picture: '/b737.svg', size: '60', color: 'transparent' } });
    m.layer._img = () => null;
    m.layer._ctx.arcs.length = 0;
    m.layer.dirty();
    tick();
    expect(m.layer._ctx.arcs).toHaveLength(0);
  });
});

describe('one canvas per D10 class', () => {
  it('a plain marker goes on its class\'s canvas, in that class\'s canvas pane', () => {
    const jet = place({ z: 40000 });
    const boat = place({ z: 10000 });
    const ls = layers(map);
    expect(ls[5]._items.has(jet)).toBe(true);
    expect(ls[2]._items.has(boat)).toBe(true);
    expect(ls[1]).toBeUndefined();
    expect(ls[5]._container.parentNode).toBe(map.getPane(canvasPane(5)));
    expect(ls[2]._container.parentNode).toBe(map.getPane(canvasPane(2)));
  });

  it('D10 across canvas and DOM: a canvas jet is above a DOM buoy, train and helicopter', () => {
    place({ z: 40000 });
    const buoy = place({ z: 0, attrs: { 'ring-width': '3' } });
    const train = place({ z: 20000, attrs: { 'ring-color': '#ffffff' } });
    const heli = place({ z: 30000, attrs: { 'ring-width': '3' } });
    const zOf = (el) => Number(el.style.zIndex);
    const jetPane = layers(map)[5]._container.parentNode;
    for (const dom of [buoy, train, heli]) {
      expect(dom.getElement).toBeDefined();
      const pane = dom.getElement().parentNode;
      expect(zOf(jetPane)).toBeGreaterThan(zOf(pane));
    }
    expect(heli.getElement().parentNode).toBe(map.getPane(domPane(4)));
  });

  it('a DOM marker above a canvas one stays above it: a ringed jet over a canvas boat', () => {
    place({ z: 10000 });
    const ringedJet = place({ z: 40000, attrs: { 'ring-width': '3' } });
    const zOf = (el) => Number(el.style.zIndex);
    expect(zOf(ringedJet.getElement().parentNode)).toBeGreaterThan(zOf(layers(map)[2]._container.parentNode));
  });

  it('inside one canvas, drawn by offset, then from the top of the screen down (as Leaflet stacks)', () => {
    const lowY = place({ z: 20000, ll: [41.80, -67.95] });
    const highZ = place({ z: 20010, ll: [41.95, -67.90] });
    const highY = place({ z: 20000, ll: [41.95, -67.85] });
    tick();
    const ctx = layers(map)[3]._ctx;
    const last = ctx.arcs.slice(-3).map((a) => a.x);
    const x = (m) => map.latLngToLayerPoint(m.getLatLng()).x;
    expect(last).toEqual([x(highY), x(lowY), x(highZ)]);
  });
});

describe('the pointer', () => {
  it('a point covered by two classes promotes the top one', () => {
    const boat = place({ z: 10000, attrs: { 'entity-id': 'geo_location.boat' } });
    const jet = place({ z: 40000, attrs: { 'entity-id': 'geo_location.jet' } });
    tick();
    const pt = map.latLngToLayerPoint(L.latLng(41.9, -67.9));
    expect(topHit(map, pt)).toBe(jet);
    map.fire('mousemove', { layerPoint: pt });
    expect(jet.mode).toBe('hover');
    expect(boat.mode).toBe('canvas');
    expect(map.__ltmcHover).toBe(jet);
    expect(jet.dom.getElement().parentNode).toBe(map.getPane(domPane(5)));
  });

  it('promoting another marker, in another class, puts the first back', () => {
    const boat = place({ z: 10000, ll: [41.8, -67.9] });
    const jet = place({ z: 40000, ll: [41.95, -67.8] });
    tick();
    map.fire('mousemove', { layerPoint: map.latLngToLayerPoint(jet.getLatLng()) });
    map.fire('mousemove', { layerPoint: map.latLngToLayerPoint(boat.getLatLng()) });
    expect(boat.mode).toBe('hover');
    expect(jet.mode).toBe('canvas');
    expect(map.hasLayer(jet.dom)).toBe(false);
  });

  it('a tap dispatches the card\'s hass-action for the top marker', () => {
    place({ z: 10000, attrs: { 'entity-id': 'geo_location.boat' } });
    place({ z: 40000, attrs: { 'entity-id': 'geo_location.jet' } });
    tick();
    const got = [];
    map.getContainer().addEventListener('hass-action', (e) => got.push(e.detail));
    map.fire('click', { layerPoint: map.latLngToLayerPoint(L.latLng(41.9, -67.9)) });
    expect(got).toHaveLength(1);
    expect(got[0].config.entity).toBe('geo_location.jet');
    expect(got[0].action).toBe('tap');
  });

  it('empty map space does nothing', () => {
    place({ z: 40000 });
    tick();
    map.fire('mousemove', { layerPoint: L.point(5, 5) });
    expect(map.__ltmcHover).toBeFalsy();
  });

  it('removing the hovered marker clears the hover', () => {
    const jet = place({ z: 40000 });
    tick();
    map.fire('mousemove', { layerPoint: map.latLngToLayerPoint(jet.getLatLng()) });
    jet.remove();
    expect(map.__ltmcHover).toBeNull();
    expect(map.hasLayer(jet.dom)).toBe(false);
  });

  it('with every canvas gone, the map stops listening', () => {
    place({ z: 40000 });
    place({ z: 10000 });
    expect(map.__ltmcCanvasEvents).toBe(true);
    for (const l of [...layers(map)]) if (l) map.removeLayer(l);
    expect(map.__ltmcCanvasEvents).toBe(false);
    expect(layers(map).some(Boolean)).toBe(false);
  });
});

describe('a change of class (a changed map_layer)', () => {
  it('moves a canvas marker to the new class\'s canvas, and its DOM marker\'s pane with it', () => {
    const m = place({ z: 10000 });
    const moves = stats.bandMoves;
    m.setZIndexOffset(40000);
    expect(layers(map)[2]._items.has(m)).toBe(false);
    expect(layers(map)[5]._items.has(m)).toBe(true);
    expect(m.layer).toBe(layers(map)[5]);
    expect(m.dom.options.pane).toBe(domPane(5));
    expect(stats.bandMoves).toBeGreaterThan(moves);
  });

  it('a hovered marker is put back first, so the hover follows the pointer, not the class', () => {
    const m = place({ z: 10000 });
    tick();
    map.fire('mousemove', { layerPoint: map.latLngToLayerPoint(m.getLatLng()) });
    m.setZIndexOffset(40000);
    expect(m.mode).toBe('canvas');
    expect(map.__ltmcHover).toBeNull();
  });

  it('a change inside the class keeps the canvas', () => {
    const m = place({ z: 20000 });
    m.setZIndexOffset(20500);
    expect(m.layer).toBe(layers(map)[3]);
    expect(m.z).toBe(20500);
  });

  it('a look that stops being plain becomes its DOM marker, in its class\'s pane', () => {
    const m = place({ z: 20000 });
    m.getElement().querySelector().setAttribute('ring-width', '3');
    expect(m.mode).toBe('dom');
    expect(m.dom.getElement().parentNode).toBe(map.getPane(domPane(3)));
  });
});

describe('the ground shadow on the canvas (D4a-shadow)', () => {
  const IMG = { complete: true, naturalWidth: 60, naturalHeight: 60 };
  /**
   * A 60 px aircraft picture with a shadow, drawn.
   * @param {string} alt ground-shadow altitude
   * @returns {object} the canvas marker
   */
  function plane(alt) {
    const m = place({ z: 40000, attrs: { picture: '/plane.svg', size: '60', color: 'transparent', 'ground-shadow': alt } });
    m.layer._img = () => IMG;
    m.layer.dirty();
    tick();
    return m;
  }
  const offOf = (f) => Number(/drop-shadow\(([\d.]+)px/.exec(f)[1]);

  it('is drawn with the DOM\'s numbers', () => {
    plane('0');
    expect(filters.at(-1)).toBe('drop-shadow(1.5px 1.5px 1.1px rgba(0, 0, 0, 0.55))');
  });

  it('eases to a new altitude over 3 s, then stops asking for frames', () => {
    const m = plane('0');
    m.getElement().querySelector().setAttribute('ground-shadow', '12192');
    tick(16);
    expect(offOf(filters.at(-1))).toBeCloseTo(1.5, 0);
    tick(1500);
    const mid = offOf(filters.at(-1));
    expect(mid).toBeGreaterThan(4.5);
    expect(mid).toBeLessThan(5.7);
    for (let t = 0; t < 1600; t += 16) tick(16);
    expect(filters.at(-1)).toBe('drop-shadow(8.7px 8.7px 3.6px rgba(0, 0, 0, 0.3))');
    tick(16);
    expect(frames.size).toBe(0);
  });

  it('builds at most 31 sprites over the largest ease, not one a frame', () => {
    const m = plane('0');
    const before = stats.spritesBuilt;
    m.getElement().querySelector().setAttribute('ground-shadow', '12192');
    for (let t = 0; t <= SHADOW_EASE_MS + 32; t += 16) tick(16);
    const built = stats.spritesBuilt - before;
    expect(built).toBeGreaterThan(10);
    expect(built).toBeLessThanOrEqual(SHADOW_EASE_STEPS + 1);
  });

  it('a shadow that goes away is gone at the next frame', () => {
    const m = plane('9750');
    m.getElement().querySelector().setAttribute('ground-shadow', '');
    expect(m.sh.at(clock)).toBeNull();
    expect(m.sh.moving(clock)).toBe(false);
  });
});

describe('the sprite cache', () => {
  it('stays within its byte budget, oldest out first, keeping the sprite just built', () => {
    // 600 px sprites, ~1.8 MB each: the budget fills after a dozen or so.
    const m = place({ z: 40000, attrs: { picture: '/big.svg', size: '600', color: 'transparent', 'ground-shadow': '0', rotation: '0' } });
    m.layer._img = () => ({ complete: true, naturalWidth: 600, naturalHeight: 600 });
    const evicted = stats.spritesEvicted;
    let lastKey = null;
    for (let deg = 0; deg < 40; deg++) {
      m.getElement().querySelector().setAttribute('rotation', String(deg));
      tick();
      lastKey = [...m.layer._sprites.keys()].at(-1);
      expect(lastKey).toContain(`|${deg}|`);
    }
    const sum = [...m.layer._sprites.values()].reduce((n, s) => n + s.bytes, 0);
    expect(m.layer._spriteBytes).toBe(sum);
    expect(sum).toBeLessThanOrEqual(SPRITE_BUDGET_BYTES);
    expect(m.layer._sprites.size).toBeGreaterThan(5);
    expect(m.layer._sprites.size).toBeLessThan(40);
    expect(stats.spritesEvicted - evicted).toBe(40 - m.layer._sprites.size);
    expect([...m.layer._sprites.keys()].some((k) => k.includes('|0|'))).toBe(false);
  });

  it('a sprite used again moves to the back of the queue, so the angle on screen is not evicted', () => {
    const m = place({ z: 40000, attrs: { picture: '/big.svg', size: '600', color: 'transparent', rotation: '0' } });
    m.layer._img = () => ({ complete: true, naturalWidth: 600, naturalHeight: 600 });
    tick();
    const first = [...m.layer._sprites.keys()][0];
    const sprite = m.layer._sprites.get(first);
    const built = stats.spritesBuilt;
    for (let deg = 1; deg < 40; deg++) {
      m.getElement().querySelector().setAttribute('rotation', String(deg));
      tick();
      m.getElement().querySelector().setAttribute('rotation', '0');
      tick();
    }
    // The same sprite, never evicted and rebuilt: one new sprite per new angle, none for 0.
    expect(m.layer._sprites.get(first)).toBe(sprite);
    expect(stats.spritesBuilt - built).toBe(39);
  });
});

describe('an animated picture', () => {
  it('found animated, leaves every canvas for its DOM marker, in every class, after ONE fetch', async () => {
    const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg"><animateTransform/></svg>');
    globalThis.fetch = jest.fn(() => Promise.resolve({
      ok: true, arrayBuffer: () => Promise.resolve(svg.buffer), headers: { get: () => 'image/svg+xml' },
    }));
    const heli = place({ z: 30000, attrs: { picture: '/heli.svg?t=1' } });
    const sar = place({ z: 10000, attrs: { picture: '/heli.svg?t=2' } });
    expect(heli.mode).toBe('canvas');
    await flush();
    expect(heli.mode).toBe('dom');
    expect(sar.mode).toBe('dom');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(heli.dom.getElement().parentNode).toBe(map.getPane(domPane(4)));
    expect(sar.dom.getElement().parentNode).toBe(map.getPane(domPane(2)));
    expect(canvasMarkerFor(bandMarker(domMarker({ z: 40000, attrs: { picture: '/heli.svg' } }), map), entity(), TAG)).toBeNull();
  });

  it('a still picture stays on the canvas', async () => {
    const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
    globalThis.fetch = jest.fn(() => Promise.resolve({
      ok: true, arrayBuffer: () => Promise.resolve(svg.buffer), headers: { get: () => 'image/svg+xml' },
    }));
    const jet = place({ z: 40000, attrs: { picture: '/b737.svg' } });
    await flush();
    expect(jet.mode).toBe('canvas');
  });
});

describe('layerFor', () => {
  it('makes its panes itself on a map nobody set up', () => {
    const d2 = document.createElement('div');
    Object.defineProperty(d2, 'clientWidth', { value: 400 });
    Object.defineProperty(d2, 'clientHeight', { value: 300 });
    document.body.appendChild(d2);
    const m2 = L.map(d2, { animate: false, zoomAnimation: false, fadeAnimation: false }).setView([41.9, -67.9], 10);
    try {
      expect(m2.getPane(canvasPane(3))).toBeUndefined();
      const l = layerFor(m2, 3);
      expect(l._container.parentNode).toBe(m2.getPane(canvasPane(3)));
    } finally {
      m2.remove();
      d2.remove();
    }
  });

  it('makes one layer per class and hands back the same one', () => {
    const a = layerFor(map, 4);
    expect(layerFor(map, 4)).toBe(a);
    expect(a.band).toBe(4);
    expect(a.options.pane).toBe(canvasPane(4));
    expect(layerFor(map, 2)._anim).toBe(a._anim);
  });
});
