import Logger from "../util/Logger";

/**
 * Finds entities the page still holds that Home Assistant no longer has.
 *
 * The frontend keeps one copy of every entity's state for the whole page.
 * After its websocket reconnects - a tab resumed from "Suspend when hidden",
 * a network drop, a Home Assistant restart - the fresh list it receives is
 * MERGED into that copy instead of replacing it. An entity removed while the
 * page was not listening is never deleted from it, so its marker stays where
 * it was last seen, and auto-entities, which filters the same copy, keeps
 * handing it to the card. Measured 2026-09-21 on railair-map: 54 aircraft,
 * 29 vessels and 1 Brightline train, all gone from Home Assistant, frozen on
 * a page loaded four hours earlier.
 *
 * So on every reconnect, and once when the card is built, this asks Home
 * Assistant for its own list (get_states) and records every entity the page
 * holds that the list lacks. The page's copy cannot be corrected from a card;
 * the record only lets the card stop drawing those entities.
 *
 * An entry is released as soon as the page's copy of that entity changes
 * (a new last_updated): the entity came back, or the page caught up. An
 * entity that appeared after the snapshot was taken is not recorded - its
 * last_updated is newer than anything in the snapshot.
 */
export default class HaStaleStateService {

  /** @type {Map<string, string>} entity_id -> page's last_updated when recorded */
  _stale = new globalThis.Map();
  /** @type {object|null} the connection listened to */
  _connection = null;
  /** @type {Function|null} */
  _onReady = null;
  /** @type {number} bumped per check, so an older answer never overwrites a newer one */
  _generation = 0;

  /**
   * @param {() => object} getHass the card's current hass
   * @param {() => void} [onChange] called when the recorded set changes
   */
  constructor(getHass, onChange = () => {}) {
    this._getHass = getHass;
    this._onChange = onChange;
  }

  /** Listen for reconnects on the current connection and check once now. */
  start() {
    const connection = this._getHass()?.connection;
    if (!connection?.addEventListener) return;
    if (connection === this._connection) return;
    this.stop();
    this._connection = connection;
    this._onReady = () => { this.check(); };
    connection.addEventListener("ready", this._onReady);
    this.check();
  }

  stop() {
    if (this._connection && this._onReady) {
      this._connection.removeEventListener?.("ready", this._onReady);
    }
    this._connection = null;
    this._onReady = null;
    this._generation++;
  }

  /**
   * Compare the page's copy with Home Assistant's list and record the
   * difference. Never throws; a failed request leaves the record as it was.
   * @returns {Promise<void>}
   */
  async check() {
    const connection = this._connection;
    if (!connection) return;
    const generation = ++this._generation;
    let serverStates;
    try {
      serverStates = await connection.sendMessagePromise({ type: "get_states" });
    } catch (e) {
      Logger.warn("[HaStaleStateService] get_states failed; stale check skipped", e);
      return;
    }
    if (generation !== this._generation || !Array.isArray(serverStates)) return;
    const pageStates = this._getHass()?.states;
    if (!pageStates) return;

    const onServer = new Set();
    let newest = -Infinity;
    for (const s of serverStates) {
      onServer.add(s.entity_id);
      const t = Date.parse(s.last_updated);
      if (t > newest) newest = t;
    }

    let changed = false;
    for (const id of [...this._stale.keys()]) {
      if (onServer.has(id) || !pageStates[id]) {
        this._stale.delete(id);
        changed = true;
      }
    }
    for (const [id, s] of Object.entries(pageStates)) {
      if (onServer.has(id)) continue;
      // Newer than the snapshot: it arrived after get_states was answered.
      // The server's own newest timestamp is the clock, so browser/server
      // clock skew cannot misfile it.
      if (Date.parse(s.last_updated) > newest) continue;
      if (this._stale.get(id) !== s.last_updated) {
        this._stale.set(id, s.last_updated);
        changed = true;
      }
    }
    if (changed) {
      Logger.debug(`[HaStaleStateService] ${this._stale.size} entities held by the page are gone from Home Assistant`);
      this._onChange();
    }
  }

  /**
   * Is the page's copy of this entity one Home Assistant no longer has?
   * @param {string} id
   * @returns {boolean}
   */
  isStale(id) {
    const recorded = this._stale.get(id);
    if (recorded === undefined) return false;
    const current = this._getHass()?.states?.[id];
    if (!current || current.last_updated !== recorded) {
      this._stale.delete(id);
      return false;
    }
    return true;
  }

  /** @returns {number} how many entities are recorded */
  get size() {
    return this._stale.size;
  }
}
