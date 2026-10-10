import { parseZip, extractZip, type ZipEntry } from "../files/zipArchive";
import { libarchiveWasm, type LibarchiveWasm } from "libarchive-wasm";
import { ARCHIVE_LIMITS, ArchiveError, type ArchiveEntry } from "../files/archiveRules";

import { rarEntries, extractRar } from "../files/rarArchive";

let bytes: Uint8Array<ArrayBuffer>;
let format: "zip" | "rar";
let entries: ArchiveEntry[] = [];
let zipEntries: ZipEntry[] = [];
let wasm: LibarchiveWasm | null = null;

self.onmessage = async ({ data }: MessageEvent<{ id: number; action: "open" | "extract"; file: File; format: "zip" | "rar"; runtimeUrl: string; paths: string[] }>) => {
  try {
    if (data.action === "open") {
      if (!data.file.size || data.file.size > ARCHIVE_LIMITS.compressedBytes) throw new ArchiveError("LIMIT_EXCEEDED");
      bytes = new Uint8Array(await data.file.arrayBuffer());
      format = data.format;
      if (format === "zip") {
        zipEntries = parseZip(bytes);
        entries = zipEntries.map(({ path, size, directory, supported, format: itemFormat }) => ({ path, size, directory, supported, format: itemFormat }));
      } else {
        // One private WASM instance per archive worker; terminate() also releases its memory.
        wasm = await libarchiveWasm({ locateFile: () => data.runtimeUrl });
        entries = rarEntries(bytes, wasm);
      }
      self.postMessage({ id: data.id, entries });
    } else {
      const paths = new Set(data.paths);
      if (!paths.size || Array.from(paths).some((path) => !entries.some((entry) => entry.path === path && entry.supported))) throw new ArchiveError("OPEN_FAILED");
      const files = format === "rar" ? extractRar(bytes, wasm!, entries, paths, (done, total) => self.postMessage({ id: data.id, progress: { done, total } })) : zipEntries.filter((entry) => paths.has(entry.path)).map((entry, index) => {
        const file = { path: entry.path, data: extractZip(bytes, entry) };
        self.postMessage({ id: data.id, progress: { done: index + 1, total: paths.size } });
        return file;
      });
      self.postMessage({ id: data.id, files }, files.map(({ data: buffer }) => buffer.buffer));
    }
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof ArchiveError ? error.code : "OPEN_FAILED" });
  }
};
