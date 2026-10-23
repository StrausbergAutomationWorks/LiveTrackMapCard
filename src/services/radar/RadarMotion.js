/**
 * Radar motion: a 30-minute loop on request (10_SEED/06_MAP_CONTRACT_OVERLAYS.md
 * D13 "Motion", backlog 285; decided by Lee 2026-10-09 and, the one clock,
 * 2026-10-12 00:01). Pure: no Leaflet, no network.
 *
 * ONE clock for the whole map: E is the newest frame time among the sources
 * drawing on screen; the steps are E - 30 min, E - 25, ..., E, seven of them
 * five minutes apart. At each step every tile shows its own source's newest
 * frame at or before the step, never one after it; a source with no frame at
 * or before a step shows its oldest. So a 4-minute source never runs ahead of
 * its 6-minute neighbour across a seam, and the last step shows every
 * source's newest.
 */

import { computedList } from "./RadarFrames.js";

/** Steps in a loop. */
export const MOTION_STEPS = 7;

/** Between steps: five minutes of radar. */
export const MOTION_STEP_MS = 5 * 60 * 1000;

/** How long each step is shown, and how long the newest is held before the loop starts again (the card chat's choice, D13). */
export const STEP_DWELL_MS = 600;
export const NEWEST_DWELL_MS = 2000;

/**
 * The step times, oldest first, or null when no drawing source has a frame.
 * @param {Set<string>|string[]} drawing ids of the sources drawing on screen
 * @param {Map<string, {time: number}>} usable each source's newest usable frame
 * @returns {?number[]}
 */
export function loopSteps(drawing, usable) {
  let e = -Infinity;
  for (const id of drawing ?? []) {
    const t = usable.get(id)?.time;
    if (Number.isFinite(t) && t > e) e = t;
  }
  if (!Number.isFinite(e)) return null;
  const out = [];
  for (let k = MOTION_STEPS - 1; k >= 0; k--) out.push(e - k * MOTION_STEP_MS);
  return out;
}

/**
 * The frame a source shows at a step: its newest at or before the step,
 * else its oldest.
 * @param {{time: number}[]} list oldest first
 * @param {number} t the step
 * @returns {?object}
 */
export function frameAt(list, t) {
  if (!Array.isArray(list) || !list.length) return null;
  let best = null;
  for (const f of list) {
    if (f.time <= t) best = f;
    else break;
  }
  return best ?? list[0];
}

/**
 * A source's frame list for the loop: what its list answer carried; FMI and
 * DWD computed back from their newest; a relay (or anything without a list)
 * only its newest, shown at every step (D13: a relay carries only its newest).
 * @param {object} src
 * @param {object} newest its usable newest frame
 * @param {number} now epoch ms
 * @returns {object[]} oldest first
 */
export function sourceList(src, newest, now) {
  if (src?.frame === "computed5") return computedList(now).filter((f) => f.time <= newest.time);
  if (Array.isArray(newest?.list) && newest.list.length) return newest.list.filter((f) => f.time <= newest.time);
  return newest ? [newest] : [];
}

/**
 * The frames each step draws with: one Map (source id -> frame) per step,
 * for every source that is usable now. A source stale at the start of the
 * loop is simply not in `usable`, so its tiles go to the next source for the
 * WHOLE loop (D13), never part-way through.
 * @param {object[]} sources in trying order
 * @param {Map<string, object>} usable newest usable frame by id
 * @param {number[]} steps
 * @param {number} now
 * @returns {Map<string, object>[]}
 */
export function stepFrames(sources, usable, steps, now) {
  const lists = new Map();
  for (const s of sources) {
    const f = usable.get(s.id);
    if (f) lists.set(s.id, sourceList(s, f, now));
  }
  return steps.map((t) => {
    const m = new Map();
    for (const [id, list] of lists) {
      const f = frameAt(list, t);
      if (f) m.set(id, f);
    }
    return m;
  });
}

/**
 * A loop's identity: the frame each step draws with for the sources drawing
 * on screen. A new loop is built only when this changes (a new frame arrived,
 * a source dropped out), so the timer and the tiles carry on otherwise.
 * @param {Map<string, object>[]} frames per step
 * @param {Set<string>|string[]} drawing
 * @returns {string}
 */
export function loopSignature(frames, drawing) {
  const ids = [...(drawing ?? [])].sort();
  return frames.map((m) => ids.map((id) => `${id}=${m.get(id)?.key ?? ""}`).join(",")).join("|");
}

/**
 * Which step to show after `k`, and for how long `k` is shown.
 * @param {number} k
 * @returns {{next: number, dwell: number}}
 */
export function stepTiming(k) {
  const last = MOTION_STEPS - 1;
  return { next: k >= last ? 0 : k + 1, dwell: k >= last ? NEWEST_DWELL_MS : STEP_DWELL_MS };
}

/**
 * The image a tile shows at step `k`: its own when it loaded, else the
 * nearest step before it that did, counting back round the loop (D13: a
 * frame that errors holds the previous step's picture). -1: nothing loaded.
 * @param {number} k
 * @param {Array<?boolean>} loaded per step: true loaded, false failed, null pending or no plan
 * @returns {number} the step whose picture to show
 */
export function shownStep(k, loaded) {
  const n = loaded.length;
  for (let i = 0; i < n; i++) {
    const j = (((k - i) % n) + n) % n;
    if (loaded[j] === true) return j;
  }
  return -1;
}
