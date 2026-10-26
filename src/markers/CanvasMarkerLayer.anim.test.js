import { isAnimatedImage, picturePath, isPlain } from './CanvasMarkerLayer.js';

// PROTOTYPE tests (map capacity, 2026-10-25): which pictures may be drawn on the canvas.
// Defect found by Lee 21:33: animated pictures (helicopter rotors) froze on the canvas.

const enc = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

describe('isAnimatedImage - SVG', () => {
  test.each([
    ['<animate>', '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"><animate attributeName="r" values="1;2" dur="1s"/></circle></svg>'],
    ['<animateTransform>', '<svg><g><animateTransform attributeName="transform" type="rotate" dur="0.2s"/></g></svg>'],
    ['<animateMotion>', '<svg><path><animateMotion dur="1s"/></path></svg>'],
    ['<animateColor>', '<svg><rect><animateColor dur="1s"/></rect></svg>'],
    ['<set>', '<svg><rect><set attributeName="fill" to="red"/></rect></svg>'],
    ['@keyframes', '<svg><style>@keyframes spin { to { transform: rotate(1turn) } }</style></svg>'],
    ['animation:', '<svg><style>.r { animation: spin 0.2s linear infinite }</style></svg>'],
    ['animation-name:', '<svg><style>.r { animation-name: spin }</style></svg>'],
  ])('%s is animated', (_, svg) => {
    expect(isAnimatedImage(enc(svg), 'image/svg+xml')).toBe(true);
  });

  test('found without a content type, from the <svg> tag', () => {
    expect(isAnimatedImage(enc('<?xml version="1.0"?><svg><animate dur="1s"/></svg>'), '')).toBe(true);
  });

  test.each([
    ['a still picture', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'],
    ['an <animation> word in an id is not an element', '<svg><g id="animated-not"><path d="M0 0"/></g></svg>'],
    ['<settings> is not <set>', '<svg><settings/></svg>'],
    ['<animated> is not <animate>', '<svg><animated/></svg>'],
  ])('%s is still', (_, svg) => {
    expect(isAnimatedImage(enc(svg), 'image/svg+xml')).toBe(false);
  });
});

describe('isAnimatedImage - raster formats', () => {
  const gif = (frames, loop = false) => {
    let s = 'GIF89a' + '\x01\x00\x01\x00\x00\x00\x00';
    if (loop) s += '\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00';
    for (let i = 0; i < frames; i++) s += '\x21\xf9\x04\x00\x0a\x00\x00\x00' + '\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02\x44\x01\x00';
    return enc(s + '\x3b');
  };
  test('a GIF with two frames is animated', () => expect(isAnimatedImage(gif(2))).toBe(true));
  test('a GIF with a loop block is animated', () => expect(isAnimatedImage(gif(1, true))).toBe(true));
  test('a one-frame GIF is still', () => expect(isAnimatedImage(gif(1))).toBe(false));

  const png = (chunks) => enc('\x89PNG\r\n\x1a\n' + chunks.map((c) => '\x00\x00\x00\x08' + c + '12345678CRC!').join(''));
  test('an APNG (acTL before IDAT) is animated', () => expect(isAnimatedImage(png(['IHDR', 'acTL', 'IDAT']))).toBe(true));
  test('a PNG is still', () => expect(isAnimatedImage(png(['IHDR', 'IDAT', 'IEND']))).toBe(false));
  test('acTL after IDAT is not an APNG', () => expect(isAnimatedImage(png(['IHDR', 'IDAT', 'acTL']))).toBe(false));

  test('an animated WebP is animated', () => expect(isAnimatedImage(enc('RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x02ANIM'))).toBe(true));
  test('a still WebP is still', () => expect(isAnimatedImage(enc('RIFF\x00\x00\x00\x00WEBPVP8 \x0a\x00\x00\x00'))).toBe(false));

  test('nothing, or junk, is still', () => {
    expect(isAnimatedImage(new Uint8Array(0))).toBe(false);
    expect(isAnimatedImage(enc('not an image at all'), 'text/plain')).toBe(false);
  });
});

describe('picturePath', () => {
  test('the query is left out, so one check covers every token', () => {
    expect(picturePath('/api/live_track_aircraft/icon/cessna/fixed.svg?token=abc&v=2')).toBe('/api/live_track_aircraft/icon/cessna/fixed.svg');
    expect(picturePath('/a/b.svg')).toBe('/a/b.svg');
    expect(picturePath(undefined)).toBe('');
  });
});

describe('isPlain still decides by look first', () => {
  test('a picture with an icon is plain (the picture wins)', () => {
    expect(isPlain({ picture: '/p.svg', icon: 'mdi:airplane', color: 'transparent' })).toBe(true);
  });
  test('an icon alone is not plain', () => {
    expect(isPlain({ icon: 'mdi:airplane' })).toBe(false);
  });
});
