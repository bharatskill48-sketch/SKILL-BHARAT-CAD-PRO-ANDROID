import { describe, expect, it } from "vitest";
import { selectInitialDrawingBounds } from "./initialView";
import type { DrawingBounds } from "./savedView";

const sheet: DrawingBounds = { minX: 0, minY: 0, maxX: 1_000, maxY: 700 };

function sheetEntities(): DrawingBounds[] {
  return Array.from({ length: 100 }, (_, index) => ({
    minX: (index % 10) * 100,
    maxX: (index % 10 + 1) * 100,
    minY: Math.floor(index / 10) * 70,
    maxY: (Math.floor(index / 10) + 1) * 70,
  }));
}

describe("initial drawing content bounds", () => {
  it("ignores one tiny disconnected marker far beyond the main drawing", () => {
    const marker = { minX: 100_000, minY: 20, maxX: 100_001, maxY: 21 };
    expect(selectInitialDrawingBounds(
      { ...sheet, maxX: marker.maxX },
      [...sheetEntities(), marker],
    )).toEqual(sheet);
  });

  it("keeps a second sheet even when it is represented by a single block", () => {
    const remoteSheet = { minX: 100_000, minY: 0, maxX: 100_900, maxY: 700 };
    const full = { ...sheet, maxX: remoteSheet.maxX };
    expect(selectInitialDrawingBounds(full, [...sheetEntities(), remoteSheet])).toBe(full);
  });

  it("keeps similarly sized groups of separate sheets", () => {
    const entities = sheetEntities();
    const remote = entities.map((bounds) => ({
      ...bounds, minX: bounds.minX + 100_000, maxX: bounds.maxX + 100_000,
    }));
    const full = { ...sheet, maxX: 101_000 };
    expect(selectInitialDrawingBounds(full, [...entities, ...remote])).toBe(full);
  });

  it("keeps nearby content and small drawings with too little evidence", () => {
    const nearby = { minX: 2_000, minY: 0, maxX: 2_001, maxY: 1 };
    const full = { ...sheet, maxX: nearby.maxX };
    expect(selectInitialDrawingBounds(full, [...sheetEntities(), nearby])).toBe(full);
    const far = { ...nearby, minX: 100_000, maxX: 100_001 };
    const farFull = { ...sheet, maxX: far.maxX };
    expect(selectInitialDrawingBounds(farFull, [sheet, far])).toBe(farFull);
  });

  it("keeps unknown geometry from the renderer and retains local text margins", () => {
    const marker = { minX: 100_000, minY: 0, maxX: 100_001, maxY: 1 };
    const entities = [...sheetEntities(), marker];
    const unknown = { ...sheet, minY: -100_000, maxX: marker.maxX };
    expect(selectInitialDrawingBounds(unknown, entities)).toBe(unknown);
    expect(selectInitialDrawingBounds(
      { minX: -5, minY: -5, maxX: marker.maxX, maxY: 705 },
      entities,
    )).toEqual({ minX: -5, minY: -5, maxX: 1_000, maxY: 705 });
  });

  it("rejects an index that includes geometry outside the rendered bounds", () => {
    const marker = { minX: 100_000, minY: 0, maxX: 100_001, maxY: 1 };
    expect(selectInitialDrawingBounds(sheet, [...sheetEntities(), marker])).toBe(sheet);
  });

  it("can discard tiny distant markers on multiple sides within the same small budget", () => {
    const markers = [
      { minX: -100_001, minY: 0, maxX: -100_000, maxY: 1 },
      { minX: 100_000, minY: 0, maxX: 100_001, maxY: 1 },
      { minX: 0, minY: 100_000, maxX: 1, maxY: 100_001 },
    ];
    expect(selectInitialDrawingBounds(
      { minX: -100_001, minY: 0, maxX: 100_001, maxY: 100_001 },
      [...sheetEntities(), ...markers],
    )).toEqual(sheet);
  });

  it("handles empty or invalid bounds without manufacturing a view", () => {
    expect(selectInitialDrawingBounds(null, [])).toBeNull();
    expect(selectInitialDrawingBounds({ ...sheet, maxX: Infinity }, [])).toBeNull();
    expect(selectInitialDrawingBounds(sheet, [])).toBe(sheet);
  });
});
