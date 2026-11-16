import { LitElement, html, css } from "lit";
import { readHidden, writeHidden, summarize, toggled, applyStartHidden, STORAGE_KEY, GROUPS_EVENT } from "../util/GroupFilter.js";

/**
 * The filter card (06_MAP_CONTRACT.md D4f, backlog 345): one checkbox per
 * marker group the integrations publish, grouped by source, with how many of
 * each are on the map now. It sits on ANOTHER view of the dashboard, not on
 * the map (Lee 2026-11-15); the map card reads the choice from this browser's
 * storage (util/GroupFilter.js, where the logic and its tests live: rendering
 * a LitElement under babel-jest fails inside lit-html, so this file is thin).
 * A hidden group with nothing on the map now stays listed, so it can be
 * shown again.
 *
 * Options:
 *   title          heading; default "Show on the map"
 *   sources        list of sources to offer; default every source that publishes groups
 *   start_hidden   ["<source>:<group>", ...] hidden in a browser that has never made a choice
 */
export default class GroupFilterCard extends LitElement {
  static get properties() {
    return { hass: { attribute: false }, _hidden: { state: true } };
  }

  constructor() {
    super();
    this._config = { title: "Show on the map" };
    this._hidden = readHidden();
    this._signature = "";
    this._onEvent = (e) => {
      if (e?.type === "storage" && e.key !== STORAGE_KEY && e.key !== null) return;
      this._hidden = readHidden();
    };
  }

  setConfig(config) {
    if (config?.sources != null && !Array.isArray(config.sources)) {
      throw new Error("sources must be a list of integration domains");
    }
    if (config?.start_hidden != null && !Array.isArray(config.start_hidden)) {
      throw new Error("start_hidden must be a list of \"<source>:<group>\"");
    }
    this._config = { title: "Show on the map", ...config };
    if (applyStartHidden(this._config.start_hidden)) this._hidden = readHidden();
  }

  static getStubConfig() {
    return { title: "Show on the map" };
  }

  getCardSize() {
    return 2 + Math.ceil(this._summary().reduce((n, s) => n + s.groups.length + 1, 0) / 2);
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("storage", this._onEvent);
    window.addEventListener(GROUPS_EVENT, this._onEvent);
    this._hidden = readHidden();
  }

  disconnectedCallback() {
    window.removeEventListener("storage", this._onEvent);
    window.removeEventListener(GROUPS_EVENT, this._onEvent);
    super.disconnectedCallback();
  }

  _summary() {
    return summarize(this.hass?.states, this._hidden, this._config.sources);
  }

  shouldUpdate(changed) {
    if (!changed.has("hass") || changed.size > 1) return true;
    // A hass change redraws only when a count, label or group changed: hass
    // changes many times a second on a busy instance.
    const sig = JSON.stringify(this._summary().map((s) => [s.source, s.groups.map((g) => [g.group, g.count, g.label])]));
    if (sig === this._signature) return false;
    this._signature = sig;
    return true;
  }

  _set(keys, hide) {
    writeHidden(toggled(this._hidden, keys, hide));
    this._hidden = readHidden();
  }

  render() {
    const sources = this._summary();
    return html`
      <ha-card header=${this._config.title}>
        <div class="body">
          ${sources.length ? sources.map((s) => html`
            <div class="source">
              <div class="head">
                <span class="name">${s.title}</span>
                <span class="all">
                  <button @click=${() => this._set(s.groups.map((g) => g.key), false)}>Show all</button>
                  <button @click=${() => this._set(s.groups.map((g) => g.key), true)}>Hide all</button>
                </span>
              </div>
              ${s.groups.map((g) => html`
                <label class="row ${this._hidden.has(g.key) ? "off" : ""}">
                  <input type="checkbox" .checked=${!this._hidden.has(g.key)}
                    @change=${(e) => this._set([g.key], !e.target.checked)}>
                  <span class="label">${g.label}</span>
                  <span class="count">${g.count}</span>
                </label>`)}
            </div>`) : html`<div class="empty">Nothing on the map names a group yet.</div>`}
          <div class="note">Remembered in this browser only.</div>
        </div>
      </ha-card>`;
  }

  static get styles() {
    return css`
      .body { padding: 0 16px 12px; }
      .source + .source { margin-top: 12px; }
      .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
      .name { font-weight: 500; }
      .all button {
        background: none; border: 1px solid var(--divider-color, #ccc); border-radius: 4px;
        color: var(--primary-text-color); font: inherit; font-size: 0.85em; padding: 2px 8px; cursor: pointer;
      }
      .row { display: flex; align-items: center; gap: 8px; padding: 3px 0; cursor: pointer; }
      .row input { width: 18px; height: 18px; margin: 0; accent-color: var(--primary-color); }
      .row .label { flex: 1; }
      .row .count { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
      .row.off .label { color: var(--secondary-text-color); }
      .empty, .note { color: var(--secondary-text-color); font-size: 0.9em; }
      .note { margin-top: 10px; }
    `;
  }
}
