import Entity from './Entity.js';
import MapCardEntityMarker from '../components/MapCardEntityMarker.js';
import { resetLookups } from '../util/PhotoLookup.js';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// 06_MAP_CONTRACT.md D4i (backlog 361): the hover box asks for the photo once; when it comes, the open hover box
// shows it and a click opens the D4g popup. Names and URLs are invented.

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');
jest.mock('lit', () => ({ LitElement: class {}, html: () => ({}), css: () => '' }));

void MapCardEntityMarker;
const noop = jest.fn();
const PATH = '/api/live_track_aircraft/photo/abc123';
const PHOTO = {
  url: 'https://t.example.net/1/1_aa_280.jpg', page: 'https://photos.example.net/photo/1/x?utm_source=api',
  credit: 'Ann Example', source: 'Example Photos', width: 420, height: 280,
};

/**
 * @param {object} extra attributes
 * @param {Function} callApi
 * @returns {{entity: Entity, hass: object}}
 */
function makeEntity(extra, callApi) {
  const hass = {
    states: {
      'geo_location.a': {
        state: '1.0',
        attributes: { friendly_name: 'Aircraft ABC123', latitude: 10.5, longitude: 20.5, callsign: 'XYZ1', ...extra },
      },
    },
    callApi,
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => 'x'),
    hassUrl: jest.fn(u => u),
  };
  const config = {
    id: 'geo_location.a', display: 'attribute', attribute: 'callsign',
    prefix: '', suffix: '', label: null, size: 28, color: 'red',
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  return { entity: new Entity(config, hass, map, noop, noop, noop, false), hass };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('marker_photo_lookup (D4i)', () => {
  beforeEach(() => resetLookups());

  it('nothing is asked until the hover box opens; then once; the photo then shows and the popup binds', async () => {
    const callApi = jest.fn(async () => ({ photo: PHOTO }));
    const { entity } = makeEntity({ marker_photo_lookup: PATH }, callApi);
    entity.marker = entity.createMapMarker();
    expect(callApi).not.toHaveBeenCalled();
    expect(entity.marker.getPopup()).toBeUndefined();     // no photo yet: a click is Home Assistant's dialog

    const update = jest.fn();
    entity.marker.isTooltipOpen = () => true;
    entity.marker.getTooltip = () => ({ update });
    expect(entity.tooltipHtml()).not.toContain('hover-photo');
    entity.tooltipHtml();                                  // the clock redraws: still one ask
    await flush();
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(callApi).toHaveBeenCalledWith('GET', 'live_track_aircraft/photo/abc123');
    expect(update).toHaveBeenCalled();                    // the open hover box redrawn
    const h = entity.tooltipHtml();
    expect(h).toContain(`<img src="${PHOTO.url}" width="160" height="107"`);
    expect(h).toContain('Photo: Ann Example, Example Photos');
    const popup = entity.marker.getPopup();
    expect(popup).toBeTruthy();
    const html = popup._content();
    expect(html).toContain(`<a class="ltmc-photo" href="${PHOTO.page}" target="_blank" rel="noopener noreferrer">`);
    expect(html).not.toContain('nofollow');
    expect(callApi).toHaveBeenCalledTimes(1);
  });

  it('"none": no photo, no popup, nothing asked again', async () => {
    const callApi = jest.fn(async () => ({ photo: null }));
    const { entity } = makeEntity({ marker_photo_lookup: PATH }, callApi);
    entity.marker = entity.createMapMarker();
    entity.tooltipHtml();
    await flush();
    expect(entity.tooltipHtml()).not.toContain('hover-photo');
    expect(entity.marker.getPopup()).toBeUndefined();
    expect(callApi).toHaveBeenCalledTimes(1);
  });

  it('a photo of the entity\'s own wins, and nothing is asked', () => {
    const callApi = jest.fn(async () => ({ photo: PHOTO }));
    const own = { ...PHOTO, url: 'https://own.example/p.jpg', credit: 'Own' };
    const { entity } = makeEntity({ marker_photo_lookup: PATH, marker_photo: own }, callApi);
    entity.marker = entity.createMapMarker();
    expect(entity.tooltipHtml()).toContain('https://own.example/p.jpg');
    expect(callApi).not.toHaveBeenCalled();
  });

  it('a malformed path asks nothing', () => {
    const callApi = jest.fn(async () => ({ photo: PHOTO }));
    const { entity } = makeEntity({ marker_photo_lookup: 'https://elsewhere.example/api/x' }, callApi);
    entity.marker = entity.createMapMarker();
    entity.tooltipHtml();
    expect(callApi).not.toHaveBeenCalled();
  });

  it('a marker made after another asked already has the photo and its popup', async () => {
    const callApi = jest.fn(async () => ({ photo: PHOTO }));
    const first = makeEntity({ marker_photo_lookup: PATH }, callApi).entity;
    first.marker = first.createMapMarker();
    first.tooltipHtml();
    await flush();
    const second = makeEntity({ marker_photo_lookup: PATH }, callApi).entity;
    second.marker = second.createMapMarker();
    expect(second.marker.getPopup()).toBeTruthy();
    expect(second.tooltipHtml()).toContain('hover-photo');
    expect(callApi).toHaveBeenCalledTimes(1);
  });
});
