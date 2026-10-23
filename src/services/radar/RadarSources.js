/**
 * The weather radar overlay's sources and the per-tile choice between them
 * (10_SEED/06_MAP_CONTRACT_OVERLAYS.md D13, backlog 280). Pure: no Leaflet,
 * no network. RadarOverlayService draws what these functions decide.
 *
 * For each tile the first source whose box holds the WHOLE tile, and whose
 * frame is usable, wins; RainViewer covers the world. A whole-tile test, not
 * a view test: FMI and DWD paint translucent grey outside their radars, so a
 * tile half outside would grey the map.
 */

/** Spherical Mercator half-extent in metres (EPSG:3857). */
export const MERC_R = 20037508.342789244;

/** RainViewer serves nothing sharper than z7 (D13: z8 answers a 20%-opaque "not supported" picture). */
export const RAINVIEWER_MAX_ZOOM = 7;

/** JMA's nowcast tiles stop at z10 (D13). */
export const JMA_MAX_ZOOM = 10;

/** RainViewer's colour scheme and options in the tile URL. The scheme is IGNORED by RainViewer (D13, backlog 285); the options `1_1` are not. */
export const RAINVIEWER_STYLE = "2/1_1";

/** nowCOAST's capabilities: one document lists every regional layer's frames. */
const NOWCOAST_CAPS = "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms?service=WMS&version=1.3.0&request=GetCapabilities";

/**
 * nowCOAST's five REGIONAL layers, each with its own box and time list
 * (D13, backlog 285: the group layer has no time list, and the regional
 * layer draws the same picture for 60% of the bytes). These boxes are also
 * what D13 calls "the US" (Lee, 2026-10-12 00:50).
 */
export const NOWCOAST_REGIONS = Object.freeze([
  { region: "conus", box: { w: -130, e: -60, s: 20, n: 55 } },
  { region: "alaska", box: { w: -176, e: -126, s: 50, n: 72 } },
  { region: "hawaii", box: { w: -164, e: -151, s: 15, n: 26 } },
  { region: "caribbean", box: { w: -90, e: -60, s: 10, n: 25 } },
  { region: "guam", box: { w: 140, e: 150, s: 9, n: 18 } },
]);

/** "The US" for the source order (D13): nowCOAST's five regional boxes. */
export const US_BOXES = Object.freeze(NOWCOAST_REGIONS.map((r) => r.box));

/**
 * Source table, in the order a tile tries them (D13). `boxes` are
 * {w, e, s, n} in degrees; a tile must sit wholly inside one of them.
 * `maxNativeZoom` null means any zoom (WMS). Relays are not here: they are
 * found in Home Assistant and tried before every source in this table.
 */
export const SOURCES = Object.freeze([
  {
    id: "fmi", kind: "wms", frame: "computed5",
    url: "https://openwms.fmi.fi/geoserver/wms", layer: "Radar:suomi_dbz_eureffin",
    // Set by us from pictures (D13): may only shrink without asking.
    boxes: [{ w: 20.5, e: 31.0, s: 59.8, n: 69.5 }], maxNativeZoom: null,
    credit: 'Radar: <a href="https://en.ilmatieteenlaitos.fi/open-data">Finnish Meteorological Institute</a>, CC BY 4.0',
  },
  {
    id: "dwd", kind: "wms", frame: "computed5",
    url: "https://maps.dwd.de/geoserver/dwd/wms", layer: "dwd:Niederschlagsradar",
    boxes: [{ w: 6.5, e: 14.0, s: 47.8, n: 54.6 }], maxNativeZoom: null,
    credit: 'Radar: <a href="https://www.dwd.de/">Deutscher Wetterdienst (DWD)</a>, CC BY 4.0',
  },
  {
    id: "jma", kind: "jma", frame: "jma",
    url: "https://www.jma.go.jp/bosai/jmatile/data/nowc/",
    list: "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json",
    boxes: [{ w: 122, e: 150, s: 23, n: 47 }], maxNativeZoom: JMA_MAX_ZOOM,
    credit: 'Radar: <a href="https://www.jma.go.jp/">Japan Meteorological Agency</a>',
  },
  {
    id: "geomet", kind: "wms", frame: "geomet",
    url: "https://geo.weather.gc.ca/geomet", layer: "RADAR_1KM_RRAI",
    list: "https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetCapabilities&layer=RADAR_1KM_RRAI",
    boxes: [{ w: -170.32, e: -50.0, s: 16.93, n: 67.19 }], maxNativeZoom: null,
    credit: 'Radar: <a href="https://eccc-msc.github.io/open-data/">Environment and Climate Change Canada</a>. Contains information licensed under the <a href="https://open.canada.ca/en/open-government-licence-canada">Open Government Licence – Canada</a>.',
  },
  // nowCOAST: one source per regional layer, all read from one capabilities
  // document (`group`), each requested as ITSELF at its own listed time.
  ...NOWCOAST_REGIONS.map(({ region, box }) => ({
    id: `nowcoast_${region}`, group: "nowcoast", kind: "wms", frame: "nowcoast",
    url: "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms", layer: `${region}_base_reflectivity_mosaic`,
    list: NOWCOAST_CAPS,
    boxes: [box], maxNativeZoom: null,
    credit: 'Radar: <a href="https://nowcoast.noaa.gov/">NOAA nowCOAST</a>',
  })),
  {
    id: "rainviewer", kind: "rainviewer", frame: "rainviewer",
    list: "https://api.rainviewer.com/public/weather-maps.json",
    boxes: [{ w: -180, e: 180, s: -90, n: 90 }], maxNativeZoom: RAINVIEWER_MAX_ZOOM,
    // Mandatory under RainViewer's free terms (D13), linked.
    credit: 'Weather data by <a href="https://www.rainviewer.com/">RainViewer</a>',
  },
]);

