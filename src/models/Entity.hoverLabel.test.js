import Entity from './Entity.js';
import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { HOVER_REFRESH_MS as NEXT_STOP_REFRESH_MS } from '../util/HoverLabel.js';

jest.mock('./Circle.js');
jest.mock('./GeoJson.js');
jest.mock('../util/Logger.js');
jest.mock('../configs/EntityConfig.js');
jest.mock('./EntityHistoryManager.js');

const noop = jest.fn();
const NOW = Date.parse('2026-10-03T01:00:00+00:00');
const at = (sec) => new Date(NOW + sec * 1000).toISOString();

/**
 * A Metra train entity with optional extra attributes.
 * @param {object} extra attributes merged over the defaults
 * @param {{distanceEntity: (string|null)}} options distance tooltip entity
 * @returns {{entity: Entity, hass: object}}
 */
function makeEntity(extra = {}, { distanceEntity = null } = {}) {
  const hass = {
    states: {
      'geo_location.metra_unit_8461': {
        state: '1.0',
        attributes: {
          friendly_name: 'Metra unit 8461',
          latitude: 41.95, longitude: -87.72,
          ...extra,
        },
      },
    },
    formatEntityState: jest.fn(() => 'STATE'),
    formatEntityAttributeValue: jest.fn(() => 'ATTR'),
    hassUrl: jest.fn(u => u),
  };
  const config = {
    id: 'geo_location.metra_unit_8461', display: 'marker', attribute: 'marker_label',
    prefix: '', suffix: '', label: null, size: 24, color: 'red',
    zIndexOffset: 0, tapAction: {}, css: '', pillCalloutMinZoom: 15,
    positionUpdateThreshold: 10, circleConfig: {}, geoJsonConfig: {},
    rotationAttribute: null, rotationTransition: 0, distanceEntity,
  };
  const map = { distance: jest.fn(() => 0), getZoom: jest.fn(() => 10) };
  const entity = new Entity(config, hass, map, noop, noop, noop, false);
  return { entity, hass };
}

afterEach(() => {
  jest.useRealTimers();
});

const UPNW = 'Union Pacific Northwest';

describe('hover box on a real entity (util/HoverLabel.js)', () => {
  it('is the friendly name alone with nothing published', () => {
    const { entity } = makeEntity();
    expect(entity.tooltipHtml(NOW)).toBe('Metra unit 8461');
  });

  it('a train: line name over "<station> in <n> min", no unit number', () => {
    const { entity } = makeEntity({ line_name: UPNW, next_stop: 'Irving Park', arrival_estimated_at: at(240) });
    expect(entity.tooltipHtml(NOW)).toBe(`${UPNW}<br>Irving Park in 4 min`);
  });

  it('a train: "Arriving <station>" under a minute', () => {
    const { entity } = makeEntity({ line_name: UPNW, next_stop: 'Irving Park', arrival_estimated_at: at(10) });
    expect(entity.tooltipHtml(NOW)).toBe(`${UPNW}<br>Arriving Irving Park`);
  });

  it('a train: "Next: <station>" with no time; nothing for a time with no station', () => {
    expect(makeEntity({ line_name: UPNW, next_stop: 'Irving Park' }).entity.tooltipHtml(NOW))
      .toBe(`${UPNW}<br>Next: Irving Park`);
    expect(makeEntity({ arrival_estimated_at: at(240) }).entity.tooltipHtml(NOW)).toBe('Metra unit 8461');
  });

  it('an aircraft: callsign over "<ORIG>-<DEST> in <n> min"; "New route < 24hrs old" when implausible', () => {
    const base = { friendly_name: 'Aircraft A68336', callsign: 'DAL27', origin_icao: 'KATL',
      destination_icao: 'KORD', arrival_estimated_at: at(12 * 60) };
    expect(makeEntity(base).entity.tooltipHtml(NOW)).toBe('DAL27<br>KATL-KORD in 12 min');
    expect(makeEntity({ ...base, route_check: 'implausible', origin_name: 'X', destination_name: 'Y',
      route_source: 'saw_filed_routes' }).entity.tooltipHtml(NOW))
      .toBe('DAL27<br>New route &lt; 24hrs old');
  });

  it('a person in a zone keeps "<person> is at <place>"', () => {
    const { entity } = makeEntity();
    Object.defineProperty(entity, 'tooltip', { get: () => 'Mom is at Work' });
    expect(entity.tooltipHtml(NOW)).toBe('Mom is at Work');
  });

  it('escapes the station name and the first line: feed text never becomes HTML', () => {
    const { entity } = makeEntity({
      friendly_name: 'A & B',
      next_stop: '<img src=x onerror=alert(1)>',
      arrival_estimated_at: at(240),
    });
    const html = entity.tooltipHtml(NOW);
    expect(html).toBe('A &amp; B<br>&lt;img src=x onerror=alert(1)&gt; in 4 min');
    expect(html).not.toContain('<img');
  });

  it('is bound as a FUNCTION, so the minutes are worked out when shown', () => {
    jest.useFakeTimers({ now: NOW });
    const { entity } = makeEntity({ next_stop: 'Irving Park', arrival_estimated_at: at(240) });
    const marker = entity.createMapMarker();
    const content = marker.getTooltip()._content;
    expect(typeof content).toBe('function');
    expect(content()).toBe('Metra unit 8461<br>Irving Park in 4 min');
    jest.setSystemTime(NOW + 180 * 1000);
    expect(content()).toBe('Metra unit 8461<br>Irving Park in 1 min');
    jest.setSystemTime(NOW + 220 * 1000);
    expect(content()).toBe('Metra unit 8461<br>Arriving Irving Park');
  });

  it('follows a NEW station published after the marker was built', () => {
    const { entity, hass } = makeEntity({ next_stop: 'Irving Park', arrival_estimated_at: at(240) });
    const content = entity.createMapMarker().getTooltip()._content;
    Object.assign(hass.states['geo_location.metra_unit_8461'].attributes,
      { next_stop: 'Jefferson Park', arrival_estimated_at: new Date(Date.now() + 300 * 1000).toISOString() });
    expect(content()).toMatch(/<br>Jefferson Park in 5 min$/);
  });

  it('binds no hover label when the distance tooltip owns the marker', () => {
    const { entity } = makeEntity({}, { distanceEntity: 'sensor.d' });
    expect(entity.createMapMarker().getTooltip()).toBeUndefined();
  });
});

