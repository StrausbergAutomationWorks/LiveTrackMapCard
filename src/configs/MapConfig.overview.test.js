import { jest, describe, it, expect } from '@jest/globals';
import MapConfig from './MapConfig.js';

jest.mock('leaflet');
jest.mock('../util/Logger.js');

// Step 2 (Lee 2026-11-19): `overview` unset follows the panel view, as Home Assistant's map card;
// true or false forces it; anything else counts as unset.
describe('overview option (MapConfig)', () => {
  it('unset, true, false; anything else is unset', () => {
    expect(new MapConfig({ x: 41, y: -87 }).overview).toBeUndefined();
    expect(new MapConfig({ x: 41, y: -87, overview: true }).overview).toBe(true);
    expect(new MapConfig({ x: 41, y: -87, overview: false }).overview).toBe(false);
    expect(new MapConfig({ x: 41, y: -87, overview: 'yes' }).overview).toBeUndefined();
    expect(new MapConfig({ x: 41, y: -87, overview: 0 }).overview).toBeUndefined();
  });
});
