import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { lookupOf, lookedUp, askPhoto, resetLookups, LOOKUP_KEEP_MS, LOOKUP_RETRY_MS } from './PhotoLookup.js';

// 06_MAP_CONTRACT.md D4i (backlog 361; Lee 2026-11-21: looked up on demand): a photo the integration asks for
// when the viewer first hovers the marker. Names and URLs below are invented.

const PATH = '/api/live_track_aircraft/photo/abc123';
const PHOTO = {
  url: 'https://t.example.net/1/1_aa_280.jpg', page: 'https://photos.example.net/photo/1/x?utm_source=api',
  credit: 'Ann Example', source: 'Example Photos', width: 420, height: 280,
};

describe('PhotoLookup (D4i)', () => {
  beforeEach(() => resetLookups());

  it('takes D4h\'s path rule', () => {
    expect(lookupOf(PATH)).toBe(PATH);
    for (const v of [undefined, '', '/local/x', '/api/x//y', '/api/x/', '/api/x?y=1', 'https://x/api/y', 12]) {
      expect(lookupOf(v)).toBeNull();
    }
  });

  it('asks once, without /api/, and keeps the photo', async () => {
    const hass = { callApi: jest.fn(async () => ({ photo: PHOTO })) };
    expect(lookedUp(PATH)).toBeUndefined();
    const p = askPhoto(hass, PATH);
    expect(askPhoto(hass, PATH)).toBeNull();          // in flight: no second ask
    expect(await p).toBe(true);
    expect(hass.callApi).toHaveBeenCalledWith('GET', 'live_track_aircraft/photo/abc123');
    expect(lookedUp(PATH)).toEqual(expect.objectContaining({ url: PHOTO.url, page: PHOTO.page, credit: 'Ann Example' }));
    expect(askPhoto(hass, PATH)).toBeNull();          // held: no second ask
    expect(hass.callApi).toHaveBeenCalledTimes(1);
  });

  it('"none" is an answer too, held as null', async () => {
    const hass = { callApi: jest.fn(async () => ({ photo: null })) };
    expect(await askPhoto(hass, PATH)).toBe(true);
    expect(lookedUp(PATH)).toBeNull();
    expect(askPhoto(hass, PATH)).toBeNull();
  });

  it('a photo the card would refuse (D4g) is held as none', async () => {
    const hass = { callApi: jest.fn(async () => ({ photo: { ...PHOTO, credit: '' } })) };
    await askPhoto(hass, PATH);
    expect(lookedUp(PATH)).toBeNull();
  });

  it('an answer is kept at most 12 h (the integration\'s 12 h on top stays inside 24 h), then asked again', async () => {
    expect(LOOKUP_KEEP_MS).toBe(12 * 3600 * 1000);
    const hass = { callApi: jest.fn(async () => ({ photo: PHOTO })) };
    const t0 = Date.now();
    await askPhoto(hass, PATH, t0);
    expect(lookedUp(PATH, t0 + LOOKUP_KEEP_MS - 60000)).toBeTruthy();
    expect(lookedUp(PATH, Date.now() + LOOKUP_KEEP_MS + 1)).toBeUndefined();
    expect(askPhoto(hass, PATH, Date.now() + LOOKUP_KEEP_MS + 1)).not.toBeNull();
  });

  it('a failed ask shows nothing and is tried again only after 5 min', async () => {
    const hass = { callApi: jest.fn(async () => { throw new Error('502'); }) };
    expect(await askPhoto(hass, PATH)).toBe(false);
    expect(lookedUp(PATH)).toBeUndefined();
    expect(askPhoto(hass, PATH, Date.now() + 1000)).toBeNull();
    expect(askPhoto(hass, PATH, Date.now() + LOOKUP_RETRY_MS + 1)).not.toBeNull();
  });

  it('asks nothing without hass.callApi', () => {
    expect(askPhoto(undefined, PATH)).toBeNull();
    expect(askPhoto({}, PATH)).toBeNull();
  });
});
