import MapCard from "./components/MapCard.js"
import MapCardEntityMarker from "./components/MapCardEntityMarker.js"
import GroupFilterCard from "./components/GroupFilterCard.js"
import { MARKER_TAG } from "./models/Entity.js"
import { VERSION } from "./version.js"

// ⚠ The element names below are what make this card DISTINCT from
// nathan-gs/ha-map-card. The guard is upstream's and it fails SILENTLY: if
// another module has already claimed a name, the second registration simply
// does not happen - no error, no banner, and every dashboard card of that
// type renders the other implementation. Both cards can be installed at once
// only because these names differ.
if (!customElements.get("live-track-map-card")) {
  customElements.define("live-track-map-card", MapCard);
  customElements.define(MARKER_TAG, MapCardEntityMarker);
  console.info(
    `%cStrausbergAutomationWorks/LiveTrackMapCard: ${VERSION} ` +
      `(derived from nathan-gs/ha-map-card 1.16.0, MIT)`,
    'color: #EBF213; font-weight: bold; background: #000000'
  )
}
// The filter card (D4f, backlog 345): its own guard, so a page that already
// has the map card from an older bundle still gets it.
if (!customElements.get("live-track-map-filter-card")) {
  customElements.define("live-track-map-filter-card", GroupFilterCard);
}

// Register card so that it appears in the "Card Picker". Create the list
// when no card loaded before us has: pushing to an undefined list threw
// AFTER the elements were defined, so the card worked but was missing from
// the picker (backlog 214).
window.customCards = window.customCards || [];
window.customCards.push({
    name: 'Live Track Map Card',
    description: 'Map card for the Live Track integrations. Derived from nathan-gs/ha-map-card.',
    type: 'live-track-map-card',
    version: VERSION,
    preview: true,
    documentationURL: `https://github.com/StrausbergAutomationWorks/LiveTrackMapCard`,
});
window.customCards.push({
    name: 'Live Track Map Filter',
    description: 'Checkboxes that hide groups of markers (vessel types, for example) on the Live Track map, remembered per browser.',
    type: 'live-track-map-filter-card',
    version: VERSION,
    preview: false,
    documentationURL: `https://github.com/StrausbergAutomationWorks/LiveTrackMapCard#the-filter-card`,
});
