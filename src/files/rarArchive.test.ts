/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { libarchiveWasm, type LibarchiveWasm } from "libarchive-wasm";
import { extractRar, rarEntries, validateRarSignature } from "./rarArchive";

// BSD-licensed upstream libarchive 3.7.7 stored-file fixtures, not user documents.
// https://github.com/libarchive/libarchive/tree/v3.7.7/libarchive/test
function uuDecode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (line === "end" || !line) break;
    const count = (line.charCodeAt(0) - 32) & 63;
    const row: number[] = [];
    for (let offset = 1; offset < line.length; offset += 4) {
      const a = (line.charCodeAt(offset) - 32) & 63;
      const b = (line.charCodeAt(offset + 1) - 32) & 63;
      const c = (line.charCodeAt(offset + 2) - 32) & 63;
      const d = (line.charCodeAt(offset + 3) - 32) & 63;
      row.push((a << 2) | (b >> 4), ((b << 4) | (c >> 2)) & 255, ((c << 6) | d) & 255);
    }
    bytes.push(...row.slice(0, count));
  }
  return new Uint8Array(bytes);
}

describe("offline RAR4 and RAR5 WASM runtime", () => {
  let engine: LibarchiveWasm;
  beforeAll(async () => {
    const require = createRequire(import.meta.url);
    const runtime = join(dirname(require.resolve("libarchive-wasm")), "libarchive.wasm");
    engine = await libarchiveWasm({ wasmBinary: await readFile(runtime) });
  });

  it.each([4, 5])("lists and extracts actual RAR%s fixture contents", async (version) => {
    const bytes = uuDecode(await readFile(new URL(`./__fixtures__/libarchive-rar${version}.uu`, import.meta.url), "utf8"));
    const entries = rarEntries(bytes, engine);
    const regular = entries.filter((entry) => entry.size > 0 && !entry.directory && entry.format === null &&
      entry.path.endsWith(".txt"));
    expect(regular.length).toBeGreaterThan(0);
    const files = extractRar(bytes, engine, entries, new Set(regular.map((entry) => entry.path)));
    expect(files).toHaveLength(regular.length);
    expect(new TextDecoder().decode(files[0].data)).toContain(version === 4 ? "test text document" : "hello libarchive test suite");
    if (version === 4) expect(entries.find((entry) => entry.path === "testlink")?.supported).toBe(false);
  });

  it("rejects wrong formats and encrypted headers without asking WASM to decode", () => {
    expect(() => validateRarSignature(new Uint8Array(32))).toThrow("OPEN_FAILED");
    const encryptedRar4 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 7, 0, 0, 0, 0x73, 0x80, 0, 13, 0]);
    expect(() => validateRarSignature(encryptedRar4)).toThrow("ENCRYPTED");
    const encryptedRar5 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 7, 1, 0, 0, 0, 0, 0, 1, 4]);
    expect(() => validateRarSignature(encryptedRar5)).toThrow("ENCRYPTED");
  });
});