// A minute countdown frozen at open is wrong within a minute: while the label
// is open it is redrawn on a clock, and on every update() of the entity.
describe('an open hover label keeps counting', () => {
  /**
   * An entity whose marker is a stand-in with an open label.
   * @returns {object} the entity, hass, marker and tooltip
   */
  function liveMarker() {
    const made = makeEntity({ next_stop: 'Irving Park', arrival_estimated_at: at(240) });
    const tooltip = { update: jest.fn() };
    let open = true;
    const marker = {
      isTooltipOpen: jest.fn(() => open),
      getTooltip: jest.fn(() => tooltip),
      close() { open = false; },
    };
    made.entity.marker = marker;
    return { ...made, marker, tooltip };
  }

  it('is redrawn every NEXT_STOP_REFRESH_MS while open', () => {
    jest.useFakeTimers({ now: NOW });
    const { entity, marker, tooltip } = liveMarker();
    entity._startTooltipClock(marker);
    jest.advanceTimersByTime(NEXT_STOP_REFRESH_MS * 3);
    expect(tooltip.update).toHaveBeenCalledTimes(3);
  });

  it('stops on close', () => {
    jest.useFakeTimers({ now: NOW });
    const { entity, marker, tooltip } = liveMarker();
    entity._startTooltipClock(marker);
    jest.advanceTimersByTime(NEXT_STOP_REFRESH_MS);
    entity._stopTooltipClock();
    jest.advanceTimersByTime(NEXT_STOP_REFRESH_MS * 5);
    expect(tooltip.update).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops itself when the label is closed without telling us', () => {
    jest.useFakeTimers({ now: NOW });
    const { entity, marker, tooltip } = liveMarker();
    entity._startTooltipClock(marker);
    marker.close();
    jest.advanceTimersByTime(NEXT_STOP_REFRESH_MS * 3);
    expect(tooltip.update).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops itself when the marker is replaced', () => {
    jest.useFakeTimers({ now: NOW });
    const { entity, marker, tooltip } = liveMarker();
    entity._startTooltipClock(marker);
    entity.marker = { isTooltipOpen: () => true, getTooltip: () => ({ update: jest.fn() }) };
    jest.advanceTimersByTime(NEXT_STOP_REFRESH_MS * 2);
    expect(tooltip.update).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a second open does not start a second clock', () => {
    jest.useFakeTimers({ now: NOW });
    const { entity, marker, tooltip } = liveMarker();
    entity._startTooltipClock(marker);
    entity._startTooltipClock(marker);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(NEXT_STOP_REFRESH_MS);
    expect(tooltip.update).toHaveBeenCalledTimes(1);
  });

  it('remove() and hide() stop it', () => {
    jest.useFakeTimers({ now: NOW });
    for (const how of ['remove', 'hide']) {
      const { entity, marker } = liveMarker();
      marker.remove = jest.fn();
      entity._startTooltipClock(marker);
      entity[how]();
      expect(jest.getTimerCount()).toBe(0);
    }
  });

  it('refreshTooltip redraws an open label and leaves a closed one alone', () => {
    const { entity, marker, tooltip } = liveMarker();
    entity.refreshTooltip();
    expect(tooltip.update).toHaveBeenCalledTimes(1);
    marker.close();
    entity.refreshTooltip();
    expect(tooltip.update).toHaveBeenCalledTimes(1);
  });

  it('tooltipopen starts the clock and tooltipclose stops it, on a real marker', () => {
    jest.useFakeTimers({ now: NOW });
    const { entity } = makeEntity({ next_stop: 'Irving Park', arrival_estimated_at: at(240) });
    const marker = entity.createMapMarker();
    entity.marker = marker;
    marker.fire('tooltipopen');
    expect(jest.getTimerCount()).toBe(1);
    marker.fire('tooltipclose');
    expect(jest.getTimerCount()).toBe(0);
  });
});
