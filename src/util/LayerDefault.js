/**
 * Whether a publisher's layer checkbox starts ticked (06_MAP_CONTRACT_OVERLAYS.md D12 rule 4 and D19 rule 5, as
 * amended for Live Track Internet, backlog 363). A publisher may declare `layer_default: "off"`: its box starts
 * unticked. Anything else, or nothing, starts it ticked, as before. A dashboard's explicit `show` wins over the
 * publisher, and the viewer's own stored choice wins over both (TileLayersService.addOverlay).
 */

/** The one value that starts a publisher's box unticked. */
export const LAYER_DEFAULT_OFF = "off";

/**
 * @param {object|undefined} attributes the publisher's attributes
 * @returns {boolean} false only for `layer_default: "off"`
 */
export function publisherShownByDefault(attributes) {
  return attributes?.layer_default !== LAYER_DEFAULT_OFF;
}

/**
 * The default to hand the layer control: the dashboard's `show` when it set one, else the publisher's.
 * @param {?boolean} dashboardShow `show` from `shape_layers` / `point_layers`, or null when not set
 * @param {object|undefined} attributes the publisher's attributes
 * @returns {boolean}
 */
export function layerShown(dashboardShow, attributes) {
  return typeof dashboardShow === "boolean" ? dashboardShow : publisherShownByDefault(attributes);
}
