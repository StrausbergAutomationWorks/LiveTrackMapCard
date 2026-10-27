import { describe, it, expect } from '@jest/globals';
import { MAP_LAYER_OFFSETS } from './EntityConfig.js';

// 06_MAP_CONTRACT.md D10, `weather` added for D15: storms sit under every
// other layer, fixed objects included.
describe('map_layer weather (D10, D15)', () => {
  it('is below every other layer by a full step', () => {
    expect(MAP_LAYER_OFFSETS.weather).toBe(-10000);
    const others = Object.entries(MAP_LAYER_OFFSETS).filter(([k]) => k !== 'weather').map(([, v]) => v);
    expect(Math.min(...others) - MAP_LAYER_OFFSETS.weather).toBe(10000);
  });
});