/** @returns {string[]} the default order of the built-in sources */
export function defaultOrder() {
  return SOURCES.map((s) => s.id);
}

/**
 * Wrap a tile x into [0, 2^z).
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
export function wrapX(x, z) {
  const n = 2 ** z;
  return ((x % n) + n) % n;
}

/**
 * @param {number} y tile row at zoom z (may be fractional)
 * @param {number} z
 * @returns {number} latitude of that row's top edge, degrees
 */
export function tileLat(y, z) {
  const t = Math.PI * (1 - (2 * y) / 2 ** z);
  return (Math.atan(Math.sinh(t)) * 180) / Math.PI;
}

/**
 * A tile's box in degrees.
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {{w: number, e: number, s: number, n: number}}
 */
export function tileBounds(z, x, y) {
  const n = 2 ** z;
  const wx = wrapX(x, z);
  return { w: (wx / n) * 360 - 180, e: ((wx + 1) / n) * 360 - 180, n: tileLat(y, z), s: tileLat(y + 1, z) };
}

/**
 * Whether the tile sits wholly inside the box.
 * @param {{w: number, e: number, s: number, n: number}} t
 * @param {{w: number, e: number, s: number, n: number}} b
 * @returns {boolean}
 */
export function tileInBox(t, b) {
  return t.w >= b.w && t.e <= b.e && t.s >= b.s && t.n <= b.n;
}

/**
 * @param {{w: number, e: number, s: number, n: number}} t
 * @param {{boxes: object[]}} src
 * @returns {boolean} whether any of the source's boxes holds the whole tile
 */
export function sourceHoldsTile(t, src) {
  return Array.isArray(src?.boxes) && src.boxes.some((b) => tileInBox(t, b));
}

/**
 * @param {{w: number, e: number, s: number, n: number}} t a tile's box
 * @returns {boolean} whether the whole tile lies inside one of "the US" boxes (D13)
 */
export function inUs(t) {
  return US_BOXES.some((b) => tileInBox(t, b));
}

/**
 * A source's place in the US order (D13, Lee 2026-10-12 00:22): relays
 * first, then RainViewer, GeoMet, nowCOAST, then anything else.
 * @param {object} s
 * @returns {number}
 */
function usRank(s) {
  if (s.kind === "relay") return 0;
  if (s.id === "rainviewer") return 1;
  if (s.id === "geomet") return 2;
  if (s.group === "nowcoast") return 3;
  return 4;
}

/**
 * The sources whose boxes hold this tile, in trying order. With `opts.us`
 * (the default order, no `sources` option) a tile wholly inside "the US"
 * tries RainViewer, then GeoMet, then nowCOAST (D13); elsewhere, and with
 * an explicit order, the order given.
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {object[]} sources in trying order
 * @param {{us?: boolean}} [opts]
 * @returns {object[]}
 */
