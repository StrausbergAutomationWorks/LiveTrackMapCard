import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import HaStaleStateService from './HaStaleStateService.js';

jest.mock('../util/Logger.js');

// After a websocket reconnect the frontend MERGES Home Assistant's fresh list
// into the page's copy instead of replacing it, so an entity removed while
// the page was not listening stays in hass.states for good. The service asks
// Home Assistant for its own list and records the difference.

const T = (s) => `2026-09-21T06:00:${String(s).padStart(2, '0')}.000Z`;
// get_states answers in Home Assistant's own format, not the page's.
const server = (id, s) => ({ entity_id: id, last_updated: `2026-09-21T06:00:${String(s).padStart(2, '0')}.000000+00:00` });

let hass, answer, listeners, onChange, svc;

/**
 * A stub websocket connection answering get_states with nswer.
 * @returns {object}
 */
function connection() {
  return {
    sendMessagePromise: jest.fn(async (msg) => {
      expect(msg).toEqual({ type: 'get_states' });
      if (answer instanceof Error) throw answer;
      return answer;
    }),
    addEventListener: jest.fn((type, cb) => { (listeners[type] ??= []).push(cb); }),
    removeEventListener: jest.fn((type, cb) => { listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb); }),
  };
}

beforeEach(() => {
  listeners = {};
  hass = {
    connection: connection(),
    states: {
      'geo_location.live': { last_updated: T(10) },
      'geo_location.ghost': { last_updated: T(5) },
    },
  };
  answer = [server('geo_location.live', 10)];
  onChange = jest.fn();
  svc = new HaStaleStateService(() => hass, onChange);
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('HaStaleStateService', () => {
  it('records an entity the page holds and Home Assistant does not', async () => {
    svc.start();
    await flush();
    expect(svc.isStale('geo_location.ghost')).toBe(true);
    expect(svc.isStale('geo_location.live')).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('checks again on every reconnect', async () => {
    answer = [server('geo_location.live', 10), server('geo_location.ghost', 5)];
    svc.start();
    await flush();
    expect(svc.isStale('geo_location.ghost')).toBe(false);
    answer = [server('geo_location.live', 10)];
    listeners.ready.forEach((cb) => cb());
    await flush();
    expect(svc.isStale('geo_location.ghost')).toBe(true);
  });

  it('releases an entity once its state changes - it came back', async () => {
    svc.start();
    await flush();
    hass = { ...hass, states: { ...hass.states, 'geo_location.ghost': { last_updated: T(20) } } };
    expect(svc.isStale('geo_location.ghost')).toBe(false);
    expect(svc.size).toBe(0);
  });

  it('releases an entity the page has dropped itself', async () => {
    svc.start();
    await flush();
    delete hass.states['geo_location.ghost'];
    expect(svc.isStale('geo_location.ghost')).toBe(false);
  });

  it('releases an entity Home Assistant lists again at the next check', async () => {
    svc.start();
    await flush();
    answer = [server('geo_location.live', 10), server('geo_location.ghost', 5)];
    listeners.ready.forEach((cb) => cb());
    await flush();
    expect(svc.isStale('geo_location.ghost')).toBe(false);
  });

  it('does not record an entity newer than the snapshot - it arrived after', async () => {
    hass.states['geo_location.new'] = { last_updated: T(30) };
    svc.start();
    await flush();
    expect(svc.isStale('geo_location.new')).toBe(false);
    expect(svc.isStale('geo_location.ghost')).toBe(true);
  });

  it('keeps the record as it was when get_states fails', async () => {
    svc.start();
    await flush();
    answer = new Error('socket closed');
    listeners.ready.forEach((cb) => cb());
    await flush();
    expect(svc.isStale('geo_location.ghost')).toBe(true);
  });

  it('does not call onChange when nothing changed', async () => {
    svc.start();
    await flush();
    listeners.ready.forEach((cb) => cb());
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stops listening, and ignores an answer that lands after stop()', async () => {
    svc.start();
    svc.stop();
    await flush();
    expect(svc.size).toBe(0);
    expect(listeners.ready).toEqual([]);
  });

  it('listens once per connection', () => {
    svc.start();
    svc.start();
    expect(hass.connection.addEventListener).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a connection', () => {
    hass = { states: {} };
    expect(() => svc.start()).not.toThrow();
    expect(svc.isStale('geo_location.ghost')).toBe(false);
  });
});
