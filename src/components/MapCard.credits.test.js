import { jest, describe, beforeEach, it, expect } from '@jest/globals';

const mockSetup = jest.fn(() => true);
const mockDispose = jest.fn();
jest.mock('../util/CreditsToggle.js', () => ({
  parseCreditsCollapse: (v) => v !== false,
  CreditsToggle: jest.fn().mockImplementation(() => ({ setup: mockSetup, dispose: mockDispose })),
}));
jest.mock('lit', () => ({
  LitElement: class LitElement {
    static get properties() { return {}; }
    static get styles() { return ''; }
    requestUpdate() {}
    connectedCallback() {}
    disconnectedCallback() {}
  },
  html: (strings) => strings.join(''),
  css: (strings) => strings.join('')
}));
jest.mock('../util/Logger.js');

import MapCard from './MapCard.js';
import MapConfig from '../configs/MapConfig.js';
import { CreditsToggle } from '../util/CreditsToggle.js';

// The collapsible credits box (Lee, 2026-11-19): on unless the dashboard says
// `attribution_collapse: false`, and never able to stop the map.
describe('MapCard and the credits box', () => {
  let card;
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetup.mockImplementation(() => true);
    card = new MapCard();
    card.map = { remove: jest.fn() };
  });

  it('the config turns it on unless attribution_collapse is false', () => {
    expect(new MapConfig({ x: 41.9, y: -88 }).creditsCollapse).toBe(true);
    expect(new MapConfig({ x: 41.9, y: -88, attribution_collapse: true }).creditsCollapse).toBe(true);
    expect(new MapConfig({ x: 41.9, y: -88, attribution_collapse: false }).creditsCollapse).toBe(false);
  });

  it('sets it up on the map by default', () => {
    card._config = { creditsCollapse: true };
    card._setupCreditsToggle();
    expect(CreditsToggle).toHaveBeenCalledWith(card.map);
    expect(mockSetup).toHaveBeenCalledTimes(1);
    expect(card.creditsToggle).toBeDefined();
  });

  it('leaves the box alone with attribution_collapse: false', () => {
    card._config = { creditsCollapse: false };
    card._setupCreditsToggle();
    expect(CreditsToggle).not.toHaveBeenCalled();
    expect(card.creditsToggle).toBeUndefined();
  });

  it('keeps nothing when the map has no credits box', () => {
    mockSetup.mockImplementation(() => false);
    card._config = { creditsCollapse: true };
    card._setupCreditsToggle();
    expect(card.creditsToggle).toBeUndefined();
  });

  it('a failure never stops the map', () => {
    mockSetup.mockImplementation(() => { throw new Error('boom'); });
    card._config = { creditsCollapse: true };
    expect(() => card._setupCreditsToggle()).not.toThrow();
    expect(card.creditsToggle).toBeUndefined();
  });

  it('teardown disposes of it', () => {
    card._config = { creditsCollapse: true };
    card._setupCreditsToggle();
    card._teardown();
    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(card.creditsToggle).toBeUndefined();
  });
});
