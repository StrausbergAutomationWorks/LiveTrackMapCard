import L from "leaflet";
import Logger from "../util/Logger";
import {
  HOME_ZONE, ZONE_CIRCLE_SIZE, MARKER_SIZE, PRECISE_GPS_ACCURACY, CIRCLE_FILL_OPACITY, CIRCLE_LINE_WIDTH,
  domainOf, drawnAsPresence, drawnZones, zoneOf, locationOf, zoneInitials, markerLabel, paletteIndex,
  colorIndex, paletteVar, zoneColorVar, contrastingContent, groupMarkers, bubbles, staysTogether,
  bubbleLayout, pinFootprint, mergeOverlapping,
} from "./PresenceRules.js";
import { PRESENCE_CSS, PRESENCE_STYLE_ID } from "./presenceStyles.js";

/** Panes: zone and accuracy circles over the tiles, zone icons under the markers, people above them. */
export const ZONE_CIRCLE_PANE = "ltmcZoneCircles";
export const ZONE_PANE = "ltmcZones";
export const PRESENCE_PANE = "ltmcPresence";
const PANE_Z = { [ZONE_CIRCLE_PANE]: 405, [ZONE_PANE]: 590, [PRESENCE_PANE]: 640 };

/** Theme values HA defines; used only when a variable reads empty (a page outside Home Assistant). */
export const THEME_FALLBACK = Object.freeze({
  "--primary-color": "#03a9f4",
  "--secondary-text-color": "#727272",
});

/**
 * People, devices and zones drawn as Home Assistant's own map draws them
 * (Lee, 2026-11-19): every non-passive zone as a coloured circle with its
 * icon, each person or tracker as a framed picture on a pin, everyone in a
 * zone sharing one bubble above it, bubbles merging when crowded with "+N"
 * past four, a tap on a bubble zooming to its members.
 *
 * Only person, device_tracker and zone entities are drawn here; every other
 * entity stays with EntitiesRenderService, unchanged.
 */
export default class PresenceRenderService {
  /** @type {L.Map} */ map;
  /** @type {object} */ hass;
  enabled = true;
  /** Entity ids (person / device_tracker) this service draws, from the dashboard. */
  entityIds = [];
  /** Palette slots from the entity registry; null until read (or when it cannot be). */
  palette = null;
  _registryAsked = false;
  _seen = new Map();
  _zoneSig = "";
  _pending = null;
  _zones = [];

  /**
   * @param {L.Map} map
   * @param {{enabled?: boolean, styleHost?: () => Element|null}} options
   *   styleHost: the element whose computed style holds Home Assistant's theme variables
   */
  constructor(map, { enabled = true, styleHost = null } = {}) {
    this.map = map;
    this.enabled = enabled !== false;
    this._styleHost = styleHost;
  }

  setup() {
    if (!this.enabled || !this.map) return;
    for (const [name, z] of Object.entries(PANE_Z)) {
      if (!this.map.getPane(name)) {
        const pane = this.map.createPane(name);
        pane.style.zIndex = String(z);
        if (name !== PRESENCE_PANE) pane.style.pointerEvents = "none";
      }
    }
    this._zoneLayer = L.layerGroup().addTo(this.map);
    this._markerLayer = L.layerGroup().addTo(this.map);
    this._injectStyle();
    this._onZoomEnd = () => this.regroup();
    this._onMoveEnd = () => { if (this._pending) this.regroup(); };
    this.map.on("zoomend", this._onZoomEnd);
    this.map.on("moveend", this._onMoveEnd);
  }

  /** @param {Array<{id: string, display?: string}>} configs the card's EntityConfigs */
  setEntities(configs) {
    const mine = (configs ?? []).filter((c) => drawnAsPresence(c, this.enabled));
    this._drawnIds = new Set(mine.map((c) => c.id));
    const ids = mine.filter((c) => domainOf(c.id) !== "zone").map((c) => c.id);
    if (ids.join(",") !== this.entityIds.join(",")) {
      this.entityIds = ids;
      this._seen.clear();
    }
  }

