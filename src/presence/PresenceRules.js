/**
 * People, devices and zones as Home Assistant's own map draws them (HA 2026.10,
 * "A whole new map"): the rules, without Leaflet or the DOM, so they can be
 * tested on their own.
 *
 * Written for this card from Home Assistant frontend's design and constants
 * (home-assistant/frontend, Apache-2.0; read at commit
 * 4d8eca2229633c545926fd0a1cec32f35768949d: src/common/map/zone-marker.ts,
 * entity-map-colors.ts, src/common/color/colors.ts,
 * src/components/map/ha-entity-marker.ts, ha-map.ts and
 * src/common/map/engines/maplibre-map-engine.ts). See THIRD_PARTY_NOTICES.md.
 */

export const HOME_ZONE = "zone.home";

/** A zone's marker: a circle this wide, its icon this size. */
export const ZONE_CIRCLE_SIZE = 36;
export const ZONE_ICON_SIZE = 24;
/** WCAG minimum contrast for icons and other graphics. */
export const MIN_CONTENT_CONTRAST = 3;

/** A person or tracker pin: the framed picture, its border. */
export const MARKER_SIZE = 48;
export const MARKER_BORDER = 3;
/** Floating: the frame above a rotated-square tail and a dot. */
export const FLOATING_TAIL_SIZE = 12;
export const FLOATING_TAIL_REACH = Math.round((FLOATING_TAIL_SIZE * Math.SQRT2) / 2);
export const FLOATING_GAP = 4;
export const FLOATING_DOT_SIZE = 10;
export const FLOATING_LIFT = FLOATING_GAP + FLOATING_DOT_SIZE / 2;

/** Bubbles. */
export const CLUSTER_AVATAR_SIZE = 32;
export const CLUSTER_BUBBLE_PADDING = 6;
export const CLUSTER_BUBBLE_GAP = 4;
export const CLUSTER_BUBBLE_MARGIN = 12;
export const CLUSTER_MAX_AVATARS = 4;
export const CLUSTER_MORE_WIDTH = 28;
export const CLUSTER_MORE_MAX = 99;
export const CLUSTER_TAIL_SIZE = 10;
export const CLUSTER_TAIL_HEIGHT = Math.round((CLUSTER_TAIL_SIZE * Math.SQRT2) / 2);
export const CLUSTER_ZONE_SPACING = 2;
/** Markers outside a zone merge within this many screen pixels. */
export const CLUSTER_RADIUS = 40;
/** Same-zone members share the zone's bubble while they span at most this many pixels. */
export const ZONE_GROUP_RADIUS = 160;
/** Fixes this good (metres) draw a soft disc without an outline. */
export const PRECISE_GPS_ACCURACY = 10;
/** Circles (zone radius, accuracy): fill opacity and outline width. */
export const CIRCLE_FILL_OPACITY = 0.2;
export const CIRCLE_LINE_WIDTH = 3;

/** The theme's palette: --color-1 .. --color-54. */
export const COLORS_COUNT = 54;

const OUTSIDE_STATES = ["not_home", "unknown", "unavailable"];

/**
 * @param {string} id entity id
 * @returns {string} its domain
 */
export const domainOf = (id) => (typeof id === "string" ? id.split(".")[0] : "");

/**
 * Is this entity of a kind drawn the new way?
 * @param {string} id entity id
 * @returns {boolean} person, device_tracker or zone
 */
export const isPresenceDomain = (id) => ["person", "device_tracker", "zone"].includes(domainOf(id));

/**
 * Is an entity from the dashboard drawn the new way? A person, tracker or
 * zone whose `display:` is unset, `marker` (the default) or `pill` (folded in,
 * Lee 2026-11-19). Any other `display:` keeps the card's older marker.
 * @param {{id: string, display?: string}} config an EntityConfig
 * @param {boolean} enabled the card's `presence_markers` option
 * @returns {boolean}
 */
export function drawnAsPresence(config, enabled) {
  if (!enabled || !config || !isPresenceDomain(config.id)) return false;
  const d = config.display;
  return d == null || d === "marker" || d === "pill";
}

/**
 * A zone's initials: the first letter of each word, at most two.
 * @param {string} name the zone's name
 * @returns {string}
 */
export const zoneInitials = (name) =>
  String(name ?? "").split(" ").map((part) => part[0] ?? "").join("").slice(0, 2);

/**
 * What a pin without a picture shows: the first letter of each word, at most three.
 * @param {string} title the entity's name
 * @returns {string}
 */
export const markerLabel = (title) =>
  String(title ?? "").split(" ").map((part) => part[0] ?? "").join("").substring(0, 3);

/**
 * The palette slot of an entity no registry entry places (a YAML zone).
 * @param {string} entityId entity id
 * @returns {number}
 */
