import { describe, it, expect } from '@jest/globals';
import { escapeHtml, routeText, detailLine, titleLine, hoverHtml } from './HoverLabel.js';

const NOW = Date.parse('2026-10-03T01:00:00+00:00');
const at = (sec) => new Date(NOW + sec * 1000).toISOString();
const train = (next_stop, arrival_estimated_at, extra = {}) =>
  ({ next_stop, arrival_estimated_at, ...extra });
const plane = (extra = {}) =>
  ({ callsign: 'AAL435', origin_icao: 'KPHX', destination_icao: 'KORD', ...extra });

describe('train: second line', () => {
  it('reads "<station> in <n> min", Lee\'s wording', () => {
    expect(detailLine(train('Irving Park', at(240)), NOW)).toBe('Irving Park in 4 min');
  });
  it('rounds to the nearest minute', () => {
    expect(detailLine(train('X', at(149)), NOW)).toBe('X in 2 min');
    expect(detailLine(train('X', at(151)), NOW)).toBe('X in 3 min');
  });
  it('says 1 min from 30 s out', () => {
    expect(detailLine(train('X', at(30)), NOW)).toBe('X in 1 min');
  });
  it('under one minute, and past the ETA, reads "Arriving <station>"', () => {
    expect(detailLine(train('Irving Park', at(29)), NOW)).toBe('Arriving Irving Park');
    expect(detailLine(train('Irving Park', at(0)), NOW)).toBe('Arriving Irving Park');
    expect(detailLine(train('Irving Park', at(-600)), NOW)).toBe('Arriving Irving Park');
  });
  it('an hour or more reads in hours', () => {
    expect(detailLine(train('Orlando', at(59 * 60)), NOW)).toBe('Orlando in 59 min');
    expect(detailLine(train('Orlando', at(60 * 60)), NOW)).toBe('Orlando in 1 h');
    expect(detailLine(train('Orlando', at(186 * 60)), NOW)).toBe('Orlando in 3 h 6 min');
  });
  it('takes the two forms the emitters publish', () => {
    expect(detailLine(train('X', '2026-10-03T01:10:31+00:00'), NOW)).toBe('X in 11 min');
    expect(detailLine(train('X', '2026-10-03T01:10:00Z'), NOW)).toBe('X in 10 min');
  });
  it('a station with no time reads "Next: <station>" (Lee, 2026-10-03)', () => {
    expect(detailLine({ next_stop: 'Irving Park' }, NOW)).toBe('Next: Irving Park');
    expect(detailLine(train('Irving Park', 'soon'), NOW)).toBe('Next: Irving Park');
    // Date.parse reads a bare number as a YEAR: refused as a time.
    expect(detailLine(train('Irving Park', 2026), NOW)).toBe('Next: Irving Park');
    expect(detailLine(train('Irving Park', 1759453200), NOW)).toBe('Next: Irving Park');
  });
  it('a time with no station says nothing', () => {
    expect(detailLine({ arrival_estimated_at: at(60) }, NOW)).toBeNull();
    expect(detailLine(train('   ', at(60)), NOW)).toBeNull();
    expect(detailLine(train(null, at(60)), NOW)).toBeNull();
    expect(detailLine(train(42, at(60)), NOW)).toBeNull();
  });
  it('nothing at all says nothing', () => {
    expect(detailLine({}, NOW)).toBeNull();
    expect(detailLine(undefined, NOW)).toBeNull();
  });
  it('trims the station name', () => {
    expect(detailLine(train('  Wheaton ', at(120)), NOW)).toBe('Wheaton in 2 min');
  });
});

describe('aircraft: second line', () => {
  it('reads "<ORIG>-<DEST> in <n> min"', () => {
    expect(detailLine(plane({ arrival_estimated_at: at(12 * 60) }), NOW)).toBe('KPHX-KORD in 12 min');
    expect(detailLine(plane({ arrival_estimated_at: at(186 * 60) }), NOW)).toBe('KPHX-KORD in 3 h 6 min');
  });
  it('under one minute reads "<ORIG>-<DEST> arriving"', () => {
    expect(detailLine(plane({ arrival_estimated_at: at(10) }), NOW)).toBe('KPHX-KORD arriving');
  });
  it('the route alone with no ETA', () => {
    expect(detailLine(plane(), NOW)).toBe('KPHX-KORD');
  });
  it('an implausible route carries a "?" (Lee, 2026-10-03)', () => {
    expect(detailLine(plane({ route_check: 'implausible', arrival_estimated_at: at(600) }), NOW))
      .toBe('KPHX-KORD? in 10 min');
    expect(detailLine(plane({ route_check: 'plausible' }), NOW)).toBe('KPHX-KORD');
    expect(detailLine(plane({ route_check: 'unchecked' }), NOW)).toBe('KPHX-KORD');
  });
  it('IATA when published, ICAO otherwise, per end', () => {
    expect(routeText(plane({ origin_iata: 'PHX', destination_iata: 'ORD' }))).toBe('PHX-ORD');
    expect(routeText(plane({ origin_iata: 'PHX' }))).toBe('PHX-KORD');
    expect(routeText(plane({ origin_iata: '  ' }))).toBe('KPHX-KORD');
  });
  it('no route without both ends; then a next_stop, if any, is used', () => {
    expect(routeText({ origin_icao: 'KPHX' })).toBeNull();
    expect(routeText({ destination_icao: 'KORD' })).toBeNull();
    expect(routeText(undefined)).toBeNull();
    expect(detailLine({ origin_icao: 'KPHX', arrival_estimated_at: at(60) }, NOW)).toBeNull();
    expect(detailLine({ origin_icao: 'KPHX', next_stop: 'Gate B', arrival_estimated_at: at(120) }, NOW))
      .toBe('Gate B in 2 min');
  });
  it('a route outranks a next stop', () => {
    expect(detailLine(plane({ next_stop: 'Somewhere', arrival_estimated_at: at(120) }), NOW))
      .toBe('KPHX-KORD in 2 min');
  });
});

describe('first line', () => {
  it('callsign first', () => {
    expect(titleLine({ callsign: ' AAL435 ', line_name: 'X' }, 'Aircraft A68336')).toBe('AAL435');
  });
  it('line name for a train, not its number (Lee, 2026-10-03)', () => {
    expect(titleLine({ line_name: 'Union Pacific Northwest' }, 'Metra unit 8461'))
      .toBe('Union Pacific Northwest');
  });
  it('the fallback otherwise, blank ones skipped', () => {
    expect(titleLine({ callsign: '', line_name: '  ' }, 'Metra unit 8461')).toBe('Metra unit 8461');
    expect(titleLine({ call_sign: 'LAXJ' }, 'ODYSSEY')).toBe('ODYSSEY');
    expect(titleLine(undefined, 'Mom is at Work')).toBe('Mom is at Work');
    expect(titleLine({}, undefined)).toBe('');
  });
});

describe('hoverHtml', () => {
  it('two lines, escaped', () => {
    expect(hoverHtml({ line_name: 'A & B', next_stop: '<img src=x onerror=alert(1)>',
      arrival_estimated_at: at(240) }, 'x', NOW))
      .toBe('A &amp; B<br>&lt;img src=x onerror=alert(1)&gt; in 4 min');
  });
  it('one line when there is no second', () => {
    expect(hoverHtml({}, 'Metra unit 8461', NOW)).toBe('Metra unit 8461');
  });
  it('the fallback is escaped too', () => {
    expect(hoverHtml({}, '<b>', NOW)).toBe('&lt;b&gt;');
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
