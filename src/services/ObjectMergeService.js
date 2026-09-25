/**
 * One object, one marker - 06_MAP_CONTRACT.md D11 (Lee, 2026-09-24).
 *
 * The same physical object can reach the map from two integrations: a SAR
 * helicopter sending AIS (Live Track Ships) and ADS-B (Live Track Aircraft).
 * No integration dedupes against another - each must work alone - and only
 * the card sees every source, so the card decides. This module is pure: it
 * takes what the entities say and returns which ones NOT to draw. The render
 * service hides those with Entity.hide(); their entities stay in Home
 * Assistant. The winner's marker shows nothing about the merge (Lee).
 */

/** Keys of `object_ids`, and the one form each value is accepted in. */
export const OBJECT_ID_FORMS = {
  mmsi: /^[0-9]{9}$/,
  imo: /^[0-9]{7}$/,
  icao24: /^[0-9a-f]{6}$/,
  registration: /^[A-Z0-9][A-Z0-9-]*$/,
};

/**
 * Pairs that may merge on PROXIMITY, and only these. Two boats rafted
 * together are two boats. Thresholds are chosen, not measured (D11 rule 2).
 */
export const PROXIMITY_PAIRS = [
  {
    a: { source: "live_track_ships", objectKind: "sar_aircraft" },
    b: { source: "live_track_aircraft" },
    maxKm: 1,
    maxSpeedDiffKmh: 60,
  },
];

/** D11 rule 3: first listed wins, per map layer. */
export const LAYER_PRECEDENCE = {
  air: ["live_track_aircraft", "live_track_ships"],
  air_low: ["live_track_aircraft", "live_track_ships"],
};

/**
 * The accepted identifiers of an entity. Only listed keys; only a value that
 * is a STRING already in its normalised form. A malformed value is dropped,
 * never repaired - a repaired identifier is a guessed one.
 * @param {*} objectIds the `object_ids` attribute
 * @returns {[string, string][]} [key, value] pairs
 */
export function parseObjectIds(objectIds) {
  if (!objectIds || typeof objectIds !== "object" || Array.isArray(objectIds)) return [];
  const out = [];
  for (const [key, form] of Object.entries(OBJECT_ID_FORMS)) {
    const v = objectIds[key];
    if (typeof v === "string" && form.test(v)) out.push([key, v]);
  }
  return out;
}

/**
 * Great-circle distance in km.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const finite = (v) => typeof v === "number" && Number.isFinite(v);

const fits = (item, side) => item.source === side.source
  && (side.objectKind === undefined || item.objectKind === side.objectKind);

/**
 * Do two items from different sources merge on proximity under a listed pair?
 * @param {object} x an item from toItem()
 * @param {object} y an item from toItem()
 * @returns {boolean}
 */
function proximityMatch(x, y) {
  for (const pair of PROXIMITY_PAIRS) {
    let a = null, b = null;
    if (fits(x, pair.a) && fits(y, pair.b)) { a = x; b = y; }
    else if (fits(y, pair.a) && fits(x, pair.b)) { a = y; b = x; }
    if (!a) continue;
    if (distanceKm(a.lat, a.lng, b.lat, b.lng) > pair.maxKm) continue;
    if (finite(a.speedKmh) && finite(b.speedKmh)
      && Math.abs(a.speedKmh - b.speedKmh) > pair.maxSpeedDiffKmh) continue;
    return true;
  }
  return false;
}

/**
 * Listed precedence for the item's own map layer; unlisted sorts last.
 * @param {object} item an item from toItem()
 * @returns {number}
 */
function rank(item) {
  const order = LAYER_PRECEDENCE[item.mapLayer];
  if (!order) return Infinity;
  const i = order.indexOf(item.source);
  return i < 0 ? Infinity : i;
}

/**
 * Normalise one entity's view of itself.
 * @param {{id: string, attributes: object, lat: number, lng: number}} e
 * @returns {object}
 */
export function toItem(e) {
  const a = e.attributes ?? {};
  return {
    id: e.id,
    source: typeof a.source === "string" ? a.source : null,
    objectKind: a.object_kind,
    mapLayer: a.map_layer,
    speedKmh: a.speed_kmh,
    ids: parseObjectIds(a.object_ids),
    lat: e.lat,
    lng: e.lng,
  };
}

/**
 * Which of the entities about to be drawn are duplicates of another, and so
 * are not drawn.
 *
 * Entities are visited in precedence order - the listed rank for their own
 * map layer, then entity_id - and each one is KEPT unless it matches an
 * already-kept entity from a DIFFERENT source, by a shared identifier or by
 * a listed proximity pair. So a duplicate always yields to its better, and
 * two entities of one source are never merged with each other, even through
 * a third: two aircraft near one SAR helicopter both stay.
 *
 * An entity with no `source` never merges (it cannot satisfy "different
 * source"). Only entities with a position should be passed.
 * @param {{id: string, attributes: object, lat: number, lng: number}[]} entities
 * @returns {Set<string>} entity ids not to draw
 */
export function mergedAway(entities) {
  const items = entities.map(toItem).filter((i) => i.source);
  items.sort((x, y) => (rank(x) - rank(y)) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  const hidden = new Set();
  const keptById = new globalThis.Map(); // "key:value" -> [sources]
  const keptForProximity = [];

  for (const item of items) {
    let dup = item.ids.some(([k, v]) => (keptById.get(`${k}:${v}`) ?? []).some((s) => s !== item.source));
    if (!dup && finite(item.lat) && finite(item.lng)) {
      dup = keptForProximity.some((k) => k.source !== item.source && proximityMatch(item, k));
    }
    if (dup) {
      hidden.add(item.id);
      continue;
    }
    for (const [k, v] of item.ids) {
      const key = `${k}:${v}`;
      const list = keptById.get(key) ?? [];
      list.push(item.source);
      keptById.set(key, list);
    }
    if (finite(item.lat) && finite(item.lng)
      && PROXIMITY_PAIRS.some((p) => fits(item, p.a) || fits(item, p.b))) {
      keptForProximity.push(item);
    }
  }
  return hidden;
}
