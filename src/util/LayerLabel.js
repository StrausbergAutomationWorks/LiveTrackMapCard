/**
 * The label of a publisher's checkbox in the layer control (Lee, 2026-11-19).
 *
 * A publisher (shapes D12, points D19) is a sensor, and Home Assistant builds
 * its `friendly_name` as the DEVICE name followed by the entity's own name:
 * "Live Track Weather" + "Storm reports". With a dozen of them the device
 * name repeats on every line and makes each one too long. So the label drops
 * the device name when the friendly name starts with it, as Home Assistant's
 * own frontend does for an entity with a name of its own: "Storm reports".
 * Any integration, nothing named in this file.
 *
 * - The dashboard's own `name` for the layer always wins, as before.
 * - No device, a device name the friendly name does not start with, or a
 *   friendly name that IS only the device name: the friendly name as before.
 * - No friendly name: the entity id, as before.
 *
 * `former` is the label the card used before this change (the full friendly
 * name) when it differs: a viewer's ticks are stored per label, so the
 * control reads a choice stored under the old label once and keeps it.
 * @param {object} hass Home Assistant's frontend object (states, entities, devices)
 * @param {string} id the publisher's entity id
 * @param {?string} itemName the dashboard's own `name`, if any
 * @returns {{name: string, former: (string|undefined)}}
 */
export function layerLabel(hass, id, itemName) {
  if (itemName !== null && itemName !== undefined) return { name: itemName || id, former: undefined };
  const fn = hass?.states?.[id]?.attributes?.friendly_name;
  if (typeof fn !== "string" || fn === "") return { name: id, former: undefined };
  const deviceId = hass?.entities?.[id]?.device_id;
  const device = deviceId ? hass?.devices?.[deviceId] : undefined;
  const deviceName = device?.name_by_user || device?.name;
  if (typeof deviceName === "string" && deviceName !== "" && fn.startsWith(deviceName + " ")) {
    const own = fn.slice(deviceName.length + 1).trim();
    if (own !== "") return { name: own, former: fn };
  }
  return { name: fn, former: undefined };
}
