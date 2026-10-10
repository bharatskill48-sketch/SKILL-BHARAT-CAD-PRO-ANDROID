import { ArchiveReader, type LibarchiveWasm } from "libarchive-wasm";
import { archiveEntry, ARCHIVE_LIMITS, ArchiveError, normalizeArchivePath, validateArchiveEntries, type ArchiveEntry } from "./archiveRules";

function reader(bytes: Uint8Array, wasm: LibarchiveWasm): ArchiveReader {
  if (!wasm) throw new ArchiveError("OPEN_FAILED");
  validateRarSignature(bytes);
  return new ArchiveReader(wasm, new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

export function validateRarSignature(bytes: Uint8Array): void {
  if (bytes.length < 14 || bytes[0] !== 0x52 || bytes[1] !== 0x61 || bytes[2] !== 0x72 ||
      bytes[3] !== 0x21 || bytes[4] !== 0x1a || bytes[5] !== 0x07) throw new ArchiveError("OPEN_FAILED");
  if (bytes[6] === 0) {
    if (bytes[9] !== 0x73) throw new ArchiveError("OPEN_FAILED");
    if ((bytes[10] | (bytes[11] << 8)) & 0x80) throw new ArchiveError("ENCRYPTED");
  } else if (bytes[6] === 1 && bytes[7] === 0) {
    // The first RAR5 header can be the header-encryption block (type 4).
    let offset = 12;
    for (let count = 0; count < 5 && bytes[offset++] & 0x80; count++) { /* Header size vint. */ }
    if (offset >= bytes.length) throw new ArchiveError("OPEN_FAILED");
    if (bytes[offset] === 4) throw new ArchiveError("ENCRYPTED");
  } else throw new ArchiveError("OPEN_FAILED");
}
export function rarEntries(bytes: Uint8Array, wasm: LibarchiveWasm): ArchiveEntry[] {
  const archive = reader(bytes, wasm);
  const result: ArchiveEntry[] = [];
  try {
    for (const entry of archive.entries()) {
      if (result.length >= ARCHIVE_LIMITS.entries) throw new ArchiveError("LIMIT_EXCEEDED");
      if (entry.isEncrypted()) throw new ArchiveError("ENCRYPTED");
      result.push(archiveEntry(entry.getPathname(), entry.getSize(), entry.getFiletype() === "Directory",
        entry.getFiletype() === "File" && !entry.getHardlinkTarget() && !entry.getSymlinkTarget()));
      validateArchiveEntries(result);
    }
    if (archive.hasEncryptedData()) throw new ArchiveError("ENCRYPTED");
    if (wasm.error_string(archive.archive)) throw new ArchiveError("OPEN_FAILED");
    return result;
  } finally { archive.free(); }
}

export function extractRar(bytes: Uint8Array, wasm: LibarchiveWasm, entries: ArchiveEntry[], paths: Set<string>, progress?: (done: number, total: number) => void): Array<{ path: string; data: Uint8Array<ArrayBuffer> }> {
  const archive = reader(bytes, wasm);
  const result: Array<{ path: string; data: Uint8Array<ArrayBuffer> }> = [];
  try {
    for (const entry of archive.entries()) {
      const path = normalizeArchivePath(entry.getPathname());
      if (!paths.has(path)) continue;
      const expected = entries.find((item) => item.path === path)!;
      if (entry.isEncrypted()) throw new ArchiveError("ENCRYPTED");
      const output = new Uint8Array(expected.size);
      let read = 0;
      // Read in bounded chunks. The package's single readData(size) API can return a short read.
      while (read < output.length) {
        const chunk = archive.readData(Math.min(64 * 1024, output.length - read));
        if (!chunk.length) throw new ArchiveError("OPEN_FAILED");
        output.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), read);
        read += chunk.length;
      }
      if (archive.readData(1).length) throw new ArchiveError("LIMIT_EXCEEDED");
      entry.readCalled = true;
      result.push({ path, data: output });
      progress?.(result.length, paths.size);
    }
    if (result.length !== paths.size || wasm.error_string(archive.archive)) throw new ArchiveError("OPEN_FAILED");
    return result;
  } finally { archive.free(); }
}

