import { describe, it, expect } from '@jest/globals';
import { hoverHtml, isStorm, stormLines, stormSourceText, STORM_SOURCE_TEXT } from './HoverLabel.js';

// 06_MAP_CONTRACT_OVERLAYS.md D15: the hover for a tropical cyclone.
const vance = {
  storm_class: 'Tropical Storm', max_wind_kmh: 83.3, pressure_hpa: 999,
  course_deg: 275, speed_kmh: 8.0, storm_source: 'nhc', advisory_number: 23,
};

describe('storm hover (D15)', () => {
  it('is a storm only when it names its class', () => {
    expect(isStorm(vance)).toBe(true);
    expect(isStorm({ storm_class: '  ' })).toBe(false);
    expect(isStorm({ callsign: 'AAL1' })).toBe(false);
    expect(isStorm(undefined)).toBe(false);
  });
  it('wind in kt with km/h, then the pressure', () => {
    expect(stormLines(vance)[0]).toBe('45 kt (83 km/h), 999 hPa');
    expect(stormLines({ max_wind_kmh: 203.7 })).toEqual(['110 kt (204 km/h)']);
    expect(stormLines({ pressure_hpa: 1007 })).toEqual(['1007 hPa']);
  });
  it('movement on sixteen points', () => {
    expect(stormLines(vance)[1]).toBe('Moving W at 8 km/h');
    expect(stormLines({ course_deg: 150, speed_kmh: 11.3 })).toEqual(['Moving SSE at 11 km/h']);
    expect(stormLines({ course_deg: 359, speed_kmh: 5 })).toEqual(['Moving N at 5 km/h']);
    expect(stormLines({ course_deg: 292.5, speed_kmh: 5 })).toEqual(['Moving WNW at 5 km/h']);
    expect(stormLines({ course_deg: -90, speed_kmh: 5 })).toEqual(['Moving W at 5 km/h']);
    expect(stormLines({ course_deg: 90 })).toEqual([]);
    expect(stormLines({ course_deg: '90', speed_kmh: 5 })).toEqual([]);
  });
  it('the source, with the advisory when there is one', () => {
    expect(stormSourceText(vance)).toBe('NOAA NHC, advisory 23');
    expect(stormSourceText({ storm_source: 'jtwc_eonet' })).toBe('JTWC via NASA EONET');
    expect(stormSourceText({ storm_source: 'someone' })).toBeNull();
    expect(Object.isFrozen(STORM_SOURCE_TEXT)).toBe(true);
  });
  it('the whole box, escaped', () => {
    expect(hoverHtml(vance, 'Tropical Storm Vance', 0)).toBe(
      'Tropical Storm Vance<br>45 kt (83 km/h), 999 hPa<br>Moving W at 8 km/h'
      + '<div class="hover-source">NOAA NHC, advisory 23</div>');
    expect(hoverHtml({ storm_class: 'Typhoon' }, '<b>x</b>', 0)).toBe('&lt;b&gt;x&lt;/b&gt;');
  });
  it('a train is not a storm', () => {
    expect(hoverHtml({ line_name: 'UP-W' }, 'x', 0)).toBe('UP-W');
  });
});
