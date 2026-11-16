import { describe, it, expect } from '@jest/globals';
import { apiPath, appendPosition, trackColor, trackOf, trackPoints, TRACK_COLOR_DEFAULT, TRACK_POINTS_MAX } from './TrackLine.js';

// 06_MAP_CONTRACT.md D4h (backlog 348): `marker_track` names where the track is fetched; the card checks it hard.

describe('trackOf', () => {
  it('takes a path under /api/ of plain characters', () => {
    expect(trackOf('/api/live_track_ships/track/366053209')).toBe('/api/live_track_ships/track/366053209');
    expect(trackOf('/api/a-b/c_d/1')).toBe('/api/a-b/c_d/1');
  });
  it('refuses anything else', () => {
    for (const v of [undefined, null, 1, {}, '', '/api/', 'api/x', '/x/api/y', 'https://evil.example/api/x',
      '/api/x/../y', '/api/x?y=1', '/api/x y', '/api//x', '/api/x/', '/api/' + 'a'.repeat(300), '/api/x#y']) {
      expect(trackOf(v)).toBeNull();
    }
  });
  it('callApi takes the path without /api/', () => {
    expect(apiPath('/api/live_track_ships/track/1')).toBe('live_track_ships/track/1');
  });
});

describe('trackPoints', () => {
  it('keeps well-formed [lat, lon, ...] pairs, oldest first', () => {
    expect(trackPoints({ points: [[41.8, -87.6, 1], [41.9, -87.5, 2]] })).toEqual([[41.8, -87.6], [41.9, -87.5]]);
  });
  it('drops malformed points and survives a malformed answer', () => {
    expect(trackPoints({ points: [[91, 0, 1], [0, 181, 1], ['1', 2, 3], [NaN, 1, 1], 'x', null, [1], [1, 2, 3]] }))
      .toEqual([[1, 2]]);
    for (const a of [undefined, null, {}, { points: 'x' }, []]) expect(trackPoints(a)).toEqual([]);
  });
  it('keeps the newest TRACK_POINTS_MAX', () => {
    const pts = Array.from({ length: TRACK_POINTS_MAX + 5 }, (_, i) => [0.001 * (i % 1000), 1, i]);
    const out = trackPoints({ points: pts });
    expect(out.length).toBe(TRACK_POINTS_MAX);
    expect(out[out.length - 1]).toEqual([pts[pts.length - 1][0], 1]);
  });
});

describe('trackColor', () => {
  it("the marker's own hex colour, else the default", () => {
    expect(trackColor({ marker_color: '#123abc' })).toBe('#123abc');
    expect(trackColor({ marker_color: ' #fff ' })).toBe('#fff');
    for (const c of [undefined, 'red', '#12', 'url(x)', '#1234567', 5]) expect(trackColor({ marker_color: c })).toBe(TRACK_COLOR_DEFAULT);
    expect(trackColor(undefined)).toBe(TRACK_COLOR_DEFAULT);
  });
});

describe('appendPosition', () => {
  it('adds a new position, not the same one twice, not a missing one', () => {
    const l = [[1, 2]];
    expect(appendPosition(l, 1, 2)).toBe(false);
    expect(appendPosition(l, 1, 3)).toBe(true);
    expect(appendPosition(l, undefined, 3)).toBe(false);
    expect(appendPosition(l, NaN, 3)).toBe(false);
    expect(l).toEqual([[1, 2], [1, 3]]);
    const e = [];
    expect(appendPosition(e, 5, 6)).toBe(true);
    expect(e).toEqual([[5, 6]]);
  });
});
