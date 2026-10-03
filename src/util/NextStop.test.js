import { describe, it, expect } from '@jest/globals';
import { escapeHtml, nextStopLine } from './NextStop.js';

const NOW = Date.parse('2026-10-03T01:00:00+00:00');
const at = (sec) => new Date(NOW + sec * 1000).toISOString();
const a = (next_stop, arrival_estimated_at) => ({ next_stop, arrival_estimated_at });

describe('nextStopLine', () => {
  it('reads "<station> in <n> min", Lee\'s wording', () => {
    expect(nextStopLine(a('Irving Park', at(240)), NOW)).toBe('Irving Park in 4 min');
  });
  it('rounds to the nearest minute', () => {
    expect(nextStopLine(a('X', at(149)), NOW)).toBe('X in 2 min');
    expect(nextStopLine(a('X', at(151)), NOW)).toBe('X in 3 min');
  });
  it('says 1 min from 30 s out', () => {
    expect(nextStopLine(a('X', at(30)), NOW)).toBe('X in 1 min');
  });
  it('under one minute reads "Arriving <station>" (Lee, 2026-10-02)', () => {
    expect(nextStopLine(a('Irving Park', at(29)), NOW)).toBe('Arriving Irving Park');
    expect(nextStopLine(a('Irving Park', at(0)), NOW)).toBe('Arriving Irving Park');
  });
  it('past the ETA (the integration keeps a stop 30 s after it) is still arriving', () => {
    expect(nextStopLine(a('Irving Park', at(-30)), NOW)).toBe('Arriving Irving Park');
    expect(nextStopLine(a('Irving Park', at(-600)), NOW)).toBe('Arriving Irving Park');
  });
  it('an hour or more reads in hours', () => {
    expect(nextStopLine(a('Orlando', at(59 * 60)), NOW)).toBe('Orlando in 59 min');
    expect(nextStopLine(a('Orlando', at(60 * 60)), NOW)).toBe('Orlando in 1 h');
    expect(nextStopLine(a('Orlando', at(186 * 60)), NOW)).toBe('Orlando in 3 h 6 min');
  });
  it('takes the two forms the emitters publish', () => {
    expect(nextStopLine(a('X', '2026-10-03T01:10:31+00:00'), NOW)).toBe('X in 11 min');
    expect(nextStopLine(a('X', '2026-10-03T01:10:00Z'), NOW)).toBe('X in 10 min');
  });
  it('is null unless BOTH are present and the time parses', () => {
    expect(nextStopLine({}, NOW)).toBeNull();
    expect(nextStopLine(undefined, NOW)).toBeNull();
    expect(nextStopLine({ next_stop: 'X' }, NOW)).toBeNull();
    expect(nextStopLine({ arrival_estimated_at: at(60) }, NOW)).toBeNull();
    expect(nextStopLine(a('X', 'soon'), NOW)).toBeNull();
    expect(nextStopLine(a('X', 1759453200), NOW)).toBeNull();
    // Date.parse reads a bare number as a YEAR: 2026 would parse as a time.
    expect(nextStopLine(a('X', 2026), NOW)).toBeNull();
    expect(nextStopLine(a('   ', at(60)), NOW)).toBeNull();
    expect(nextStopLine(a(null, at(60)), NOW)).toBeNull();
  });
  it('trims the station name', () => {
    expect(nextStopLine(a('  Wheaton ', at(120)), NOW)).toBe('Wheaton in 2 min');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<b>A & B's "C"</b>`))
      .toBe('&lt;b&gt;A &amp; B&#39;s &quot;C&quot;&lt;/b&gt;');
  });
  it('turns nothing into an empty string', () => {
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
  });
});
