import { describe, expect, it } from "vitest";
import { filterAndSortEntries } from "./libraryPresentation";
import type { LibraryEntry } from "../library/drawingLibrary";

const drawing = (id: string, name: string, size = 1, updatedAt = 1): LibraryEntry => ({
  id, name, size, updatedAt, kind: "drawing", parentId: "root", format: "dxf",
  mimeType: "application/dxf", lastModified: 1, lastOpenedAt: 1, createdAt: 1,
});

describe("library search and sorting", () => {
  it("searches Turkish and canonically equivalent Unicode names", () => {
    const entries = [drawing("1", "İZMİR.dxf"), drawing("2", "Café.dxf")];
    expect(filterAndSortEntries(entries, "izmir", "name", "tr").map((e) => e.id)).toEqual(["1"]);
    expect(filterAndSortEntries(entries, "Cafe\u0301", "name", "en").map((e) => e.id)).toEqual(["2"]);
  });
  it("keeps folders first and sorts names numerically without mutating input", () => {
    const entries: LibraryEntry[] = [drawing("10", "Plan10.dxf"), drawing("2", "Plan2.dxf"), {
      id: "folder", name: "Z", kind: "folder", parentId: "root", createdAt: 1, updatedAt: 1,
    }];
    expect(filterAndSortEntries(entries, "", "name", "tr").map((e) => e.id)).toEqual(["folder", "2", "10"]);
    expect(entries.map((e) => e.id)).toEqual(["10", "2", "folder"]);
  });
  it("sorts by size and modification date, and trims the search", () => {
    const entries = [drawing("a", "A.dxf", 10, 3), drawing("b", "B.dxf", 30, 1)];
    expect(filterAndSortEntries(entries, "", "size", "en")[0].id).toBe("b");
    expect(filterAndSortEntries(entries, "", "recent", "en")[0].id).toBe("a");
    expect(filterAndSortEntries(entries, "  b.dxf  ", "name", "en").map((e) => e.id)).toEqual(["b"]);
  });
});
