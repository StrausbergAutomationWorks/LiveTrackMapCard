import { LitElement, html, css, nothing } from "lit";
import { domainOf, locationOf, markerLabel, contrastingContent } from "./PresenceRules.js";
import {
  ACTIVITY_HOURS, ACTIVITY_INITIAL_ENTRIES, PHONE_MAX_WIDTH, HALF_VIEWPORT_SHARE, TOUCH_SLOP_PX,
  personActivity, zoneActivity, entityName, isMe, peopleOf, devicesOf, zonesOf, tabsWithItems, shownTab,
  navigationUrl, zoneOfEntry, relativeTime, sheetStops, stopAfterDrag, swipeDirection,
} from "./OverviewRules.js";

export const OVERVIEW_TAG = "ltmc-map-overview";

/** English for when Home Assistant has no translation (a page outside it, an older release). */
const EN = Object.freeze({
  label: "Map overview", people: "People", devices: "Devices", zones: "Zones", me: "Me", activity: "Activity",
  show_more: "Show more", no_activity: "No recent activity", activity_unavailable: "Activity couldn't be loaded",
  directions: "Directions", entered: "Entered", left: "Left",
});

/**
 * The overview beside the map, as Home Assistant's own map card shows it in a panel view
 * (hui-map-overview.ts @ 4d8eca2, Apache-2.0, rewritten; rules in OverviewRules.js): tabs People,
 * Devices, Zones; a row per entity with its state and how long ago; a selected entity's last 24 hours
 * of activity. Desktop: a floating panel. Phone (600 px or less): a bottom sheet dragged between
 * collapsed, half and full, in the browser's top layer.
 *
 * It never touches the map. It fires, bubbling and composed:
 *   ltmc-overview-select {entityId}  (undefined: back to the list)
 *   ltmc-overview-tab    {tab}
 *   ltmc-overview-resize {width, height, fitHeight?}  (0 x 0 when gone or collapsed to nothing)
 */
