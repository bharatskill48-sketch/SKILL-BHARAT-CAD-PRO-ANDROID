import { describe, expect, it } from "vitest";
import {
  createUniqueEntryName,
  isValidEntryName,
  normalizeEntryName,
} from "./drawingLibrary";

describe("drawing library names", () => {
  it("normalizes surrounding and repeated whitespace", () => {
    expect(normalizeEntryName("  Project   Plans  ")).toBe("Project Plans");
  });

  it("rejects empty, path-like, and control-character names", () => {
    expect(isValidEntryName(" ")).toBe(false);
    expect(isValidEntryName("..")).toBe(false);
    expect(isValidEntryName("floor/plan")).toBe(false);
    expect(isValidEntryName("floor\u0000plan")).toBe(false);
    expect(isValidEntryName("floor\nplan")).toBe(false);
  });

  it("keeps drawing extensions when making a unique name", () => {
    expect(
      createUniqueEntryName("floor.dwg", ["FLOOR.DWG", "floor (2).dwg"]),
    ).toBe("floor (3).dwg");
  });

  it("creates unique folder names without treating dots as extensions", () => {
    expect(createUniqueEntryName("Project", ["project"])).toBe("Project (2)");
  });

  it("keeps automatically suffixed filenames valid at the name limit", () => {
    const name = `${"a".repeat(216)}.dxf`;
    const unique = createUniqueEntryName(name, [name]);
    expect(isValidEntryName(unique)).toBe(true);
    expect(unique.endsWith(" (2).dxf")).toBe(true);
  });

  it("treats canonically equivalent Unicode names as duplicates", () => {
    expect(createUniqueEntryName("Café.dxf", ["Cafe\u0301.dxf"]))
      .toBe("Café (2).dxf");
  });

  it("appends copy suffixes after dotted folder names", () => {
    expect(createUniqueEntryName("Project.v2", ["Project.v2"], false))
      .toBe("Project.v2 (2)");
  });
});
