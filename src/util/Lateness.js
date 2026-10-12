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
 * Late from here, when the train does not say: Metra's published on-time
 * standard is "within 5:59 of schedule" (South Shore's is the same). The
 * emitter truncates, so `>= 6` is exactly that. Do not round again.
 */
export const LATE_MIN = 6;

/** Red from here, when the train does not say (Lee, 2026-10-04 03:31). */
export const VERY_LATE_MIN = 15;

/**
 * The thresholds a train's own railroad uses (06_MAP_CONTRACT.md D4c, Lee
 * 2026-10-09: "Change lateness based on how each system defines late").
 * `late_threshold_min` and `very_late_threshold_min` are JSON integers from
 * 1 to 1440; anything else, or a very-late below the late, is ignored and the
 * defaults above apply. Amtrak's on-time rule is 15 minutes (49 CFR 273.5),
 * so an Amtrak train says 16.
 * @param {object} [attributes]
 * @returns {{late: number, veryLate: number}}
 */
export function thresholds(attributes) {
  const ok = (v) => Number.isInteger(v) && v >= 1 && v <= 1440;
  const late = ok(attributes?.late_threshold_min) ? attributes.late_threshold_min : LATE_MIN;
  const vl = attributes?.very_late_threshold_min;
  const veryLate = ok(vl) && vl >= late ? vl : Math.max(VERY_LATE_MIN, late);
  return { late, veryLate };
}

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
  // D4c-status (Lee 2026-10-11 20:23): a word the emitter sends in the
  // badge's place while the train is held for something that is not
  // lateness (a customs stop). It wins over delay_min and never pulses.
  const status = parseMarkerStatus(attributes?.marker_status);
  if (status !== null) return { "delay-badge": status, "delay-level": "status", "pulse": "" };
  const d = attributes?.delay_min;
  const { late, veryLate } = thresholds(attributes);
  if (!Number.isInteger(d) || d < late) return { ...NO_LATENESS };
  return {
    "delay-badge": `+${d}`,
    "delay-level": d >= veryLate ? "red" : "amber",
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
  if (level === "status") return STATUS_COLOR;
  return "";
}

/** The colour of a `marker_status` word: white, with the badge's dark outline. */
export const STATUS_COLOR = "#FFFFFF";

/** The longest `marker_status` drawn; a longer one is ignored. */
export const STATUS_MAX = 10;

/**
 * An emitted `marker_status` (06_MAP_CONTRACT.md D4c-status): a string of 1
 * to STATUS_MAX characters after trimming, else null.
 * @param {unknown} value
 * @returns {string|null}
 */
export function parseMarkerStatus(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text !== "" && text.length <= STATUS_MAX ? text : null;
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
    font-size: 1.25em;
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
