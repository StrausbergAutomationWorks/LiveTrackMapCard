import { describe, it, expect } from '@jest/globals';
import {
  photoOf, linksOf, creditText, hoverPhotoHtml, hasExtras, extrasHtml, LINKS_MAX,
} from './MarkerExtras.js';
import { hoverHtml } from './HoverLabel.js';

// 06_MAP_CONTRACT.md D4g, backlog 346 (Lee 2026-11-16): the photo in the hover box; on a click, a popup with the
// photo, its credit and licence, the links, and "Details".

const PHOTO = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Viking_Grace.jpg/320px-Viking_Grace.jpg',
  page: 'https://commons.wikimedia.org/wiki/File:Viking_Grace.jpg',
  credit: 'Solomon203',
  licence: 'CC BY-SA 4.0',
  licence_url: 'https://creativecommons.org/licenses/by-sa/4.0',
  source: 'Wikimedia Commons',
  width: 320, height: 213,
};
const LINKS = [{ label: 'VesselFinder', url: 'https://www.vesselfinder.com/vessels/details/9606900' }];

describe('photoOf', () => {
  it('keeps a whole photo', () => {
    expect(photoOf(PHOTO)).toEqual(PHOTO);
  });
  it('needs an https url, an https page and a credit', () => {
    for (const bad of [
      null, 'x', [], {},
      { ...PHOTO, url: 'http://x/a.jpg' },
      { ...PHOTO, url: 'javascript:alert(1)' },
      { ...PHOTO, page: undefined },
      { ...PHOTO, credit: '  ' },
      { ...PHOTO, url: 'https://x/a b.jpg' },
      { ...PHOTO, url: 'https://x/"onerror="a' },
    ]) expect(photoOf(bad)).toBeNull();
  });
  it('drops optional fields that are wrong, not the photo', () => {
    const p = photoOf({ ...PHOTO, licence_url: 'ftp://x', width: -3, height: 'tall', source: 7 });
    expect(p).toMatchObject({ licence_url: null, width: null, height: null, source: null, credit: 'Solomon203' });
  });
  it('caps the credit', () => {
    expect(photoOf({ ...PHOTO, credit: 'a'.repeat(500) }).credit).toHaveLength(120);
  });
});

describe('linksOf', () => {
  it('keeps https links with a label, at most LINKS_MAX', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, url: `https://x.example/${i}` }));
    expect(linksOf(many)).toHaveLength(LINKS_MAX);
    expect(linksOf([{ label: 'a', url: 'http://x' }, { label: '', url: 'https://x' }, ...LINKS])).toEqual(LINKS);
    expect(linksOf('x')).toEqual([]);
  });
});

describe('the hover box', () => {
  it('credits the photo', () => {
    expect(creditText(photoOf(PHOTO))).toBe('Photo: Solomon203, CC BY-SA 4.0, Wikimedia Commons');
    expect(creditText(photoOf({ ...PHOTO, licence: null, source: null }))).toBe('Photo: Solomon203');
  });
  it('draws the thumbnail at 160 px, its proportions kept, with no referrer', () => {
    const h = hoverPhotoHtml({ marker_photo: PHOTO });
    expect(h).toContain(`src="${PHOTO.url}"`);
    expect(h).toContain('width="160" height="107"');
    expect(h).toContain('referrerpolicy="no-referrer"');
    expect(h).toContain('<div class="hover-credit">Photo: Solomon203, CC BY-SA 4.0, Wikimedia Commons</div>');
    expect(hoverPhotoHtml({})).toBe('');
  });
  it('escapes the credit', () => {
    expect(hoverPhotoHtml({ marker_photo: { ...PHOTO, credit: '<b>x</b>' } })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
  it('comes after the lines; a storm gets none', () => {
    const a = { name: 'VIKING GRACE', marker_photo: PHOTO };
    const h = hoverHtml(a, 'x', 0);
    expect(h.startsWith('VIKING GRACE<div class="hover-photo">')).toBe(true);
    expect(hoverHtml({ storm_class: 'Typhoon', marker_photo: PHOTO }, 'T', 0)).not.toContain('hover-photo');
    expect(hoverHtml({ name: 'A' }, 'x', 0)).toBe('A');
  });
});

describe('the popup', () => {
  it('has extras with a photo or a link', () => {
    expect(hasExtras({ marker_photo: PHOTO })).toBe(true);
    expect(hasExtras({ marker_links: LINKS })).toBe(true);
    expect(hasExtras({ marker_photo: { url: 'https://x' }, marker_links: [] })).toBe(false);
    expect(hasExtras(undefined)).toBe(false);
  });
  it('links the photo and the credit to the photo page, the licence to its deed, and adds Details', () => {
    const h = extrasHtml({ marker_photo: PHOTO, marker_links: LINKS });
    expect(h.startsWith('<div class="ltmc-extras"><a class="ltmc-photo" href="https://commons.wikimedia.org/wiki/File:Viking_Grace.jpg"')).toBe(true);
    expect(h).toContain('width="280" height="186"');
    expect(h).toContain('Photo: <a href="https://commons.wikimedia.org/wiki/File:Viking_Grace.jpg" target="_blank" rel="noopener noreferrer">Solomon203</a>');
    expect(h).toContain('<a href="https://creativecommons.org/licenses/by-sa/4.0" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>, Wikimedia Commons</div>');
    expect(h).toContain('<div class="ltmc-links"><a href="https://www.vesselfinder.com/vessels/details/9606900" target="_blank" rel="noopener noreferrer">VesselFinder</a></div>');
    expect(h).toContain('<button type="button" class="ltmc-details-button">Details</button>');
  });
  it('is headed by the name it is given, escaped; none without one', () => {
    expect(extrasHtml({ marker_links: LINKS }, 'VIKING <GRACE>')).toContain('<div class="ltmc-extras"><div class="ltmc-title">VIKING &lt;GRACE&gt;</div><div class="ltmc-links">');
    expect(extrasHtml({ marker_links: LINKS }, '  ')).not.toContain('ltmc-title');
    expect(extrasHtml({ marker_links: LINKS })).not.toContain('ltmc-title');
  });
  it('a licence with no deed is text; links alone still get Details', () => {
    expect(extrasHtml({ marker_photo: { ...PHOTO, licence_url: null } })).toContain(', CC BY-SA 4.0, Wikimedia Commons</div>');
    const h = extrasHtml({ marker_links: [...LINKS, { label: 'Two <i>', url: 'https://b.example/' }] });
    expect(h).not.toContain('ltmc-photo');
    expect(h).toContain('VesselFinder</a> · <a href="https://b.example/"');
    expect(h).toContain('Two &lt;i&gt;');
    expect(h).toContain('ltmc-details-button');
  });
});
