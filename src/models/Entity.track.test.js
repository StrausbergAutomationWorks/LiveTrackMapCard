import Entity from './Entity.js';
import { jest, describe, it, expect } from '@jest/globals';
import { TRACK_COLOR_DEFAULT } from '../util/TrackLine.js';

// 06_MAP_CONTRACT.md D4h (backlog 348; Lee 2026-11-16: "Ships keeps the track and the card asks for it on click"):
// a "Track" button in the click popup fetches the track with the viewer's sign-in and draws it to the marker.

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');
jest.mock('lit', () => ({ LitElement: class {}, html: () => ({}), css: () => '' }));

const noop = jest.fn();
const PATH = '/api/live_track_ships/track/366053209';

/**
 * @param {object} [attrs] extra or replacement attributes for the vessel
 * @param {object} [answer] what hass.callApi answers for the track
 * @returns {{entity: Entity, hass: object, map: object, layers: Set, attrs: object}}
 */
function makeEntity(attrs = {}, answer = { identity: '366053209', hours: 24, points: [[41.80, -87.60, 1], [41.85, -87.58, 2]] }) {
  const hass = {
    states: {
      'geo_location.vessel_366053209': {
        state: '3.0',
        attributes: { friendly_name: 'EDWIN H. GOTT', latitude: 41.88, longitude: -87.55, marker_label: 'GOTT', marker_track: PATH, ...attrs },
      },
    },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => 'GOTT'),
    hassUrl: jest.fn(u => u),
    callApi: jest.fn(async () => answer),
  };
  const config = {
    id: 'geo_location.vessel_366053209', display: 'attribute', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 28, color: 'red',
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  const layers = new Set();
  const map = {
    distance: jest.fn(() => 0), getZoom: jest.fn(() => 10),
    addLayer: jest.fn((l) => { layers.add(l); return map; }),
    removeLayer: jest.fn((l) => { layers.delete(l); return map; }),
    hasLayer: (l) => layers.has(l),
  };
  const entity = new Entity(config, hass, map, noop, noop, noop, false);
  return { entity, hass, map, layers, attrs: hass.states['geo_location.vessel_366053209'].attributes };
}

describe('marker_track (D4h)', () => {
  it('a track alone opens the popup, which offers Track beside Details', () => {
    const { entity } = makeEntity();
    const m = entity.createMapMarker();
    expect(m.options.icon.options.html).toContain('info="true"');
    const html = m.getPopup()._content();
    expect(html).toContain('<button type="button" class="ltmc-track-button">Track</button>');
    expect(html.indexOf('ltmc-track-button')).toBeLessThan(html.indexOf('ltmc-details-button'));
  });

  it('no track, or a bad one: no button', () => {
    for (const t of [undefined, 'https://x.example/api/a', '/api/a/../b']) {
      const { entity, attrs } = makeEntity({ marker_links: [{ label: 'V', url: 'https://v.example/1' }] });
      if (t === undefined) delete attrs.marker_track; else attrs.marker_track = t;
      expect(entity.createMapMarker().getPopup()._content()).not.toContain('ltmc-track-button');
    }
  });

  it('nothing is fetched until the button is pressed; then one GET with the sign-in, drawn to the marker', async () => {
    const { entity, hass, map } = makeEntity();
    const m = entity.createMapMarker();
    expect(hass.callApi).not.toHaveBeenCalled();
    const box = document.createElement('div');
    box.innerHTML = m.getPopup()._content();
    m.closePopup = jest.fn();
    m.closeTooltip = jest.fn();
    m.fire('popupopen', { popup: { getElement: () => box } });
    box.querySelector('.ltmc-track-button').click();
    expect(m.closePopup).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(hass.callApi).toHaveBeenCalledTimes(1);
    expect(hass.callApi).toHaveBeenCalledWith('GET', 'live_track_ships/track/366053209');
    expect(map.addLayer).toHaveBeenCalledTimes(1);
    const line = entity._track.line;
    expect(line.getLatLngs().map((p) => [p.lat, p.lng])).toEqual([[41.80, -87.60], [41.85, -87.58], [41.88, -87.55]]);
    expect(line.options.color).toBe(TRACK_COLOR_DEFAULT);
    expect(line.options.interactive).toBe(false);
    // the popup now offers to hide it
    expect(m.getPopup()._content()).toContain('>Hide track</button>');
  });

  it("the marker's own colour is used when it has one", async () => {
    const { entity } = makeEntity({ marker_color: '#2e7d32' });
    await entity.toggleTrack();
    expect(entity._track.line.options.color).toBe('#2e7d32');
  });

  it('the line grows with each new published position, and not with the same one', async () => {
    const { entity, attrs } = makeEntity();
    await entity.toggleTrack();
    const line = entity._track.line;
    attrs.latitude = 41.90; attrs.longitude = -87.54;
    entity._growTrack();
    expect(line.getLatLngs().length).toBe(4);
    entity._growTrack();
    expect(line.getLatLngs().length).toBe(4);
  });

  it('Hide track takes it off; a second Track fetches again', async () => {
    const { entity, hass, map } = makeEntity();
    expect(await entity.toggleTrack()).toBe(true);
    const line = entity._track.line;
    expect(await entity.toggleTrack()).toBe(false);
    expect(entity._track).toBeNull();
    expect(map.removeLayer).toHaveBeenCalledWith(line);
    await entity.toggleTrack();
    expect(hass.callApi).toHaveBeenCalledTimes(2);
  });

  it('a marker that stops publishing the track, or is removed or hidden, loses the line', async () => {
    const { entity, attrs, map } = makeEntity();
    await entity.toggleTrack();
    delete attrs.marker_track;
    entity._growTrack();
    expect(entity._track).toBeNull();
    attrs.marker_track = PATH;
    await entity.toggleTrack();
    entity.remove();
    expect(entity._track).toBeNull();
    const b = makeEntity();
    await b.entity.toggleTrack();
    b.entity.hide();
    expect(b.entity._track).toBeNull();
    expect(map.removeLayer).toHaveBeenCalled();
  });

  it('a failed fetch draws nothing and says so once in the console', async () => {
    const { entity, hass, map } = makeEntity();
    hass.callApi.mockRejectedValueOnce(new Error('401'));
    expect(await entity.toggleTrack()).toBe(false);
    expect(entity._track ?? null).toBeNull();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it('a second press while the first is loading fetches once', async () => {
    const { entity, hass } = makeEntity();
    const a = entity.toggleTrack();
    const b = entity.toggleTrack();
    await Promise.all([a, b]);
    expect(hass.callApi).toHaveBeenCalledTimes(1);
  });

  it('an empty track still draws the line to where the marker is (one point)', async () => {
    const { entity } = makeEntity({}, { identity: '366053209', hours: 24, points: [] });
    expect(await entity.toggleTrack()).toBe(true);
    expect(entity._track.line.getLatLngs().length).toBe(1);
  });
});
