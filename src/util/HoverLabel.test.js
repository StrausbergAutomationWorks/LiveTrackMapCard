import { describe, it, expect } from '@jest/globals';
import { escapeHtml, routeText, detailLine, titleLine, hoverHtml,
  airportLines, sourceText, ROUTE_SOURCE_TEXT, NEW_ROUTE_TEXT, isNewRoute } from './HoverLabel.js';

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
  it('an implausible route reads "New route < 24hrs old", no ETA (backlog 281)', () => {
    expect(detailLine(plane({ route_check: 'implausible', arrival_estimated_at: at(600) }), NOW))
      .toBe('New route < 24hrs old');
    expect(detailLine(plane({ route_check: 'implausible' }), NOW)).toBe('New route < 24hrs old');
    expect(routeText(plane({ route_check: 'implausible' }))).toBeNull();
    expect(detailLine(plane({ route_check: 'plausible' }), NOW)).toBe('KPHX-KORD');
    expect(detailLine(plane({ route_check: 'unchecked' }), NOW)).toBe('KPHX-KORD');
  });
  it('keys on route_check alone: holds when the rejected codes are not published', () => {
    expect(detailLine({ callsign: 'SWA1639', route_check: 'implausible' }, NOW)).toBe('New route < 24hrs old');
    expect(isNewRoute({ route_check: 'implausible' })).toBe(true);
    expect(isNewRoute({ route_check: 'Implausible' })).toBe(false);
    expect(isNewRoute(undefined)).toBe(false);
    expect(NEW_ROUTE_TEXT).toBe('New route < 24hrs old');
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

describe('aircraft: airport names (backlog 293)', () => {
  const named = (extra = {}) => plane({
    origin_name: 'Phoenix Sky Harbor International Airport',
    destination_name: "Chicago O'Hare International Airport", ...extra });
  it('both names: origin, then "to <destination>"', () => {
    expect(airportLines(named())).toEqual([
      'Phoenix Sky Harbor International Airport', "to Chicago O'Hare International Airport"]);
  });
  it('one name alone reads "From" or "To"', () => {
    expect(airportLines(named({ destination_name: undefined })))
      .toEqual(['From Phoenix Sky Harbor International Airport']);
    expect(airportLines(named({ origin_name: '  ' })))
      .toEqual(["To Chicago O'Hare International Airport"]);
  });
  it('no names, nothing', () => {
    expect(airportLines(plane())).toEqual([]);
    expect(airportLines(named({ origin_name: 7, destination_name: null }))).toEqual([]);
  });
  it('trims the names', () => {
    expect(airportLines(plane({ origin_name: '  A ', destination_name: ' B  ' }))).toEqual(['A', 'to B']);
  });
  it('no route, no names: an aircraft with one end, or a train', () => {
    expect(airportLines({ origin_icao: 'KPHX', origin_name: 'X', destination_name: 'Y' })).toEqual([]);
    expect(airportLines({ next_stop: 'Wheaton', origin_name: 'X', destination_name: 'Y' })).toEqual([]);
    expect(airportLines(undefined)).toEqual([]);
  });
  it('none for an implausible route: they name the leg that does not fit (backlog 281)', () => {
    expect(airportLines(named({ route_check: 'implausible' }))).toEqual([]);
  });
});

describe('aircraft: route source (backlog 293)', () => {
  it('names the two published sources by their own names (Lee, 2026-10-22 22:38)', () => {
    expect(sourceText(plane({ route_source: 'saw_filed_routes' }))).toBe('FiledRoutesDB');
    expect(sourceText(plane({ route_source: 'adsbdb' }))).toBe('adsbdb');
    expect(sourceText(plane({ route_source: ' adsbdb ' }))).toBe('adsbdb');
  });
  it('none for an implausible route', () => {
    expect(sourceText(plane({ route_source: 'saw_filed_routes', route_check: 'implausible' }))).toBeNull();
  });
  it('an unknown or missing source says nothing', () => {
    expect(sourceText(plane({ route_source: 'opensky' }))).toBeNull();
    expect(sourceText(plane({ route_source: 'toString' }))).toBeNull();
    expect(sourceText(plane({ route_source: 3 }))).toBeNull();
    expect(sourceText(plane())).toBeNull();
  });
  it('no route, no source', () => {
    expect(sourceText({ origin_icao: 'KPHX', route_source: 'adsbdb' })).toBeNull();
    expect(sourceText(undefined)).toBeNull();
  });
  it('the table is frozen', () => {
    expect(Object.isFrozen(ROUTE_SOURCE_TEXT)).toBe(true);
  });
});

describe('hoverHtml: an aircraft with names and a source', () => {
  it('route line, then the names block, then the source block', () => {
    expect(hoverHtml(plane({ origin_name: 'South Bend International Airport',
      destination_name: 'Purdue University Airport', route_source: 'saw_filed_routes',
      arrival_estimated_at: at(22 * 60) }), 'x', NOW))
      .toBe('AAL435<br>KPHX-KORD in 22 min'
        + '<div class="hover-airports">South Bend International Airport<br>to Purdue University Airport</div>'
        + '<div class="hover-source">FiledRoutesDB</div>');
  });
  it('the names are escaped', () => {
    expect(hoverHtml(plane({ origin_name: '<b>A & B</b>', destination_name: "O'Hare" }), 'x', NOW))
      .toBe('AAL435<br>KPHX-KORD<div class="hover-airports">&lt;b&gt;A &amp; B&lt;/b&gt;<br>to O&#39;Hare</div>');
  });
  it('a source alone, no names block', () => {
    expect(hoverHtml(plane({ route_source: 'adsbdb' }), 'x', NOW))
      .toBe('AAL435<br>KPHX-KORD<div class="hover-source">adsbdb</div>');
  });
  it('an implausible route: one line, escaped, nothing under it (backlog 281)', () => {
    expect(hoverHtml(plane({ route_check: 'implausible', origin_name: 'A', destination_name: 'B',
      route_source: 'saw_filed_routes', arrival_estimated_at: at(600) }), 'x', NOW))
      .toBe('AAL435<br>New route &lt; 24hrs old');
  });
  it('a train is unchanged', () => {
    expect(hoverHtml({ line_name: 'UP-W', next_stop: 'Wheaton', arrival_estimated_at: at(120),
      route_source: 'adsbdb', origin_name: 'X' }, 'x', NOW)).toBe('UP-W<br>Wheaton in 2 min');
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
