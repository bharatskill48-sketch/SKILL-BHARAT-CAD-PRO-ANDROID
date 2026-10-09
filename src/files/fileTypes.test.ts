import { describe, expect, it } from "vitest";
import {
  detectDrawingFormat,
  getFileExtension,
  MAX_DRAWING_FILE_BYTES,
  replaceExtension,
  toDrawingFile,
  validateDrawingFileSize,
} from "./fileTypes";

describe("drawing file types", () => {
  it("detects supported extensions without case sensitivity", () => {
    expect(detectDrawingFormat("floor-plan.DXF")).toBe("dxf");
    expect(detectDrawingFormat("model.DwG")).toBe("dwg");
  });

  it("rejects missing and unsupported extensions", () => {
    expect(detectDrawingFormat("drawing")).toBeNull();
    expect(detectDrawingFormat("drawing.pdf")).toBeNull();
  });

  it("replaces only the final extension", () => {
    expect(replaceExtension("building.v2.dwg", "dxf")).toBe(
      "building.v2.dxf",
    );
  });

  it("returns an empty extension for malformed names", () => {
    expect(getFileExtension("drawing.")).toBe("");
  });

  it("handles surrounding provider whitespace without accepting paths", () => {
    expect(detectDrawingFormat("  drawing.DWG  ")).toBe("dwg");
    expect(() => toDrawingFile(new File(["cad"], "folder/drawing.dxf")))
      .toThrow("UNSUPPORTED_FORMAT");
  });

  it("rejects empty drawings before parsing or saving them", () => {
    expect(() => toDrawingFile(new File([], "empty.dxf"))).toThrow("EMPTY_FILE");
  });

  it("enforces the memory guard on both selected and shared drawings", () => {
    expect(() => validateDrawingFileSize(MAX_DRAWING_FILE_BYTES)).not.toThrow();
    expect(() => validateDrawingFileSize(MAX_DRAWING_FILE_BYTES + 1)).toThrow("FILE_TOO_LARGE");
    expect(() => validateDrawingFileSize(Number.NaN)).toThrow("FILE_READ_FAILED");
    expect(() => validateDrawingFileSize(-1)).toThrow("FILE_READ_FAILED");
  });
});

