/**
 * Lateness on the map: the delay badge and the stall pulse
 * (06_MAP_CONTRACT.md D4c, backlog 275; Lee, 2026-10-04).
 *
 * The emitter publishes two facts and the card draws from them alone:
 * `delay_min`, whole minutes late at the NEXT stop, truncated toward zero
 * (5:59 is 5), absent when unknown; and `stalled`, a JSON `true` or absent,
 * which is physics only and says nothing about lateness.
 *
 * Nothing is ever parsed out of `marker_label`: the badge comes from
 * `delay_min` and nothing else.
 */

/**
 * Late from here: Metra's published on-time standard is "within 5:59 of
 * schedule". The emitter truncates, so `>= 6` is exactly that. Do not round
 * again.
 */
export const LATE_MIN = 6;

/** Red from here (Lee, 2026-10-04 03:31). */
export const VERY_LATE_MIN = 15;

/** The badge and pulse colour for `delay_min` 6 to 14. */
export const LATE_COLOR = "#FFB300";

/** The badge and pulse colour for `delay_min` 15 and over. */
export const VERY_LATE_COLOR = "#FF3B30";

/**
 * The marker element's attributes when there is nothing to show: on time,
 * early, unknown, or not a train at all. The marker is then exactly what it
 * was before backlog 275.
 */
export const NO_LATENESS = Object.freeze({ "delay-badge": "", "delay-level": "", "pulse": "" });

/**
 * What the marker shows about lateness, as the marker element's attribute
 * names -> values ("" = nothing).
 *
 * - `delay_min` counts only as a JSON integer (`Number.isInteger`): a string,
 *   a float, a boolean or null is no badge. Under 6, early included, shows
 *   nothing about lateness at all (Lee: on time/late is already defined).
 * - `stalled` counts only as `=== true`, and pulses only on a late train. It
 *   is re-decided on every update, so a train that moves, or makes up time to
 *   under 6, stops pulsing.
 * @param {object} [attributes] the entity's attributes
 * @returns {{"delay-badge": string, "delay-level": string, "pulse": string}}
 */
export function lateness(attributes) {
  const d = attributes?.delay_min;
  if (!Number.isInteger(d) || d < LATE_MIN) return { ...NO_LATENESS };
  return {
    "delay-badge": `+${d}`,
    "delay-level": d >= VERY_LATE_MIN ? "red" : "amber",
    "pulse": attributes.stalled === true ? "true" : "",
  };
}

/**
 * The colour for a `delay-level`, or "" for none. Anything but the two
 * levels is none, so a stray attribute value draws nothing.
 * @param {string} [level]
 * @returns {string}
 */
export function latenessColor(level) {
  if (level === "red") return VERY_LATE_COLOR;
  if (level === "amber") return LATE_COLOR;
  return "";
}

/**
 * The pulse's CSS, kept as a string so a test can read the reduced-motion
 * rule (jest mocks lit's `css`). The ring sits outside the disc and its halo,
 * so neither the fill nor the halo changes colour (Lee); it grows and fades
 * once every 3 s. With reduced motion it holds still as a DASHED ring set
 * well clear of the disc: a solid ring close in read as a recoloured halo
 * (seen 2026-10-04, bin\ltmc275_look_rm.png).
 */
export const LATENESS_CSS = `
  .label-with-badge {
    position: relative;
    display: inline-block;
    text-align: center;
    flex-shrink: 0;
  }
  .delay-badge {
    position: absolute;
    left: 100%;
    top: 50%;
    transform: translateY(-50%);
    margin-left: 0.3em;
    font-size: 0.8em;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
  }
  .stall-pulse {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(0, 0, 0, 0.6);
    pointer-events: none;
    animation: ltmc-stall-pulse 3s ease-out infinite;
  }
  @keyframes ltmc-stall-pulse {
    0% { transform: scale(1); opacity: 1; }
    80% { transform: scale(1.8); opacity: 0; }
    100% { transform: scale(1.8); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .stall-pulse {
      animation: none;
      border-style: dashed;
      transform: scale(1.4);
      opacity: 1;
    }
  }
`;
