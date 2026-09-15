import MapCard from "./components/MapCard.js"
import MapCardEntityMarker from "./components/MapCardEntityMarker.js"
import { MARKER_TAG } from "./models/Entity.js"

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
    `%cStrausbergAutomationWorks/LiveTrackMapCard: HA_MAP_CARD_VERSION ` +
      `(derived from nathan-gs/ha-map-card 1.16.0, MIT)`,
    'color: #EBF213; font-weight: bold; background: #000000'
  )
}

// Register card so that it appears in the "Card Picker"
window.customCards.push({
    name: 'Live Track Map Card',
    description: 'Map card for the Live Track integrations. Derived from nathan-gs/ha-map-card.',
    type: 'live-track-map-card',
    preview: true,
    documentationURL: `https://github.com/StrausbergAutomationWorks/LiveTrackMapCard`,
});