export function chainFor(z, x, y, sources, opts = {}) {
  const t = tileBounds(z, x, y);
  const held = sources.filter((s) => sourceHoldsTile(t, s));
  if (!opts.us || !inUs(t)) return held;
  return held.map((s, i) => [s, i]).sort((a, b) => usRank(a[0]) - usRank(b[0]) || a[1] - b[1]).map((p) => p[0]);
}

/**
 * The source that draws this tile: the first whose box holds it and whose
 * frame is usable; null when none (the tile stays blank).
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {object[]} sources in trying order
 * @param {function(object): boolean} usable
 * @param {{us?: boolean}} [opts]
 * @returns {?object}
 */
export function pickSource(z, x, y, sources, usable, opts = {}) {
  for (const s of chainFor(z, x, y, sources, opts)) if (usable(s)) return s;
  return null;
}

/**
 * In the US, the backups a RainViewer tile falls to when it fails: GeoMet,
 * then nowCOAST (D13 "Backups take over").
 * @param {object} s
 * @returns {boolean}
 */
function isUsBackup(s) {
  return s.id === "geomet" || s.group === "nowcoast";
}

/**
 * The tile to request for a source with a native-zoom cap, and where the
 * requested tile sits inside it. Above the cap the parent at the cap is
 * fetched and scaled up; `scale` is how many display tiles span it.
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {?number} maxNativeZoom null: any zoom
 * @returns {{z: number, x: number, y: number, scale: number, offX: number, offY: number}}
 */
export function nativeTile(z, x, y, maxNativeZoom) {
  const wx = wrapX(x, z);
  if (maxNativeZoom === null || maxNativeZoom === undefined || z <= maxNativeZoom) {
    return { z, x: wx, y, scale: 1, offX: 0, offY: 0 };
  }
  const scale = 2 ** (z - maxNativeZoom);
  const px = Math.floor(wx / scale);
  const py = Math.floor(y / scale);
  return { z: maxNativeZoom, x: px, y: py, scale, offX: wx - px * scale, offY: y - py * scale };
}

/**
 * The EPSG:3857 box of a tile, as WMS 1.3.0 wants it for that CRS (x,y order).
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {string} "minx,miny,maxx,maxy"
 */
export function mercatorBbox(z, x, y) {
  const s = (2 * MERC_R) / 2 ** z;
  const wx = wrapX(x, z);
  const f = (v) => v.toFixed(3);
  return [f(-MERC_R + wx * s), f(MERC_R - (y + 1) * s), f(-MERC_R + (wx + 1) * s), f(MERC_R - y * s)].join(",");
}

/**
 * A WMS GetMap URL for one 256 px tile at an explicit frame time. The time
 * is ALWAYS in the URL (D13): FMI caches a time-less answer for a day.
 * @param {{url: string, layer: string}} src
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {string} time ISO 8601 UTC
 * @returns {string}
 */
export function wmsTileUrl(src, z, x, y, time) {
  const q = [
    "service=WMS", "version=1.3.0", "request=GetMap",
    `layers=${encodeURIComponent(src.layer)}`, "styles=", "crs=EPSG:3857",
    `bbox=${mercatorBbox(z, x, y)}`, "width=256", "height=256",
    "format=image/png", "transparent=true", `time=${encodeURIComponent(time)}`,
  ];
  return `${src.url}?${q.join("&")}`;
}

/**
 * @param {{host: string, path: string}} frame RainViewer's newest past frame
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function rainviewerTileUrl(frame, z, x, y) {
  return `${frame.host}${frame.path}/256/${z}/${x}/${y}/${RAINVIEWER_STYLE}.png`;
}

/**
 * @param {{url: string}} src JMA
 * @param {{basetime: string, validtime: string}} frame
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function jmaTileUrl(src, frame, z, x, y) {
  return `${src.url}${frame.basetime}/none/${frame.validtime}/surf/hrpns/${z}/${x}/${y}.png`;
}

/**
 * A relay's tile path on the Home Assistant origin, from its template.
 * @param {string} template with {z} {x} {y}
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function relayTilePath(template, z, x, y) {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/**
 * One source's plan for one display tile, or null for a kind it cannot draw.
 * @param {object} src
 * @param {object} f its usable frame
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {?{source: object, url: string, relay: boolean, scale: number, offX: number, offY: number}}
 */
