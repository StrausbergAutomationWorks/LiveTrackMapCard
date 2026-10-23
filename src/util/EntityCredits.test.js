import { describe, it, expect } from '@jest/globals';
import { creditParts, linkify, creditLine, CREDIT_SEPARATOR } from './EntityCredits.js';

// Strings as the box's entities carried them, 2026-10-22 (bin\ltmc228_live.txt).
const RENFE = 'Data: Renfe (data.renfe.com), CC BY 4.0, modified. This integration is not sponsored by, affiliated with, or operated by Renfe.';
const AIR = 'Data from adsb.lol (https://adsb.lol, ODbL 1.0) and adsb.fi (https://adsb.fi)';
const AMTRAK = 'Data from Amtraker (amtraker.com), ODC-By v1.0';
const METRA = 'Data: Metra GTFS-Realtime. This integration is not sponsored by, affiliated with, or operated by Metra.';
const VIA = 'Data from VIA Rail Canada (viarail.ca). Contains information licensed under the Open Government Licence – Canada.';
const SHIPS = 'Data: aisstream.io (https://aisstream.io)';
const a = (href, text = href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

describe('creditParts: up to the first full stop (Lee, 2026-10-22)', () => {
  it('cuts at the first full stop and keeps the rest', () => {
    expect(creditParts(RENFE)).toEqual({ short: 'Data: Renfe (data.renfe.com), CC BY 4.0, modified',
      rest: 'This integration is not sponsored by, affiliated with, or operated by Renfe.', full: RENFE });
    expect(creditParts(VIA).short).toBe('Data from VIA Rail Canada (viarail.ca)');
    expect(creditParts(METRA).short).toBe('Data: Metra GTFS-Realtime');
  });
  it('a dot in a version or a domain is not a full stop', () => {
    expect(creditParts(AIR)).toEqual({ short: AIR, rest: '', full: AIR });
    expect(creditParts(AMTRAK).short).toBe(AMTRAK);
    expect(creditParts(SHIPS).short).toBe(SHIPS);
  });
  it('a single closing stop is dropped, with nothing after it', () => {
    expect(creditParts('Data: X.')).toEqual({ short: 'Data: X', rest: '', full: 'Data: X.' });
  });
  it('a string starting with a stop is kept whole', () => {
    expect(creditParts('. odd').short).toBe('. odd');
  });
  it('white space is folded, and nothing but a non-blank string gives null', () => {
    expect(creditParts('  Data:\n  X  ').full).toBe('Data: X');
    expect(creditParts('   ')).toBeNull();
    expect(creditParts(undefined)).toBeNull();
    expect(creditParts(7)).toBeNull();
    expect(creditParts(['Data'])).toBeNull();
  });
});

describe('linkify: any URL or domain becomes a link', () => {
  it('a bare domain links to https', () => {
    expect(linkify('Data from Amtraker (amtraker.com), ODC-By v1.0'))
      .toBe(`Data from Amtraker (${a('https://amtraker.com', 'amtraker.com')}), ODC-By v1.0`);
    expect(linkify('Data: Renfe (data.renfe.com)')).toBe(`Data: Renfe (${a('https://data.renfe.com', 'data.renfe.com')})`);
  });
  it('a URL is linked as it is, and stops before a comma or a bracket', () => {
    expect(linkify(AIR)).toBe(`Data from ${a('https://adsb.lol', 'adsb.lol')} (${a('https://adsb.lol')}, ODbL 1.0) and `
      + `${a('https://adsb.fi', 'adsb.fi')} (${a('https://adsb.fi')})`);
  });
  it('a sentence\'s closing stop is not part of the link', () => {
    expect(linkify('See https://x.org.')).toBe(`See ${a('https://x.org')}.`);
  });
  it('versions, licences and one-letter "domains" are left alone', () => {
    expect(linkify('CC BY 4.0, ODbL 1.0, e.g. U.S.')).toBe('CC BY 4.0, ODbL 1.0, e.g. U.S.');
  });
  it('escapes everything else, and the link text', () => {
    expect(linkify('<b>A & B</b> x.org')).toBe(`&lt;b&gt;A &amp; B&lt;/b&gt; ${a('https://x.org', 'x.org')}`);
    expect(linkify('"q" x.org')).toBe(`&quot;q&quot; ${a('https://x.org', 'x.org')}`);
  });
  it('a URL with a query string is escaped in the link and its text', () => {
    expect(linkify('https://x.org/?a=1&b=2')).toBe(a('https://x.org/?a=1&amp;b=2'));
  });
  it('nothing in, nothing out', () => {
    expect(linkify('')).toBe('');
    expect(linkify(undefined)).toBe('');
  });
});

describe('creditLine: one line, the short credits linked, the whole strings on hover', () => {
  const span = (title, inner) => `<span class="ltmc-credit" title="${title}">${inner}</span>`;
  it('Renfe alone', () => {
    expect(creditLine([RENFE])).toBe(span('Data: Renfe (data.renfe.com), CC BY 4.0, modified. '
      + 'This integration is not sponsored by, affiliated with, or operated by Renfe.',
      `Data: Renfe (${a('https://data.renfe.com', 'data.renfe.com')}), CC BY 4.0, modified`));
  });
  it('several, sorted, separated by "|" (Leaflet\'s own commas are unreadable here)', () => {
    expect(creditLine([SHIPS, AMTRAK])).toBe(
      span(AMTRAK, `Data from Amtraker (${a('https://amtraker.com', 'amtraker.com')}), ODC-By v1.0`)
      + CREDIT_SEPARATOR
      + span(SHIPS, `Data: ${a('https://aisstream.io', 'aisstream.io')} (${a('https://aisstream.io')})`));
    expect(CREDIT_SEPARATOR).toBe(' <span aria-hidden="true">|</span> ');
  });
  it('the order of the input does not change the line', () => {
    expect(creditLine([SHIPS, AMTRAK, METRA])).toBe(creditLine([METRA, AMTRAK, SHIPS]));
  });
  it('strings that cut to the same credit show once, every full string on hover', () => {
    const f1 = 'Data: Fintraffic / digitraffic.fi, CC BY 4.0';
    const f2 = 'Data: Fintraffic / digitraffic.fi, CC BY 4.0. Fare zones: HSL, hsl.fi, CC BY 4.0.';
    expect(creditLine([f2, f1, f1])).toBe(span(`${f1} | ${f2}`,
      `Data: Fintraffic / ${a('https://digitraffic.fi', 'digitraffic.fi')}, CC BY 4.0`));
  });
  it('the hover text is escaped', () => {
    expect(creditLine(['Data: "X" <y>. Rest & more'])).toBe(
      span('Data: &quot;X&quot; &lt;y&gt;. Rest &amp; more', 'Data: &quot;X&quot; &lt;y&gt;'));
  });
  it('the same string with other white space is one credit', () => {
    expect(creditLine([AMTRAK, ` ${AMTRAK} `])).toBe(creditLine([AMTRAK]));
  });
  it('no credit, an empty line', () => {
    expect(creditLine([])).toBe('');
    expect(creditLine(['', null, 4])).toBe('');
    expect(creditLine(undefined)).toBe('');
  });
});
