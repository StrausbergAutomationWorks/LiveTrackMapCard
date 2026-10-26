import { jest, describe, it, expect } from '@jest/globals';
import { nextFrame, afterFrame } from './FrameBatch.js';

// The card's update waits for the next animation frame, so a burst of hass changes is one
// update outside Home Assistant's websocket task (card SSOT 2026-10-25).

/**
 * A requestAnimationFrame that runs its callbacks only on flush().
 * @returns {Function}
 */
function fakeRaf() {
  const pending = [];
  const raf = jest.fn((cb) => { pending.push(cb); return pending.length; });
  raf.flush = () => { while (pending.length) pending.shift()(0); };
  return raf;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('afterFrame', () => {
  it('runs nothing until the frame', async () => {
    const raf = fakeRaf();
    const update = jest.fn(() => 'u');
    const p = afterFrame(update, raf);
    await settle();
    expect(update).not.toHaveBeenCalled();
    raf.flush();
    await expect(p).resolves.toBe('u');
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('several requests before one frame each wait for that frame', async () => {
    const raf = fakeRaf();
    const update = jest.fn();
    afterFrame(update, raf); afterFrame(update, raf); afterFrame(update, raf);
    await settle();
    expect(update).not.toHaveBeenCalled();
    raf.flush();
    await settle();
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('carries the update\'s own promise', async () => {
    const raf = fakeRaf();
    const p = afterFrame(() => Promise.resolve(42), raf);
    raf.flush();
    await expect(p).resolves.toBe(42);
  });

  it('without requestAnimationFrame, runs on the next microtask', async () => {
    const update = jest.fn(() => 1);
    const p = afterFrame(update, null);
    expect(update).not.toHaveBeenCalled();
    await expect(p).resolves.toBe(1);
  });
});

describe('nextFrame', () => {
  it('asks for exactly one frame', async () => {
    const raf = fakeRaf();
    const p = nextFrame(raf);
    expect(raf).toHaveBeenCalledTimes(1);
    raf.flush();
    await expect(p).resolves.toBeUndefined();
  });
});
