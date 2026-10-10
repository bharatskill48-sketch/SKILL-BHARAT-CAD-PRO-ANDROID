import { inflateSync, strFromU8 } from "fflate";
import { archiveEntry, ARCHIVE_LIMITS, ArchiveError, validateArchiveEntries, type ArchiveEntry } from "./archiveRules";
export type ZipEntry = ArchiveEntry & { rawPath: string; compression: number; compressedSize: number; offset: number; crc: number };

export function parseZip(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === data.length) break;
  }
  if (end < Math.max(0, data.length - 65557)) throw new ArchiveError("OPEN_FAILED");
  const count = view.getUint16(end + 10, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count === 65535) throw new ArchiveError("OPEN_FAILED");
  if (count > ARCHIVE_LIMITS.entries) throw new ArchiveError("LIMIT_EXCEEDED");
  let offset = view.getUint32(end + 16, true);
  const centralEnd = offset + view.getUint32(end + 12, true);
  if (centralEnd > end || offset > data.length) throw new ArchiveError("OPEN_FAILED");
  const result: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > centralEnd || view.getUint32(offset, true) !== 0x02014b50) throw new ArchiveError("OPEN_FAILED");
    const flags = view.getUint16(offset + 8, true);
    if (flags & 1) throw new ArchiveError("ENCRYPTED");
    const nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > centralEnd) throw new ArchiveError("OPEN_FAILED");
    const nameData = data.subarray(offset + 46, offset + 46 + nameLength);
    const rawPath = flags & 0x800 ? new TextDecoder("utf-8", { fatal: true }).decode(nameData) : strFromU8(nameData, true);
    const mode = view.getUint32(offset + 38, true) >>> 16;
    const fileType = mode & 0o170000;
    const directory = rawPath.endsWith("/") || fileType === 0o040000;
    const regular = !fileType || fileType === 0o100000 || directory;
    result.push({
      ...archiveEntry(rawPath, view.getUint32(offset + 24, true), directory, regular), rawPath,
      compression: view.getUint16(offset + 10, true), compressedSize: view.getUint32(offset + 20, true),
      offset: view.getUint32(offset + 42, true), crc: view.getUint32(offset + 16, true),
    });
    offset = next;
  }
  if (offset !== centralEnd) throw new ArchiveError("OPEN_FAILED");
  validateArchiveEntries(result);
  return result;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function extractZip(bytes: Uint8Array, entry: ZipEntry): Uint8Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.offset;
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) throw new ArchiveError("OPEN_FAILED");
  if (view.getUint16(offset + 6, true) & 1) throw new ArchiveError("ENCRYPTED");
  const dataStart = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
  if (dataStart + entry.compressedSize > bytes.length) throw new ArchiveError("OPEN_FAILED");
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  const data = entry.compression === 0 ? compressed.slice() : entry.compression === 8
    ? inflateSync(compressed, { out: new Uint8Array(entry.size) }) : null;
  if (!data || data.length !== entry.size || crc32(data) !== entry.crc) throw new ArchiveError("OPEN_FAILED");
  return new Uint8Array(data);
}