export function hashIndex(entityId) {
  let hash = 5381;
  const s = String(entityId);
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 33 + s.charCodeAt(i)) % 2147483647;
  }
  return hash;
}

const byCreation = (a, b) =>
  (Number(a.created_at) || 0) - (Number(b.created_at) || 0) || String(a.id).localeCompare(String(b.id));

/**
 * Palette slots from the entity registry: zones (home excluded) in one
 * sequence, persons then trackers in another, each by creation.
 * @param {Array<{entity_id: string, id: string, created_at: number}>} entries
 * @returns {{byEntityId: Record<string, number>, zoneCount: number}}
 */
export function paletteIndex(entries) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e.entity_id === "string") : [];
  const of = (domain) => list.filter((e) => domainOf(e.entity_id) === domain).sort(byCreation);
  const zones = of("zone").filter((e) => e.entity_id !== HOME_ZONE);
  const people = [...of("person"), ...of("device_tracker")];
  const byEntityId = {};
  for (const seq of [zones, people]) seq.forEach((e, i) => { byEntityId[e.entity_id] = i; });
  return { byEntityId, zoneCount: zones.length };
}

/**
 * The theme variable holding a palette slot.
 * @param {number} index the slot
 * @returns {string} --color-1 .. --color-54, wrapping
 */
export const paletteVar = (index) => `--color-${(index % COLORS_COUNT) + 1}`;

/**
 * The palette slot of an entity: its registry place, else its hash.
 * @param {string} entityId entity id
 * @param {{byEntityId: Record<string, number>}|null} index from paletteIndex
 * @returns {number}
 */
export function colorIndex(entityId, index) {
  const i = index?.byEntityId?.[entityId];
  return Number.isInteger(i) ? i : hashIndex(entityId);
}

/**
 * The CSS variable a zone is coloured with: home the theme's primary colour,
 * a passive zone muted, any other its palette slot.
 * @param {string} entityId the zone
 * @param {boolean} passive the zone's passive flag
 * @param {{byEntityId: Record<string, number>}|null} index from paletteIndex
 * @returns {string} a CSS variable name
 */
export function zoneColorVar(entityId, passive, index) {
  if (entityId === HOME_ZONE) return "--primary-color";
  if (passive) return "--secondary-text-color";
  return paletteVar(colorIndex(entityId, index));
}

/**
 * @param {string} color #rgb, #rrggbb, #rrggbbaa or rgb()/rgba()
 * @returns {Array<number>|null} red, green, blue 0..255
 */