function planFor(src, f, z, x, y) {
  const nt = nativeTile(z, x, y, src.maxNativeZoom ?? null);
  let url;
  if (src.kind === "wms") url = wmsTileUrl(src, nt.z, nt.x, nt.y, f.key);
  else if (src.kind === "rainviewer") url = rainviewerTileUrl(f, nt.z, nt.x, nt.y);
  else if (src.kind === "jma") url = jmaTileUrl(src, f, nt.z, nt.x, nt.y);
  else if (src.kind === "relay") url = relayTilePath(src.tiles, nt.z, nt.x, nt.y);
  else return null;
  return { source: src, url, relay: src.kind === "relay", scale: nt.scale, offX: nt.offX, offY: nt.offY };
}

/**
 * What one display tile shows: which source, which URL, and how the
 * fetched image sits in the tile. Null: blank. In the US (`opts.us`) a
 * RainViewer plan carries `fallbacks`: the usable GeoMet and nowCOAST plans
 * for the same tile, in order, which the tile tries when RainViewer's image
 * fails (D13 "Backups take over").
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {object[]} sources in trying order (relays first)
 * @param {Map<string, object>} frames usable frames by source id
 * @param {{us?: boolean}} [opts]
 * @returns {?{source: object, url: string, relay: boolean, scale: number, offX: number, offY: number, fallbacks: object[]}}
 */
export function tilePlan(z, x, y, sources, frames, opts = {}) {
  const chain = chainFor(z, x, y, sources, opts).filter((s) => frames.has(s.id));
  const src = chain[0];
  if (!src) return null;
  const plan = planFor(src, frames.get(src.id), z, x, y);
  if (!plan) return null;
  plan.fallbacks = [];
  if (opts.us && src.id === "rainviewer" && inUs(tileBounds(z, x, y))) {
    for (const s of chain.slice(1)) {
      if (!isUsBackup(s)) continue;
      const p = planFor(s, frames.get(s.id), z, x, y);
      if (p) plan.fallbacks.push(p);
    }
  }
  return plan;
}

/**
 * The tiles a map view covers at one zoom, wrapped, capped.
 * @param {number} z
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} px pixel bounds at z
 * @param {number} [cap]
 * @returns {{x: number, y: number}[]}
 */
export function tilesInView(z, px, cap = 400) {
  const n = 2 ** z;
  const out = [];
  const y0 = Math.max(0, Math.floor(px.minY / 256));
  const y1 = Math.min(n - 1, Math.floor((px.maxY - 1) / 256));
  const x0 = Math.floor(px.minX / 256);
  const x1 = Math.floor((px.maxX - 1) / 256);
  const seen = new Set();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const wx = wrapX(x, z);
      const k = `${wx}/${y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ x: wx, y });
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/**
 * For the visible tiles: the sources that DRAW (for credits) and the sources
 * that must have a frame (for polling) - every source in a tile's chain up
 * to and including the first usable one, so a source is fetched exactly
 * while a visible tile would use it, and its fallback stays fed.
 * In the US, while RainViewer draws a tile, its backups are WANTED too, so
 * their frames are ready the moment one of its tiles fails (D13).
 * @param {number} z
 * @param {{x: number, y: number}[]} tiles
 * @param {object[]} sources in trying order
 * @param {function(object): boolean} usable
 * @param {{us?: boolean}} [opts]
 * @returns {{drawing: Set<string>, wanted: Set<string>}}
 */
export function sourcesForView(z, tiles, sources, usable, opts = {}) {
  const drawing = new Set();
  const wanted = new Set();
  for (const { x, y } of tiles) {
    const chain = chainFor(z, x, y, sources, opts);
    for (let i = 0; i < chain.length; i++) {
      const s = chain[i];
      wanted.add(s.id);
      if (!usable(s)) continue;
      drawing.add(s.id);
      if (opts.us && s.id === "rainviewer" && inUs(tileBounds(z, x, y))) {
        for (const b of chain.slice(i + 1)) if (isUsBackup(b)) wanted.add(b.id);
      }
      break;
    }
  }
  return { drawing, wanted };
}
