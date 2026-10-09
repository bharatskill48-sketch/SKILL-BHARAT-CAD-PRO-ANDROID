import { describe, expect, it } from "vitest";
import { fitPaddingForViewport } from "./viewerLayout";

describe("drawing fit around viewer overlays", () => {
  it("keeps centered bounds clear of the header and toolbar on a phone", () => {
    const height = 800;
    const padding = fitPaddingForViewport(height);
    const drawingHeight = height / (1 + padding);
    expect((height - drawingHeight) / 2).toBeGreaterThanOrEqual(80);
  });

  it("reserves more room on a short landscape viewport and for safe-area insets", () => {
    expect(fitPaddingForViewport(360)).toBeCloseTo(0.8);
    const padding = fitPaddingForViewport(800, 110);
    expect((800 - 800 / (1 + padding)) / 2).toBeCloseTo(110);
  });

  it("retains the original minimum margin on large displays and handles zero-height resize", () => {
    expect(fitPaddingForViewport(2000)).toBe(0.12);
    expect(fitPaddingForViewport(0)).toBe(0.12);
    expect(Number.isFinite(fitPaddingForViewport(100))).toBe(true);
  });
});