export function parseColor(color) {
  const c = String(color ?? "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) return m[1].split("").map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c);
  if (m) return [m[1], m[2], m[3]].map((v) => Math.min(255, Math.max(0, Math.round(Number(v)))));
  return null;
}

const luminance = ([r, g, b]) => {
  const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/**
 * White content while it contrasts enough with the fill, black otherwise; white if unreadable.
 * @param {string} color the fill
 * @returns {string} #ffffff or #000000
 */
export function contrastingContent(color) {
  const rgb = parseColor(color);
  if (!rgb) return "#ffffff";
  const contrast = 1.05 / (luminance(rgb) + 0.05);
  return contrast >= MIN_CONTENT_CONTRAST ? "#ffffff" : "#000000";
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * The zones drawn: every non-passive zone with a position.
 * @param {Record<string, any>} states
 * @returns {Array<{id: string, lat: number, lng: number, radius: number|null, icon: string|null, name: string}>}
 */
export function drawnZones(states) {
  const out = [];
  for (const [id, s] of Object.entries(states ?? {})) {
    if (domainOf(id) !== "zone" || !s?.attributes) continue;
    const a = s.attributes;
    if (a.passive) continue;
    if (!isNum(a.latitude) || !isNum(a.longitude)) continue;
    out.push({
      id,
      lat: a.latitude,
      lng: a.longitude,
      radius: isNum(a.radius) && a.radius > 0 ? a.radius : null,
      icon: typeof a.icon === "string" && a.icon !== "" ? a.icon : null,
      name: typeof a.friendly_name === "string" ? a.friendly_name : id,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Great-circle distance in metres.
 * @param {{lat: number, lng: number}} a
 * @param {{lat: number, lng: number}} b
 * @returns {number}
 */
export function distanceMeters(a, b) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The smallest drawn zone whose radius covers a position within its GPS accuracy.
 * @param {{lat: number, lng: number}} position
 * @param {number} gpsAccuracy metres
 * @param {Array<{id: string, lat: number, lng: number, radius: number|null}>} zones from drawnZones
 * @returns {string|undefined} the zone's id
 */
export function zoneContaining(position, gpsAccuracy, zones) {
  let found, foundRadius = Infinity, foundDistance = Infinity;
  for (const z of zones) {
    if (z.radius == null) continue;
    const d = distanceMeters(position, z);
    if (d - (gpsAccuracy || 0) < z.radius && (z.radius < foundRadius || (z.radius === foundRadius && d < foundDistance))) {
      found = z.id; foundRadius = z.radius; foundDistance = d;
    }
  }
  return found;
}

/**
 * The zone a person or tracker counts as in: the first active zone of its
 * `in_zones` that is drawn; without `in_zones` (and not away or unknown), the
 * zone containing its position.
 * @param {object} stateObj the person's or tracker's state
 * @param {{lat: number, lng: number}} position where it is
 * @param {Array<{id: string}>} zones from drawnZones
 * @param {Record<string, any>} states hass.states
 * @returns {string|undefined} the zone's id
 */
export function zoneOf(stateObj, position, zones, states) {
  const domain = domainOf(stateObj?.entity_id);
  if (domain !== "person" && domain !== "device_tracker") return undefined;
  const drawn = new Set(zones.map((z) => z.id));
  const inZones = stateObj.attributes?.in_zones;
  if (Array.isArray(inZones) && inZones.length > 0) {
    for (const id of inZones) {
      const z = states?.[id]?.attributes;
      if (z && !z.passive && isNum(z.latitude) && isNum(z.longitude)) return drawn.has(id) ? id : undefined;
    }
    return undefined;
  }
  if (!Array.isArray(inZones) || !OUTSIDE_STATES.includes(stateObj.state)) {
    return zoneContaining(position, stateObj.attributes?.gps_accuracy, zones);
  }
  return undefined;
}

/**
 * Where a person or tracker is: its own position, else (a person) its first active zone's.
 * @param {object} stateObj the person's or tracker's state
 * @param {Record<string, any>} states hass.states
 * @returns {{lat: number, lng: number, gpsAccuracy: number}|null}
 */
export function locationOf(stateObj, states) {
  const a = stateObj?.attributes ?? {};
  if (isNum(a.latitude) && isNum(a.longitude)) {
    return { lat: a.latitude, lng: a.longitude, gpsAccuracy: isNum(a.gps_accuracy) ? a.gps_accuracy : 0 };
  }
  if (domainOf(stateObj?.entity_id) !== "person" || !Array.isArray(a.in_zones)) return null;
  for (const id of a.in_zones) {
    const z = states?.[id]?.attributes;
    if (z && !z.passive && isNum(z.latitude) && isNum(z.longitude)) return { lat: z.latitude, lng: z.longitude, gpsAccuracy: 0 };
  }
  return null;
}

const spreadOf = (points) => {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};

const centerOf = (members) => ({
  lat: members.reduce((s, m) => s + m.lat, 0) / members.length,
  lng: members.reduce((s, m) => s + m.lng, 0) / members.length,
});

/**
 * Group markers by screen distance. Keyed groups (a zone) first: they share
 * one bubble while they span at most groupRadius, a lone member included;
 * spread wider they fall through to proximity, where each joins the first
 * group with a member within radius.
 * @param {Array<{id: string, key?: string, x: number, y: number, lat: number, lng: number}>} markers
 * @param {{radius?: number, groupRadius?: number}} [options] screen pixels
 * @returns {Array<{members: Array, key?: string, center: {lat: number, lng: number}}>}
 */
export function groupMarkers(markers, { radius = CLUSTER_RADIUS, groupRadius = ZONE_GROUP_RADIUS } = {}) {
  const groups = [];
  const ungrouped = [];
  const byKey = new Map();
  for (const m of markers) {
    if (m.key === undefined || m.key === null) ungrouped.push(m);
    else { if (!byKey.has(m.key)) byKey.set(m.key, []); byKey.get(m.key).push(m); }
  }
  for (const [key, members] of byKey) {
    if (members.length === 1 || spreadOf(members) <= groupRadius) groups.push({ members: [...members], key });
    else ungrouped.push(...members);
  }
  for (const m of ungrouped) {
    const g = groups.find((c) => c.members.some((o) => Math.hypot(o.x - m.x, o.y - m.y) <= radius));
    if (g) g.members.push(m);
    else groups.push({ members: [m] });
  }
  return groups.map((g) => ({ members: g.members, key: g.key, center: centerOf(g.members) }));
}

/**
 * Does a group bubble? More than one member, or keyed to a zone.
 * @param {{members: Array, key?: string}} group
 * @returns {boolean}
 */
export const bubbles = (group) => group.members.length > 1 || group.key !== undefined;

/**
 * Whether the members would still share one bubble at the maximum zoom.
 * @param {Array<{x: number, y: number}>} points the members projected at max zoom
 * @param {boolean} keyed the group belongs to a zone
 * @param {{radius?: number, groupRadius?: number}} [options] screen pixels
 * @returns {boolean}
 */
export function staysTogether(points, keyed, { radius = CLUSTER_RADIUS, groupRadius = ZONE_GROUP_RADIUS } = {}) {
  if (keyed && spreadOf(points) <= groupRadius) return true;
  const linked = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const from = points[queue.pop()];
    points.forEach((p, i) => {
      if (!linked.has(i) && Math.hypot(p.x - from.x, p.y - from.y) <= radius) { linked.add(i); queue.push(i); }
    });
  }
  return linked.size === points.length;
}

/**
 * A bubble's layout: how many avatars, the "+N", rows, its size and the
 * point it hangs from (above its zone's circle, or above the members).
 * @param {number} count members
 * @param {boolean} expanded open: every member, rows wrapping to the map
 * @param {number} mapWidth px
 * @param {boolean} zoned keyed to a zone
 * @returns {{shownCount: number, hidden: number, more: string|null, columns: number, rows: number,
 *   width: number, height: number, anchor: Array<number>}}
 */
export function bubbleLayout(count, expanded, mapWidth, zoned) {
  const shownCount = expanded || count <= CLUSTER_MAX_AVATARS ? count : CLUSTER_MAX_AVATARS - 1;
  const hidden = count - shownCount;
  const perRow = expanded
    ? Math.max(1, Math.floor((mapWidth - 2 * CLUSTER_BUBBLE_MARGIN - 2 * CLUSTER_BUBBLE_PADDING + CLUSTER_BUBBLE_GAP)
        / (CLUSTER_AVATAR_SIZE + CLUSTER_BUBBLE_GAP)))
    : shownCount;
  const columns = Math.min(shownCount, perRow);
  const rows = Math.ceil(shownCount / perRow);
  let width = columns * CLUSTER_AVATAR_SIZE + (columns - 1) * CLUSTER_BUBBLE_GAP + 2 * CLUSTER_BUBBLE_PADDING;
  if (hidden > 0) width += CLUSTER_MORE_WIDTH + CLUSTER_BUBBLE_GAP;
  const height = rows * CLUSTER_AVATAR_SIZE + (rows - 1) * CLUSTER_BUBBLE_GAP + 2 * CLUSTER_BUBBLE_PADDING + CLUSTER_TAIL_HEIGHT;
  const more = hidden > 0 ? (hidden > CLUSTER_MORE_MAX ? `${CLUSTER_MORE_MAX}+` : `+${hidden}`) : null;
  const anchor = [width / 2, height + (zoned ? ZONE_CIRCLE_SIZE / 2 + CLUSTER_ZONE_SPACING : FLOATING_LIFT)];
  return { shownCount, hidden, more, columns, rows, width, height, anchor };
}

/**
 * A floating pin's box and the point it stands on (the dot's centre).
 * @param {number} [size] the frame, px
 * @returns {{size: Array<number>, anchor: Array<number>}}
 */
export function pinFootprint(size = MARKER_SIZE) {
  const height = size + FLOATING_TAIL_REACH + FLOATING_GAP + FLOATING_DOT_SIZE;
  return { size: [size, height], anchor: [size / 2, height - FLOATING_DOT_SIZE / 2] };
}

/**
 * Merge bubbles whose boxes overlap on screen, repeatedly, as HA does. Two
 * zones cannot share a pinned bubble: a merge of two keys is unkeyed.
 * @param {Array} groups output of groupMarkers
 * @param {Function} rectOf (group) => the box {left, top, right, bottom} a bubbling group's icon covers, or null
 * @param {Function} [prepare] (group) => readies a merged group before its box is read
 * @returns {Array} the groups after merging
 */
export function mergeOverlapping(groups, rectOf, prepare = () => {}) {
  let list = groups.slice();
  const overlapping = () => {
    const bubbling = list.filter((g) => bubbles(g));
    const rects = bubbling.map(rectOf);
    for (let i = 0; i < bubbling.length; i++) {
      for (let j = i + 1; j < bubbling.length; j++) {
        const a = rects[i], b = rects[j];
        if (a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) return [bubbling[i], bubbling[j]];
      }
    }
    return null;
  };
  let pair = overlapping();
  while (pair) {
    const [p, q] = pair;
    const members = [...p.members, ...q.members];
    const keys = [p.key, q.key].filter((k) => k !== undefined);
    const merged = { members, key: keys.length === 1 ? keys[0] : undefined, center: centerOf(members) };
    prepare(merged);
    list = list.filter((g) => g !== p && g !== q).concat(merged);
    pair = overlapping();
  }
  return list;
}
