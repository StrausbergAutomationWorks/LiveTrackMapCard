import { describe, expect, it, jest } from "@jest/globals";

jest.mock("lit", () => ({
  LitElement: class {},
  html: () => ({}),
  css: () => "",
}));

import { shouldOverlayPictureLabel, pictureRotationStyle } from "./MapCardEntityMarker.js";

describe("shouldOverlayPictureLabel", () => {
  it("does not overlay auto-generated initials on a picture", () => {
    expect(shouldOverlayPictureLabel("", "", "")).toBe(false);
    expect(shouldOverlayPictureLabel(undefined, undefined, undefined)).toBe(false);
  });

  it("overlays an explicit label on a picture", () => {
    expect(shouldOverlayPictureLabel("", "", "Dad")).toBe(true);
  });

  it("overlays prefix or suffix on a picture", () => {
    expect(shouldOverlayPictureLabel("~", "", "")).toBe(true);
    expect(shouldOverlayPictureLabel("", "km", "")).toBe(true);
  });

  it("ignores a whitespace-only label", () => {
    expect(shouldOverlayPictureLabel("", "", "   ")).toBe(false);
  });
});

describe("pictureRotationStyle", () => {
  it("is empty when there is no rotation", () => {
    expect(pictureRotationStyle(undefined, "0")).toBe("");
    expect(pictureRotationStyle(null, "0")).toBe("");
    expect(pictureRotationStyle("", "0")).toBe("");
    expect(pictureRotationStyle("north", "0")).toBe("");
  });

  it("turns the picture by the attribute value", () => {
    expect(pictureRotationStyle("90", "0")).toBe("transform: rotate(90deg); transition: transform 0s linear;");
  });

  it("keeps an accumulated angle past 360 and below 0 as given", () => {
    expect(pictureRotationStyle("370", "1")).toContain("rotate(370deg)");
    expect(pictureRotationStyle("-10", "1")).toContain("rotate(-10deg)");
  });

  it("rotates to 0 rather than dropping the transform", () => {
    expect(pictureRotationStyle("0", "0")).toContain("rotate(0deg)");
  });

  it("uses the transition seconds, and 0 for anything unusable", () => {
    expect(pictureRotationStyle("90", "2.5")).toContain("transition: transform 2.5s linear");
    expect(pictureRotationStyle("90", "")).toContain("transition: transform 0s linear");
    expect(pictureRotationStyle("90", "fast")).toContain("transition: transform 0s linear");
    expect(pictureRotationStyle("90", "-3")).toContain("transition: transform 0s linear");
  });
});