export class LtmcMapOverview extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      entityIds: { attribute: false },
      names: { attribute: false },
      selected: { attribute: false },
      tab: { attribute: false },
      zoneColor: { attribute: false },
      _phone: { state: true },
      _activity: { state: true },
      _activityFailed: { state: true },
      _activityExpanded: { state: true },
      _position: { state: true },
      _dragHeight: { state: true },
      _minHeight: { state: true },
      _tick: { state: true },
    };
  }

  constructor() {
    super();
    this.entityIds = [];
    this.names = new Map();
    this.tab = "people";
    this.selected = undefined;
    this.zoneColor = () => "var(--accent-color, #ff9800)";
    this._phone = false;
    this._activity = undefined;
    this._activityFailed = false;
    this._activityExpanded = false;
    this._activityRequest = 0;
    this._position = "half";
    this._dragHeight = undefined;
    this._minHeight = undefined;
    this._tick = 0;
    this._drag = null;
    this._pendingTouch = null;
    this._reported = null;
  }

  // ---- strings and formatting -------------------------------------------

  _t(key, vars) {
    try {
      const s = this.hass?.localize?.(`ui.panel.lovelace.cards.map.overview.${key}`, vars);
      if (s) return s;
    } catch { /* no translation */ }
    if (key === "people_in_zone") {
      const n = vars?.count ?? 0;
      return n === 0 ? "No one here" : n === 1 ? "1 person" : `${n} people`;
    }
    return EN[key] ?? key;
  }

  _ui(key, fallback) {
    try { return this.hass?.localize?.(key) || fallback; } catch { return fallback; }
  }

  get _language() {
    return this.hass?.locale?.language ?? this.hass?.language ?? "en";
  }

  _name(s) {
    return entityName(s, this.names, this.hass);
  }

  _personName(s) {
    return isMe(s, this.hass?.user) ? this._t("me") : this._name(s);
  }

  _state(s, state) {
    try {
      const f = this.hass?.formatEntityState?.(s, state);
      if (typeof f === "string" && f !== "") return f;
    } catch { /* an older Home Assistant */ }
    return state ?? s?.state ?? "";
  }

  _ago(when, style = "long") {
    return relativeTime(when, { language: this._language, style });
  }

  _time(when) {
    const tf = this.hass?.locale?.time_format;
    const hour12 = tf === "12" ? true : tf === "24" ? false : undefined;
    try {
      return new Intl.DateTimeFormat(this._language, { hour: "numeric", minute: "2-digit", hour12 }).format(when);
    } catch {
      return when.toLocaleTimeString();
    }
  }

  // ---- lists ------------------------------------------------------------

  _lists() {
    const states = this.hass?.states ?? {};
    const o = { user: this.hass?.user, name: (s) => this._name(s), locale: this._language };
    const people = peopleOf(this.entityIds ?? [], states, o);
    const devices = devicesOf(this.entityIds ?? [], states, o);
    const zones = zonesOf(states, o);
    return { people, devices, zones, tabs: tabsWithItems(people, devices, zones) };
  }

  // ---- life cycle -------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    this._phoneQuery ??= globalThis.matchMedia?.(`(max-width: ${PHONE_MAX_WIDTH}px)`);
    this._phone = Boolean(this._phoneQuery?.matches);
    this._onPhone = () => { this._phone = Boolean(this._phoneQuery?.matches); };
    this._phoneQuery?.addEventListener?.("change", this._onPhone);
    this._onViewport = () => this._report();
    globalThis.addEventListener?.("resize", this._onViewport);
    this._ro ??= typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (!this._phone) this._report(); }) : null;
    this._ro?.observe(this);
    this._clock();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._phoneQuery?.removeEventListener?.("change", this._onPhone);
    globalThis.removeEventListener?.("resize", this._onViewport);
    this._ro?.disconnect();
    clearTimeout(this._clockTimer);
    this._endDrag();
    this._fire("ltmc-overview-resize", { width: 0, height: 0 });
  }

  /** Keeps "x min ago" counting: every second under a minute old, else every minute. */
  _clock() {
    clearTimeout(this._clockTimer);
    const s = this.hass?.states?.[this.selected];
    const ages = [s?.last_updated, ...(this._activity ?? []).map((e) => e.when)]
      .map((t) => Date.now() - new Date(t).getTime()).filter((a) => Number.isFinite(a));
    const soon = ages.some((a) => a < 60000);
    this._clockTimer = setTimeout(() => { this._tick++; this._clock(); }, soon ? 1000 : 60000);
  }

  willUpdate(changed) {
    if (changed.has("selected")) {
      this._activity = undefined;
      this._activityFailed = false;
      this._activityExpanded = false;
      const request = ++this._activityRequest;
      if (this.selected) this.loadActivity(this.selected, request);
    }
  }

  updated(changed) {
    // The host filters the map by the tab it set; say so when that tab has gone.
    const { tabs } = this._lists();
    if (tabs.length && !tabs.some(([t]) => t === this.tab)) this._fire("ltmc-overview-tab", { tab: tabs[0][0] });
    this.toggleAttribute("single-tab", tabs.length === 1);
    this.toggleAttribute("phone", this._phone);
    if (this._phone) {
      this._showPopovers();
      this._measurePeek();
      if (changed.has("selected") && this.selected) this._position = "half";
      if (changed.has("_position") || changed.has("_minHeight") || changed.has("_phone") ||
          (changed.has("_dragHeight") && this._dragHeight === undefined)) this._reportWhenSettled();
    } else if (changed.has("_phone")) {
      this._report();
    }
    if (changed.has("selected")) this._moveFocus(changed.get("selected"));
  }

  _fire(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  // ---- activity ---------------------------------------------------------

  /**
   * The selection's activity in the last 24 hours, from Home Assistant's history: a person's or
   * tracker's state changes, or a zone's arrivals and departures by the map's people.
   * @param {string} entityId
   * @param {number} request only the newest request may show its answer
   * @returns {Promise<void>}
   */
  async loadActivity(entityId, request) {
    const since = Date.now() - ACTIVITY_HOURS * 3600 * 1000;
    const zone = domainOf(entityId) === "zone";
    const ids = zone ? this._lists().people.map((p) => p.entity_id) : [entityId];
    let history = {};
    if (ids.length) {
      try {
        history = await this.hass.callWS({
          type: "history/history_during_period",
          start_time: new Date(since).toISOString(),
          end_time: new Date(Date.now()).toISOString(),
          entity_ids: ids,
          minimal_response: false,
          no_attributes: false,
        });
      } catch {
        history = null;
      }
    }
    if (request !== this._activityRequest) return;
    if (history === null) {
      this._activityFailed = true;
      this._activity = [];
      return;
    }
    this._activity = zone ? zoneActivity(history, ids, entityId, since) : personActivity(history?.[entityId], since);
    this._clock();
  }

  // ---- events from the panel --------------------------------------------

  _onRow(ev) {
    const id = ev.currentTarget?.dataset?.entityId;
    if (id) this._fire("ltmc-overview-select", { entityId: id });
  }

  _onBack() {
    this._fire("ltmc-overview-select", { entityId: undefined });
  }

  _onTabClick(ev) {
    this._fire("ltmc-overview-tab", { tab: ev.currentTarget?.dataset?.tab });
  }

  _onTabKey(ev) {
    const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const buttons = [...(this.renderRoot?.querySelectorAll?.(".tablist button") ?? [])];
    const i = buttons.indexOf(ev.target);
    const rtl = getComputedStyle(this).direction === "rtl";
    const next = buttons[(i + (rtl ? -step : step) + buttons.length) % buttons.length];
    if (next?.dataset?.tab) {
      this._fire("ltmc-overview-tab", { tab: next.dataset.tab });
      next.focus();
    }
  }

  _onDirections() {
    const s = this.hass?.states?.[this.selected];
    const loc = s && locationOf(s, this.hass.states);
    if (loc) globalThis.open?.(navigationUrl(loc.lat, loc.lng), "_blank", "noreferrer");
  }

  _onSettings() {
    if (!this.selected) return;
    this._fire("hass-more-info", { entityId: this.selected, view: "settings" });
  }

  _moveFocus(previous) {
    const root = this.renderRoot;
    if (!root?.querySelector) return;
    if (this.selected) {
      root.querySelector(".detail-name")?.focus?.();
    } else if (previous) {
      const row = [...root.querySelectorAll(".row")].find((r) => r.dataset.entityId === previous);
      (row ?? root.querySelector('.tablist button[aria-selected="true"]'))?.focus?.();
    }
  }

  // ---- size reports -----------------------------------------------------

  _report() {
    if (this._phone) { this._reportWhenSettled(); return; }
    const r = this.getBoundingClientRect?.();
    const d = { width: r?.width ?? 0, height: r?.height ?? 0 };
    if (this._reported?.width === d.width && this._reported?.height === d.height) return;
    this._reported = d;
    this._fire("ltmc-overview-resize", d);
  }

  _halfHeight() {
    return (globalThis.innerHeight ?? 0) * HALF_VIEWPORT_SHARE;
  }

  /** The sheet tells the host its height once it settles, not on every frame of a drag. */
  async _reportWhenSettled() {
    await this.updateComplete;
    const sheet = this.renderRoot?.querySelector?.(".sheet");
    if (!sheet || this._drag) return;
    try { await Promise.all((sheet.getAnimations?.() ?? []).map((a) => a.finished)); } catch { return; }
    if (this._drag) return;
    const d = { width: globalThis.innerWidth ?? 0, height: sheet.offsetHeight, fitHeight: this._halfHeight() };
    if (this._reported?.height === d.height && this._reported?.fitHeight === d.fitHeight && this._reported?.width === d.width) return;
    this._reported = d;
    this._fire("ltmc-overview-resize", d);
  }

  /** The collapsed sheet keeps the tabs (or the detail header) reachable: padding + that strip + a gap. */
  _measurePeek() {
    const panel = this.renderRoot?.querySelector?.(".sheet .panel");
    const peek = this.renderRoot?.querySelector?.(".peek");
    if (!panel || !peek) return;
    const st = getComputedStyle(panel);
    const h = (parseFloat(st.paddingTop) || 0) + peek.offsetHeight + 12;
    if (h > 0 && Math.abs(h - (this._minHeight ?? 0)) > 0.5) this._minHeight = h;
  }

  _showPopovers() {
    for (const el of this.renderRoot?.querySelectorAll?.(".backdrop, .sheet") ?? []) {
      try { if (el.showPopover && !el.matches(":popover-open")) el.showPopover(); } catch { /* no popover support */ }
    }
  }

  // ---- the sheet's drag (ha-snap-bottom-sheet's rules) --------------------

  _stops() {
    const sheet = this.renderRoot?.querySelector?.(".sheet");
    const full = sheet ? parseFloat(getComputedStyle(sheet).maxHeight) : (globalThis.innerHeight ?? 0) - 48;
    return sheetStops(this._minHeight, this._halfHeight(), Number.isFinite(full) ? full : (globalThis.innerHeight ?? 0) - 48);
  }

  /** @param {number} clientY */
  _startDrag(clientY) {
    const sheet = this.renderRoot?.querySelector?.(".sheet");
    const now = Date.now();
    this._drag = { startY: clientY, startTime: now, lastY: clientY, lastTime: now, startHeight: sheet?.offsetHeight ?? 0 };
  }

  /** @param {number} clientY */
  _moveDrag(clientY) {
    if (!this._drag) return;
    this._drag.lastY = clientY;
    this._drag.lastTime = Date.now();
    const lowest = this._stops()[0].height;
    this._dragHeight = Math.max(lowest, this._drag.startHeight + (this._drag.startY - clientY));
  }

  _endDrag() {
    const g = this._drag;
    if (!g) return;
    this._drag = null;
    globalThis.document?.body?.style?.removeProperty?.("cursor");
    globalThis.document?.removeEventListener?.("mousemove", this._onMouseMove);
    globalThis.document?.removeEventListener?.("mouseup", this._onMouseUp);
    const height = this._dragHeight ?? g.startHeight;
    this._position = stopAfterDrag(this._stops(), height, swipeDirection(g, Date.now()));
    this._dragHeight = undefined;
  }

  _onMouseDown = (ev) => {
    globalThis.document?.body?.style?.setProperty?.("cursor", "grabbing");
    globalThis.document?.addEventListener?.("mousemove", this._onMouseMove);
    globalThis.document?.addEventListener?.("mouseup", this._onMouseUp);
    this._startDrag(ev.clientY);
  };

  _onMouseMove = (ev) => this._moveDrag(ev.clientY);

  _onMouseUp = () => this._endDrag();

  _onTouchStart = (ev) => {
    if (ev.touches?.length !== 1) return;
    this._pendingTouch = null;
    this._endDrag();
    const t = ev.touches[0];
    const path = ev.composedPath?.() ?? [];
    if (path.some((n) => n?.classList?.contains?.("handle"))) {
      ev.preventDefault();
      this._startDrag(t.clientY);
      return;
    }
    this._pendingTouch = { x: t.clientX, y: t.clientY };
  };

  _onTouchMove = (ev) => {
    const t = ev.touches?.[0];
    if (!t) return;
    if (this._pendingTouch) {
      const s = this._pendingTouch;
      const dx = t.clientX - s.x, dy = t.clientY - s.y;
      if (ev.cancelable && Math.hypot(dx, dy) < TOUCH_SLOP_PX) return;
      this._pendingTouch = null;
      // Sideways moves, scrolls the browser began, and scrolling up at full height stay with the content.
      if (!ev.cancelable || Math.abs(dx) > Math.abs(dy) || (dy < 0 && this._position === "full")) return;
      this._startDrag(s.y);
    }
    if (!this._drag) return;
    ev.preventDefault();
    this._moveDrag(t.clientY);
  };

  _onTouchEnd = () => {
    this._pendingTouch = null;
    this._endDrag();
  };

  // ---- render -----------------------------------------------------------

  render() {
    const { tabs } = this._lists();
    if (!tabs.length) return nothing;
    const s = this.selected ? this.hass?.states?.[this.selected] : undefined;
    const content = s ? this._renderDetail(s) : this._renderList(tabs);
    if (!this._phone) return html`<div class="panel">${content}</div>`;
    const full = this._position === "full";
    const dragging = this._dragHeight !== undefined;
    const height = dragging ? `${this._dragHeight}px`
      : this._position === "collapsed" && this._minHeight !== undefined ? `${this._minHeight}px` : "";
    const backdrop = full && !dragging ? 1 : 0;
    return html`
      <div class="backdrop ${full ? "active" : ""} ${dragging ? "dragging" : ""}" popover="manual"
        style="opacity: ${backdrop}" @click=${() => { this._position = "half"; }}></div>
      <div class="sheet ${full ? "full" : ""} ${dragging ? "dragging" : ""}" popover="manual" role="region"
        aria-label=${this._t("label")}
        style="${height ? `height: ${height};` : ""} ${this._minHeight !== undefined ? `min-height: ${this._minHeight}px;` : ""}"
        @touchstart=${this._onTouchStart} @touchmove=${this._onTouchMove}
        @touchend=${this._onTouchEnd} @touchcancel=${this._onTouchEnd}>
        <div class="handle-wrapper"><div class="handle" @mousedown=${this._onMouseDown}></div></div>
        <div class="panel">${content}</div>
      </div>`;
  }

  _renderList(tabs) {
    const tab = shownTab(this.tab, tabs);
    const items = tabs.find(([t]) => t === tab)[1];
    if (tabs.length === 1) {
      return html`<div class="heading peek" id="tab-${tab}">${this._t(tab)}</div>${this._renderItems(tab, items)}`;
    }
    const i = tabs.findIndex(([t]) => t === tab);
    return html`
      <div class="tabs peek">
        <span class="pill" style="--tab-count: ${tabs.length}; --tab-index: ${i}" aria-hidden="true"></span>
        <div class="tablist" role="tablist" @keydown=${this._onTabKey}>
          ${tabs.map(([t]) => html`<button type="button" role="tab" id="tab-${t}" aria-controls="tabpanel"
              aria-selected=${t === tab ? "true" : "false"} tabindex=${t === tab ? 0 : -1} data-tab=${t}
              @click=${this._onTabClick}>${this._t(t)}</button>`)}
        </div>
      </div>
      ${this._renderItems(tab, items)}`;
  }

  _renderItems(tab, items) {
    return html`
      <div class="list" id="tabpanel" role="tabpanel" aria-labelledby="tab-${tab}">
        <div class="rows">${items.map((s) => (tab === "zones" ? this._renderZone(s) : this._renderEntity(s)))}</div>
      </div>`;
  }

  _renderEntity(s) {
    const located = Boolean(locationOf(s, this.hass?.states ?? {}));
    return html`
      <button type="button" class="row ${located ? "" : "no-location"}" data-entity-id=${s.entity_id} @click=${this._onRow}>
        ${this._renderAvatar(s)}
        <span class="row-text">
          <span class="headline">${this._personName(s)}</span>
          <span class="supporting">${this._state(s)} · ${this._ago(s.last_updated, "short")}</span>
        </span>
      </button>`;
  }

  _renderZone(z) {
    const count = Number(z.state);
    return html`
      <button type="button" class="row" data-entity-id=${z.entity_id} @click=${this._onRow}>
        ${this._renderZoneAvatar(z)}
        <span class="row-text">
          <span class="headline">${this._name(z)}</span>
          <span class="supporting">${Number.isNaN(count) ? "" : this._t("people_in_zone", { count })}</span>
        </span>
      </button>`;
  }

  _icon(s) {
    if (globalThis.customElements?.get?.("ha-state-icon")) return html`<ha-state-icon .hass=${this.hass} .stateObj=${s}></ha-state-icon>`;
    const fallback = domainOf(s.entity_id) === "zone" ? "mdi:map-marker-radius" : domainOf(s.entity_id) === "person" ? "mdi:account" : "mdi:cellphone";
    return html`<ha-icon icon=${s.attributes?.icon ?? fallback}></ha-icon>`;
  }

  _renderAvatar(s) {
    const pic = s.attributes?.entity_picture;
    const url = typeof pic === "string" && pic ? (this.hass?.hassUrl ? this.hass.hassUrl(pic) : pic) : null;
    return html`<div class="avatar" aria-hidden="true">${url
      ? html`<img src=${url} alt="" loading="lazy" />`
      : domainOf(s.entity_id) === "person" ? html`<span class="initials">${markerLabel(this._name(s)) || "?"}</span>` : this._icon(s)}</div>`;
  }

  _renderZoneAvatar(z) {
    const color = this.zoneColor(z.entity_id, Boolean(z.attributes?.passive));
    return html`<div class="avatar zone" aria-hidden="true"
      style="background: ${color}; color: ${contrastingContent(color)}">${this._icon(z)}</div>`;
  }

  _renderDetail(s) {
    const zone = domainOf(s.entity_id) === "zone";
    const count = zone ? Number(s.state) : NaN;
    const located = Boolean(locationOf(s, this.hass?.states ?? {}));
    return html`
      <div class="detail-header peek">
        <ha-icon-button class="back" .label=${this._ui("ui.common.back", "Back")} @click=${this._onBack}>
          <ha-icon icon="mdi:arrow-left"></ha-icon>
        </ha-icon-button>
        <div class="detail-title">
          <span class="detail-name" tabindex="-1">${this._personName(s)}</span>
          <span class="detail-state">${zone
            ? (Number.isNaN(count) ? "" : this._t("people_in_zone", { count }))
            : html`${this._state(s)} · ${this._ago(s.last_updated, "short")}`}</span>
        </div>
        ${located ? html`<ha-icon-button class="directions" .label=${this._t("directions")} @click=${this._onDirections}>
            <ha-icon icon="mdi:directions"></ha-icon></ha-icon-button>` : nothing}
        ${this.hass?.user?.is_admin ? html`<ha-icon-button class="settings"
            .label=${this._ui("ui.dialogs.more_info_control.settings", "Settings")} @click=${this._onSettings}>
            <ha-icon icon="mdi:cog-outline"></ha-icon></ha-icon-button>` : nothing}
      </div>
      <div class="list">
        <div class="activity">
          <div class="activity-header">
            <span class="activity-icon"><ha-icon icon="mdi:history"></ha-icon></span>
            <span class="activity-title">${this._t("activity")}</span>
          </div>
          ${!this._activity
            ? html`<div class="activity-loading"><span class="spinner" aria-hidden="true"></span></div>`
            : !this._activity.length
              ? html`<span class="activity-empty">${this._t(this._activityFailed ? "activity_unavailable" : "no_activity")}</span>`
              : this._renderTimeline(s, this._activity)}
        </div>
      </div>`;
  }

  _renderTimeline(s, activity) {
    const shown = this._activityExpanded ? activity : activity.slice(0, ACTIVITY_INITIAL_ENTRIES);
    return html`
      <div class="timeline">${shown.map((e) => this._renderEntry(s, e))}</div>
      ${activity.length > shown.length
        ? html`<button type="button" class="show-more" @click=${() => { this._activityExpanded = true; }}>${this._t("show_more")}</button>`
        : nothing}`;
  }

  _renderEntry(s, e) {
    const states = this.hass?.states ?? {};
    const person = e.personId ? states[e.personId] : undefined;
    const headline = e.personId ? (person ? this._personName(person) : e.personId) : this._state(s, e.state);
    const zone = e.personId ? undefined : zoneOfEntry(e, states);
    const tile = zone ? this._renderZoneAvatar(zone) : person ? this._renderAvatar(person) : html`<span class="rail" aria-hidden="true"></span>`;
    return html`
      <div class="entry">
        ${tile}
        <div class="entry-text">
          <span class="entry-headline">${headline}</span>
          <span class="entry-when">${e.personId ? html`${this._t(e.arrived ? "entered" : "left")} · ` : nothing}${this._time(e.when)} · ${this._ago(e.when)}</span>
        </div>
      </div>`;
  }

  static get styles() {
    return css`
      :host {
        display: block;
        pointer-events: none;
        font-family: var(--ha-font-family-body, Roboto, sans-serif);
      }
      .panel {
        --avatar-size: 48px;
        pointer-events: auto;
        box-sizing: border-box;
        width: 100%;
        max-height: 100%;
        display: flex;
        flex-direction: column;
        padding: var(--ha-space-3, 12px);
        border-radius: var(--ha-border-radius-xl, 16px);
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color, #212121);
        box-shadow: var(--ha-box-shadow-m, 0 4px 12px rgba(0, 0, 0, 0.18));
      }
      .heading {
        flex: none;
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        font-size: var(--ha-font-size-l, 16px);
        font-weight: var(--ha-font-weight-medium, 500);
      }
      .tabs {
        position: relative;
        flex: none;
        padding: var(--ha-space-1, 4px);
        border-radius: var(--ha-border-radius-lg, 12px);
        background: var(--ha-color-fill-neutral-quiet-resting, rgba(127, 127, 127, 0.12));
      }
      .tablist { display: flex; gap: var(--ha-space-1, 4px); }
      .tabs .pill {
        --segment-width: calc((100% - (var(--tab-count) + 1) * var(--ha-space-1, 4px)) / var(--tab-count));
        position: absolute;
        top: var(--ha-space-1, 4px);
        bottom: var(--ha-space-1, 4px);
        inset-inline-start: calc(var(--ha-space-1, 4px) + var(--tab-index) * (var(--segment-width) + var(--ha-space-1, 4px)));
        width: var(--segment-width);
        border-radius: calc(var(--ha-border-radius-lg, 12px) - var(--ha-space-1, 4px));
        background: var(--card-background-color, #fff);
        box-shadow: var(--ha-box-shadow-s, 0 1px 3px rgba(0, 0, 0, 0.2));
        transition: inset-inline-start 200ms ease;
      }
      .tabs button {
        position: relative;
        flex: 1;
        border: none;
        margin: 0;
        padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
        border-radius: calc(var(--ha-border-radius-lg, 12px) - var(--ha-space-1, 4px));
        background: none;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        color: var(--secondary-text-color, #727272);
        transition: color 180ms ease-in-out;
      }
      .tabs button[aria-selected="true"] { color: var(--primary-text-color, #212121); }
      .tabs button:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -2px; }
      @media (prefers-reduced-motion: reduce) { .tabs .pill { transition: none; } }
      .list { flex: 1; min-height: 0; display: flex; flex-direction: column; }
      .rows {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        margin-top: var(--ha-space-2, 8px);
        display: flex;
        flex-direction: column;
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--ha-space-3, 12px);
        width: 100%;
        padding: var(--ha-space-2, 8px);
        border: none;
        border-radius: var(--ha-border-radius-lg, 12px);
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .row:hover, .row:focus-visible { background: var(--ha-color-fill-neutral-quiet-resting, rgba(127, 127, 127, 0.12)); outline: none; }
      .row.no-location { color: var(--secondary-text-color, #727272); }
      .row-text, .detail-title, .entry-text { display: flex; flex-direction: column; min-width: 0; }
      .headline, .entry-headline {
        font-size: var(--ha-font-size-m, 14px);
        font-weight: var(--ha-font-weight-medium, 500);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .supporting, .entry-when, .detail-state {
        color: var(--secondary-text-color, #727272);
        font-size: var(--ha-font-size-s, 12px);
      }
      .avatar {
        position: relative;
        flex: none;
        width: var(--avatar-size);
        height: var(--avatar-size);
        border-radius: var(--ha-border-radius-lg, 12px);
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--ha-color-fill-neutral-quiet-resting, rgba(127, 127, 127, 0.12));
        color: var(--secondary-text-color, #727272);
        font-weight: var(--ha-font-weight-medium, 500);
        box-sizing: border-box;
        overflow: hidden;
      }
      .avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
      .avatar.zone { color: #fff; }
      .detail-header {
        flex: none;
        display: flex;
        align-items: center;
        gap: var(--ha-space-1, 4px);
        padding: var(--ha-space-1, 4px) var(--ha-space-3, 12px);
        border-radius: var(--ha-border-radius-lg, 12px);
        background: var(--ha-color-fill-neutral-quiet-resting, rgba(127, 127, 127, 0.12));
      }
      .detail-title { flex: 1; }
      .detail-name { font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-medium, 500); outline: none; }
      .activity {
        margin-top: var(--ha-space-2, 8px);
        padding: var(--ha-space-3, 12px);
        border-radius: var(--ha-border-radius-lg, 12px);
        background: var(--ha-color-fill-neutral-quiet-resting, rgba(127, 127, 127, 0.12));
        min-height: 0;
        overflow-y: auto;
      }
      .activity .avatar { background: var(--card-background-color, #fff); }
      .activity-header { display: flex; align-items: center; gap: var(--ha-space-3, 12px); }
      .activity-icon {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--avatar-size);
        height: var(--avatar-size);
        border-radius: var(--ha-border-radius-lg, 12px);
        background: var(--card-background-color, #fff);
        color: var(--primary-color, #03a9f4);
      }
      .activity-title { font-weight: var(--ha-font-weight-medium, 500); }
      .activity-loading { display: flex; justify-content: center; padding: var(--ha-space-3, 12px); }
      .spinner {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        border-top-color: var(--primary-color, #03a9f4);
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .activity-empty { color: var(--secondary-text-color, #727272); font-size: var(--ha-font-size-s, 12px); }
      .timeline { display: flex; flex-direction: column; gap: var(--ha-space-4, 16px); margin-top: var(--ha-space-3, 12px); }
      .entry { display: flex; align-items: center; gap: var(--ha-space-3, 12px); }
      .rail {
        flex: none;
        align-self: stretch;
        width: 2px;
        margin-inline: calc((var(--avatar-size) - 2px) / 2);
        border-radius: 999px;
        background: var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .show-more {
        display: block;
        width: 100%;
        margin-top: var(--ha-space-3, 12px);
        padding: var(--ha-space-2, 8px) 0 0;
        border: none;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
        background: none;
        color: var(--primary-color, #03a9f4);
        font: inherit;
        font-weight: var(--ha-font-weight-medium, 500);
        cursor: pointer;
      }
      /* The phone's bottom sheet (ha-snap-bottom-sheet's look), in the browser's top layer. */
      .sheet {
        position: fixed;
        top: auto;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
        max-width: 100%;
        height: 50vh;
        height: 50dvh;
        max-height: calc(100vh - max(var(--safe-area-inset-top, 0px), 48px));
        max-height: calc(100dvh - max(var(--safe-area-inset-top, 0px), 48px));
        margin: 0;
        padding: 0;
        border: none;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        overflow: visible;
        pointer-events: auto;
        color: var(--primary-text-color, #212121);
        background: var(--card-background-color, #fff);
        border-top-left-radius: var(--ha-border-radius-2xl, 24px);
        border-top-right-radius: var(--ha-border-radius-2xl, 24px);
        box-shadow: 0px -8px 16px rgba(0, 0, 0, 0.2);
        transition: height var(--ha-animation-duration-normal, 250ms) ease;
        z-index: 7;
      }
      .sheet.full {
        height: calc(100vh - max(var(--safe-area-inset-top, 0px), 48px));
        height: calc(100dvh - max(var(--safe-area-inset-top, 0px), 48px));
      }
      .sheet.dragging { transition: none; }
      .sheet .panel {
        flex: 1;
        min-height: 0;
        background: none;
        box-shadow: none;
        border-radius: 0;
        padding: 28px max(12px, var(--safe-area-inset-right, 0px)) max(12px, var(--safe-area-inset-bottom, 0px)) max(12px, var(--safe-area-inset-left, 0px));
      }
      .handle-wrapper {
        position: absolute;
        top: 0;
        width: 100%;
        padding-bottom: 2px;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: grab;
        touch-action: none;
      }
      .handle {
        height: 20px;
        width: 200px;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 7;
        padding-bottom: 8px;
      }
      .handle::after {
        content: "";
        border-radius: 8px;
        height: 4px;
        width: 40px;
        background: var(--divider-color, rgba(0, 0, 0, 0.12));
      }
      .backdrop {
        position: fixed;
        inset: 0;
        width: auto;
        height: auto;
        margin: 0;
        padding: 0;
        border: none;
        background: var(--ha-bottom-sheet-scrim-color, transparent);
        pointer-events: none;
        transition: opacity var(--ha-animation-duration-normal, 250ms) ease;
      }
      .backdrop.active { pointer-events: auto; }
      .backdrop.dragging { transition: none; }
    `;
  }
}

try {
  if (globalThis.customElements && !globalThis.customElements.get(OVERVIEW_TAG)) {
    globalThis.customElements.define(OVERVIEW_TAG, LtmcMapOverview);
  }
} catch { /* tests replace LitElement with a plain class; the page defines it */ }
