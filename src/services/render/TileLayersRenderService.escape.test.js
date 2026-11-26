import { describe, expect, it, jest } from "@jest/globals";
import TileLayersRenderService, { OVERLAY_STORAGE_PREFIX } from "./TileLayersRenderService";

// LiveTrackMapCard#1 (backlog 368), finding 2: Leaflet's layers control writes a label with innerHTML, and a
// publisher names its own layer. The label is escaped; the viewer's stored choice stays keyed by the name.
const HOSTILE = '<img src=x onerror=alert(1)>"&\'';

/**
 * @param {{[key: string]: string}} [stored] the viewer's stored choices
 * @returns {TileLayersRenderService} with a stand-in control and storage
 */
function service(stored = {}) {
  const svc = new TileLayersRenderService();
  svc.controlled = true;
  svc.map = {};
  svc.control = { addOverlay: jest.fn() };
  svc.byLayer = new Map();
  svc.storage = { getItem: jest.fn((k) => stored[k] ?? null), setItem: jest.fn() };
  return svc;
}

describe("addOverlay escapes the checkbox label", () => {
  it("the control gets the escaped label", () => {
    const svc = service();
    const layer = { addTo: jest.fn() };
    svc.addOverlay(layer, HOSTILE, true);
    expect(svc.control.addOverlay).toHaveBeenCalledWith(layer, "&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;");
  });
  it("the stored choice is read and kept under the name itself", () => {
    const svc = service({ [OVERLAY_STORAGE_PREFIX + HOSTILE]: "0" });
    const layer = { addTo: jest.fn() };
    expect(svc.addOverlay(layer, HOSTILE, true)).toBe(false);
    expect(layer.addTo).not.toHaveBeenCalled();
    expect(svc.byLayer.get(layer)).toBe(HOSTILE);
  });
  it("a plain label is unchanged", () => {
    const svc = service();
    const layer = { addTo: jest.fn() };
    svc.addOverlay(layer, "Weather radar", true);
    expect(svc.control.addOverlay).toHaveBeenCalledWith(layer, "Weather radar");
  });
});
