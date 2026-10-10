import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { ARCHIVE_LIMITS, archiveEntry, normalizeArchivePath, validateArchiveEntries } from "./archiveRules";
import { extractZip, parseZip } from "./zipArchive";

describe("archive validation and ZIP extraction", () => {
  it("normalizes Windows separators and safe dot prefixes into relative library paths", () => {
    expect(normalizeArchivePath("./Floor 1\\plan.dwg")).toBe("Floor 1/plan.dwg");
    expect(normalizeArchivePath("folder/Cafe\u0301.pdf")).toBe("folder/Café.pdf");
  });

  it.each(["../plan.dwg", "floor/../plan.dwg", "/plan.dwg", "C:\\plan.dwg", "\\\\host\\plan.dwg", "floor/\u0000plan.dwg", "floor/ \n/plan.dwg"])
    ("rejects unsafe path %j", (path) => {
      expect(() => normalizeArchivePath(path)).toThrow("INVALID_PATH");
    });

  it("rejects duplicate names after canonical normalization and case folding", () => {
    expect(() => validateArchiveEntries([archiveEntry("Floor/plan.pdf", 10), archiveEntry("FLOOR/PLAN.PDF", 10)]))
      .toThrow("INVALID_PATH");
  });

  it("limits file count, expanded sizes and folder depth before decompression", () => {
    expect(() => validateArchiveEntries(Array.from({ length: ARCHIVE_LIMITS.entries + 1 }, (_, i) => archiveEntry(`${i}.pdf`, 1))))
      .toThrow("LIMIT_EXCEEDED");
    expect(() => validateArchiveEntries([archiveEntry("huge.pdf", ARCHIVE_LIMITS.entryBytes + 1)]))
      .toThrow("LIMIT_EXCEEDED");
    expect(() => validateArchiveEntries([archiveEntry("first.pdf", ARCHIVE_LIMITS.expandedBytes), archiveEntry("second.pdf", 1)]))
      .toThrow("LIMIT_EXCEEDED");
    expect(() => normalizeArchivePath(`${"nested/".repeat(ARCHIVE_LIMITS.depth)}plan.pdf`)).toThrow("INVALID_PATH");
  });

  it("lists every entry but imports only nonempty DWG, DXF and PDF files", () => {
    const zip = zipSync({
      "Floor 1/plan.dwg": strToU8("DWG original"),
      "Floor 1/notes.pdf": strToU8("PDF original"),
      "Floor 2/plan.dxf": strToU8("DXF original"),
      "nested.zip": strToU8("nested archive"),
      "readme.txt": strToU8("instructions"),
      "empty.pdf": new Uint8Array(),
    });
    const entries = parseZip(zip);
    expect(entries.filter((entry) => entry.supported).map((entry) => entry.path))
      .toEqual(["Floor 1/plan.dwg", "Floor 1/notes.pdf", "Floor 2/plan.dxf"]);
    for (const entry of entries.filter((item) => item.supported)) {
      expect(new TextDecoder().decode(extractZip(zip, entry))).toContain("original");
    }
  });

  it("extracts stored as well as deflated ZIP entries", () => {
    const zip = zipSync({ "plan.pdf": strToU8("stored PDF original") }, { level: 0 });
    expect(new TextDecoder().decode(extractZip(zip, parseZip(zip)[0]))).toBe("stored PDF original");
  });

  it("checks content integrity and never imports a corrupted ZIP member", () => {
    const zip = zipSync({ "plan.pdf": strToU8("PDF original") }, { level: 0 });
    const entry = parseZip(zip)[0];
    zip[30 + "plan.pdf".length] ^= 255;
    expect(() => extractZip(zip, entry)).toThrow("OPEN_FAILED");
  });

  it("rejects encrypted ZIP entries and truncated archives", () => {
    const zip = zipSync({ "plan.pdf": strToU8("PDF original") });
    const end = zip.length - 22;
    const view = new DataView(zip.buffer);
    const central = view.getUint32(end + 16, true);
    view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
    expect(() => parseZip(zip)).toThrow("ENCRYPTED");
    expect(() => parseZip(zip.subarray(0, zip.length - 5))).toThrow("OPEN_FAILED");
  });
});
