/**
 * Styles for people, devices and zones drawn as Home Assistant's map draws
 * them (see PresenceRules.js for the source of each value). Theme variables
 * come from Home Assistant; the fallbacks are for a page outside it.
 */
import {
  ZONE_CIRCLE_SIZE, ZONE_ICON_SIZE, MARKER_BORDER, FLOATING_TAIL_SIZE, FLOATING_TAIL_REACH,
  FLOATING_GAP, FLOATING_DOT_SIZE, CLUSTER_AVATAR_SIZE, CLUSTER_BUBBLE_GAP, CLUSTER_BUBBLE_PADDING,
  CLUSTER_MORE_WIDTH, CLUSTER_TAIL_SIZE,
} from "./PresenceRules.js";

export const PRESENCE_STYLE_ID = "ltmc-presence-style";

export const PRESENCE_CSS = `
.ltmc-zone-icon, .ltmc-pin-icon, .ltmc-cluster-icon {
  background: none;
  border: none;
}
.ltmc-zone-circle {
  width: ${ZONE_CIRCLE_SIZE}px;
  height: ${ZONE_CIRCLE_SIZE}px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--card-background-color, #fff);
  box-sizing: border-box;
  box-shadow: var(--ha-box-shadow-s, 0 1px 3px rgba(0, 0, 0, 0.24));
  overflow: hidden;
  font-family: var(--ha-font-family-body, Roboto, sans-serif);
  font-size: var(--ha-font-size-s, 12px);
  font-weight: var(--ha-font-weight-medium, 500);
  --mdc-icon-size: ${ZONE_ICON_SIZE}px;
}
.ltmc-pin {
  display: flex;
  flex-direction: column;
  align-items: center;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.12));
  pointer-events: none;
}
.ltmc-pin .ltmc-frame, .ltmc-pin .ltmc-tail {
  pointer-events: auto;
}
.ltmc-frame {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  box-sizing: border-box;
  flex: none;
  width: var(--ltmc-marker-size, 48px);
  height: var(--ltmc-marker-size, 48px);
  font-family: var(--ha-font-family-body, Roboto, sans-serif);
  font-size: var(--ltmc-marker-font-size, var(--ha-font-size-xl, 20px));
  border-radius: var(--ha-picture-border-radius, 50%);
  border: var(--ltmc-marker-border-width, ${MARKER_BORDER}px) solid var(--ltmc-marker-color, var(--card-background-color, #fff));
  color: var(--primary-text-color, #212121);
  background-color: var(--ltmc-marker-background, var(--card-background-color, #fff));
  cursor: pointer;
}
.ltmc-frame.picture {
  overflow: hidden;
}
.ltmc-picture {
  background-size: cover;
  background-position: center;
  width: 100%;
  height: 100%;
}
.ltmc-tail {
  width: ${FLOATING_TAIL_SIZE}px;
  height: ${FLOATING_TAIL_SIZE}px;
  margin-top: ${-FLOATING_TAIL_SIZE / 2}px;
  margin-bottom: ${FLOATING_TAIL_REACH - FLOATING_TAIL_SIZE / 2}px;
  border-radius: 2px;
  background: var(--card-background-color, #fff);
  transform: rotate(45deg);
}
.ltmc-dot {
  width: ${FLOATING_DOT_SIZE}px;
  height: ${FLOATING_DOT_SIZE}px;
  margin-top: ${FLOATING_GAP}px;
  border-radius: 50%;
  background: var(--card-background-color, #fff);
  visibility: hidden;
}
.ltmc-cluster {
  display: flex;
  flex-direction: column;
  align-items: center;
  isolation: isolate;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.08)) drop-shadow(0 1px 3px rgba(0, 0, 0, 0.12));
}
.dark .ltmc-cluster {
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
}
.ltmc-bubble {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  gap: ${CLUSTER_BUBBLE_GAP}px;
  padding: ${CLUSTER_BUBBLE_PADDING}px;
  box-sizing: border-box;
  background: var(--card-background-color, #fff);
  border-radius: 14px;
  cursor: pointer;
  --ltmc-marker-size: ${CLUSTER_AVATAR_SIZE}px;
  --ltmc-marker-color: transparent;
  --ltmc-marker-border-width: 1px;
  --ltmc-marker-font-size: var(--ha-font-size-s, 12px);
  --ltmc-marker-background: var(--ha-color-fill-neutral-quiet-resting, #f0f0f0);
}
.ltmc-bubble .more {
  flex: none;
  width: ${CLUSTER_MORE_WIDTH}px;
  height: ${CLUSTER_AVATAR_SIZE}px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--ha-color-fill-neutral-quiet-resting, #f0f0f0);
  color: var(--primary-text-color, #212121);
  font-family: var(--ha-font-family-body, Roboto, sans-serif);
  font-size: var(--ha-font-size-s, 12px);
  font-weight: var(--ha-font-weight-medium, 500);
}
.ltmc-bubble-tail {
  position: relative;
  z-index: -1;
  width: ${CLUSTER_TAIL_SIZE}px;
  height: ${CLUSTER_TAIL_SIZE}px;
  margin-top: ${-CLUSTER_TAIL_SIZE / 2}px;
  border-radius: 2px;
  background: var(--card-background-color, #fff);
  transform: rotate(45deg);
}
.ltmc-cluster.open .ltmc-bubble {
  cursor: default;
}
`;