  /**
   * Is this dashboard entity drawn here (and so not by EntitiesRenderService)?
   * @param {string} id entity id
   * @returns {boolean}
   */
  drawsId(id) {
    return this._drawnIds?.has(id) === true;
  }

  render(hass) {
    if (!this.enabled || !this.map || !hass) return;
    this.hass = hass;
    this._askRegistry();
    const zones = drawnZones(hass.states);
    const zoneSig = JSON.stringify(zones);
    let changed = zoneSig !== this._zoneSig;
    for (const id of this.entityIds) {
      const s = hass.states?.[id];
      if (this._seen.get(id) !== s) { changed = true; this._seen.set(id, s); }
    }
    if (!changed) return;
    this._zoneSig = zoneSig;
    this._zones = zones;
    this.redraw();
  }

  redraw() {
    try {
      this._drawZones();
      this.regroup();
    } catch (e) {
      Logger.error("[PresenceRenderService] redraw failed", e);
    }
  }

  cleanup() {
    if (!this.map) return;
    this.map.off("zoomend", this._onZoomEnd);
    this.map.off("moveend", this._onMoveEnd);
    this._zoneLayer?.remove();
    this._markerLayer?.remove();
  }

  // ---- colours -----------------------------------------------------------

  _readVar(name) {
    try {
      const host = this._styleHost?.() ?? this.map.getContainer();
      const v = getComputedStyle(host).getPropertyValue(name).trim();
      if (v) return v;
    } catch { /* no style yet */ }
    return THEME_FALLBACK[name] ?? THEME_FALLBACK["--primary-color"];
  }

  zoneColor(zone) {
    return this._readVar(zoneColorVar(zone.id, false, this.palette));
  }

  entityColor(id) {
    return this._readVar(paletteVar(colorIndex(id, this.palette)));
  }

  _askRegistry() {
    if (this._registryAsked) return;
    this._registryAsked = true;
    const conn = this.hass?.connection;
    if (typeof conn?.sendMessagePromise !== "function") return;
    conn.sendMessagePromise({ type: "config/entity_registry/list" })
      .then((entries) => {
        this.palette = paletteIndex(entries);
        this.redraw();
      })
      .catch((e) => Logger.warn?.("[PresenceRenderService] entity registry not readable; zone colours from their ids", e));
  }

  // ---- zones -------------------------------------------------------------

  _drawZones() {
    this._zoneLayer.clearLayers();
    for (const z of this._zones) {
      const color = this.zoneColor(z);
      if (z.radius) {
        L.circle([z.lat, z.lng], {
          radius: z.radius, color, weight: CIRCLE_LINE_WIDTH, opacity: 1,
          fillColor: color, fillOpacity: CIRCLE_FILL_OPACITY, interactive: false, pane: ZONE_CIRCLE_PANE,
        }).addTo(this._zoneLayer);
      }
      L.marker([z.lat, z.lng], {
        icon: L.divIcon({
          className: "ltmc-zone-icon", html: this._zoneElement(z, color),
          iconSize: [ZONE_CIRCLE_SIZE, ZONE_CIRCLE_SIZE], iconAnchor: [ZONE_CIRCLE_SIZE / 2, ZONE_CIRCLE_SIZE / 2],
        }),
        interactive: false, keyboard: false, pane: ZONE_PANE,
      }).addTo(this._zoneLayer);
    }
  }

  _zoneElement(zone, color) {
    const el = document.createElement("div");
    el.className = "ltmc-zone-circle";
    el.dataset.zone = zone.id;
    el.title = zone.name;
    el.style.backgroundColor = color;
    el.style.color = contrastingContent(color);
    if (zone.icon) {
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", zone.icon);
      el.appendChild(icon);
    } else {
      const span = document.createElement("span");
      span.textContent = zoneInitials(zone.name);
      el.appendChild(span);
    }
    return el;
  }

