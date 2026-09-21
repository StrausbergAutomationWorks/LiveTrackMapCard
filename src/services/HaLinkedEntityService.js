import Logger from "../util/Logger.js"

/**
 * Linked entity service
 */
export default class HaLinkedEntityService {  

  hass;
  connections = {};
  listeners = {};
  
  constructor(hass, entity, suffix = 'hours ago') {
    // Store ref to HASS
    this.hass = hass;
    suffix;
  }

  /**
   * The state string a subscribe_entities message carries for one entity, or
   * null. The entity can be absent from an `a` snapshot (not loaded yet, e.g.
   * during Home Assistant startup) and a `c` change can carry no `+` part or
   * no `s` in it (an attribute-only change), so nothing here is assumed.
   * @param {any} message
   * @param {string} entity
   * @returns {string|null}
   */
  static stateFrom(message, entity) {
    let state = null;
    const added = message?.a?.[entity];
    if (added && added.s !== undefined) state = added.s; // new?
    const changed = message?.c?.[entity]?.['+'];
    if (changed && changed.s !== undefined) state = changed.s; // change?
    return state;
  }

  // Don't wait, we'll fire events when ready
  async setUpConnection(entity)
  {
    // Skip if already connected
    if (this.connections[entity]) return;

    // Setup listeners array for entity before subscribing
    if(!this.listeners[entity]) this.listeners[entity] = [];

    Logger.debug(`[HaLinkedEntityService] initializing connection for ${entity}`);
    const connection  = this.hass.connection.subscribeMessage(
        // This callback runs inside the websocket library's loop over one
        // frame of messages, which has no try/catch: a throw here abandons
        // every later message in that frame, other subscribers' events and
        // command results included. It must never throw.
        (message) => {
          try {
            let state = HaLinkedEntityService.stateFrom(message, entity);

            if(state) {
              // If state is a number, attempt to parse as int, otherwise assume is and pass thru direct
              state = isNaN(state) ? state : parseInt(state);

              Logger.debug(`[HaLinkedEntityService] ${entity} state updated to ${state}`);

              // Hit callback for all listeners listing to entities changes
              if (this.listeners[entity] && this.listeners[entity].length > 0) {
                this.listeners[entity].forEach(function(callback) {
                  try {
                    callback(state);
                  } catch (e) {
                    Logger.error(`[HaLinkedEntityService] listener for ${entity} threw`, e);
                  }
                });
              }
            }
          } catch (e) {
            Logger.error(`[HaLinkedEntityService] update for ${entity} could not be read`, e);
          }
        },
        {
            type: "subscribe_entities",
            entity_ids: [entity],
        }
      );
      // Track connection for entity
      this.connections[entity] = connection;
  }

  // Register listener
  onStateChange(entity, method) {
    // Setup connection if we need it.
    this.setUpConnection(entity);
    
    // Setup listeners array for entity
    if(!this.listeners[entity]) this.listeners[entity] = [];

    // Add callback
    this.listeners[entity].push(method);
  }

  disconnect() {
    this.listeners = {};
    // Unsub
    for (let [k, conn] of Object.entries(this.connections)) {
      k
      conn.then(unsub => unsub());
    }

    this.connections = {};
    Logger.debug("[HaLinkedEntityService] Disconnecting");
  }
}