  // ---- people and devices ------------------------------------------------

  _members() {
    const states = this.hass?.states ?? {};
    const zoom = this.map.getZoom();
    const out = [];
    for (const id of this.entityIds) {
      const s = states[id];
      if (!s) continue;
      const loc = locationOf(s, states);
      if (!loc) continue;
      const p = this.map.project([loc.lat, loc.lng], zoom);
      const title = s.attributes?.friendly_name ?? id;
      const pic = s.attributes?.entity_picture;
      out.push({
        id, title, x: p.x, y: p.y, lat: loc.lat, lng: loc.lng, gpsAccuracy: loc.gpsAccuracy,
        key: zoneOf(s, loc, this._zones, states),
        picture: typeof pic === "string" && pic !== "" ? (this.hass.hassUrl ? this.hass.hassUrl(pic) : pic) : null,
      });
    }
    return out;
  }

  _atMaxZoom() {
    return this.map.getZoom() >= this.map.getMaxZoom() - 0.01;
  }

  _prepare(group, pending) {
    if (!bubbles(group)) { group.layout = null; return; }
    if (!group.open) {
      const together = () => staysTogether(
        group.members.map((m) => this.map.project([m.lat, m.lng], this.map.getMaxZoom())), group.key !== undefined);
      if (this._atMaxZoom() || (pending && group.members.some((m) => pending.has(m.id)) && together())) group.open = true;
    }
    group.layout = bubbleLayout(group.members.length, Boolean(group.open), this.map.getSize().x, group.key !== undefined);
  }

  _bubbleAt(group) {
    const z = group.key !== undefined ? this._zones.find((zz) => zz.id === group.key) : null;
    return z ? { lat: z.lat, lng: z.lng } : group.center;
  }

  _rectOf(group) {
    if (!group.layout) return null;
    const p = this.map.project(this._bubbleAt(group), this.map.getZoom());
    const left = p.x - group.layout.anchor[0], top = p.y - group.layout.anchor[1];
    return { left, top, right: left + group.layout.width, bottom: top + group.layout.height };
  }

  /** Group, merge and draw the pins and bubbles for the current zoom. */
  regroup() {
    if (!this._markerLayer || !this.hass) return;
    try {
      const pending = this._pending;
      this._pending = null;
      let groups = groupMarkers(this._members());
      groups.forEach((g) => this._prepare(g, pending));
      groups = mergeOverlapping(groups, (g) => this._rectOf(g), (g) => this._prepare(g, pending));
      this._markerLayer.clearLayers();
      this.groups = groups;
      for (const g of groups) {
        if (g.layout) this._drawBubble(g);
        else this._drawPin(g.members[0]);
      }
    } catch (e) {
      Logger.error("[PresenceRenderService] regroup failed", e);
    }
  }

  _frame(member, size) {
    const frame = document.createElement("div");
    frame.className = "ltmc-frame" + (member.picture ? " picture" : "");
    frame.dataset.entityId = member.id;
    frame.title = member.title;
    if (size) frame.style.setProperty("--ltmc-marker-size", `${size}px`);
    if (member.picture) {
      const pic = document.createElement("div");
      pic.className = "ltmc-picture";
      pic.style.backgroundImage = `url("${member.picture}")`;
      frame.appendChild(pic);
    } else {
      frame.textContent = markerLabel(member.title);
    }
    return frame;
  }

  _drawPin(member) {
    const color = this.entityColor(member.id);
    if (member.gpsAccuracy > 0) {
      L.circle([member.lat, member.lng], {
        radius: member.gpsAccuracy, color, weight: member.gpsAccuracy > PRECISE_GPS_ACCURACY ? CIRCLE_LINE_WIDTH : 0,
        opacity: 1, fillColor: color, fillOpacity: CIRCLE_FILL_OPACITY, interactive: false, pane: ZONE_CIRCLE_PANE,
      }).addTo(this._markerLayer);
    }
    const root = document.createElement("div");
    root.className = "ltmc-pin";
    const frame = this._frame(member, MARKER_SIZE);
    const tail = document.createElement("div");
    tail.className = "ltmc-tail";
    const dot = document.createElement("div");
    dot.className = "ltmc-dot";
    root.append(frame, tail, dot);
    frame.addEventListener("click", (ev) => { ev.stopPropagation(); this._moreInfo(member.id); });
    const fp = pinFootprint(MARKER_SIZE);
    L.marker([member.lat, member.lng], {
      icon: L.divIcon({ className: "ltmc-pin-icon", html: root, iconSize: fp.size, iconAnchor: fp.anchor }),
      pane: PRESENCE_PANE, keyboard: false, bubblingMouseEvents: false,
    }).addTo(this._markerLayer);
  }

  _drawBubble(group) {
    const { layout } = group;
    const root = document.createElement("div");
    root.className = "ltmc-cluster" + (group.open ? " open" : "");
    if (group.key !== undefined) root.dataset.zone = group.key;
    root.style.width = `${layout.width}px`;
    root.style.height = `${layout.height}px`;
    const bubble = document.createElement("div");
    bubble.className = "ltmc-bubble";
    for (const m of group.members.slice(0, layout.shownCount)) {
      const avatar = this._frame(m, null);
      if (group.open) {
        avatar.addEventListener("click", (ev) => { ev.stopPropagation(); this._moreInfo(m.id); });
      }
      bubble.appendChild(avatar);
    }
    if (layout.more) {
      const more = document.createElement("span");
      more.className = "more";
      more.textContent = layout.more;
      bubble.appendChild(more);
    }
    const tail = document.createElement("div");
    tail.className = "ltmc-bubble-tail";
    root.append(bubble, tail);
    root.title = group.members.map((m) => m.title).join(", ");
    if (!group.open) {
      root.addEventListener("click", (ev) => { ev.stopPropagation(); this.zoomTo(group.members); });
    }
    L.marker(this._bubbleAt(group), {
      icon: L.divIcon({ className: "ltmc-cluster-icon", html: root, iconSize: [layout.width, layout.height], iconAnchor: layout.anchor }),
      pane: PRESENCE_PANE, keyboard: false, bubblingMouseEvents: false,
    }).addTo(this._markerLayer);
  }

  /**
   * A tap on a closed bubble: zoom to its members; it opens if zooming in could not part them.
   * @param {Array<{id: string, lat: number, lng: number}>} members
   */
  zoomTo(members) {
    this._pending = new Set(members.map((m) => m.id));
    const bounds = L.latLngBounds(members.map((m) => [m.lat, m.lng])).pad(0.3);
    const zoom = Math.min(this.map.getBoundsZoom(bounds), this.map.getMaxZoom());
    // Already there: no moveend would come, so regroup now
    if (zoom === this.map.getZoom() && this.map.getBounds().contains(bounds)) { this.regroup(); return; }
    this.map.fitBounds(bounds, { maxZoom: this.map.getMaxZoom() });
  }

  _moreInfo(entityId) {
    const ev = new Event("hass-action", { bubbles: true, composed: true });
    ev.detail = { config: { entity: entityId, tap_action: { action: "more-info" } }, action: "tap" };
    this.map.getContainer().dispatchEvent(ev);
  }

  _injectStyle() {
    const root = this.map.getContainer().getRootNode?.();
    const target = root && root.nodeType === 11 ? root : document.head;
    if (target.querySelector?.(`#${PRESENCE_STYLE_ID}`)) return;
    const style = document.createElement("style");
    style.id = PRESENCE_STYLE_ID;
    style.textContent = PRESENCE_CSS;
    target.appendChild(style);
  }
}

export { HOME_ZONE };
