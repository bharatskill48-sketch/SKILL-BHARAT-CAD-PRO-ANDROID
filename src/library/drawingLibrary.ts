import { detectDrawingFormat, fileSizeLimit, isArchiveFormat } from "../files/fileTypes";
import { archiveEntry, normalizeArchivePath, throwIfArchiveAborted, validateArchiveEntries, type ExtractedArchiveFile } from "../files/archiveRules";
import type { DrawingFormat } from "../types/drawing";

// Retain the installed app's database and schema when upgrading to 2.0.
const DATABASE_NAME = "izcad-drawing-library";
const DATABASE_VERSION = 1;
const ENTRY_STORE = "entries";
const CONTENT_STORE = "contents";
const MAX_NAME_LENGTH = 220;

export const ROOT_FOLDER_ID = "root";

type LibraryEntryBase = {
  id: string;
  parentId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type LibraryFolderEntry = LibraryEntryBase & { kind: "folder" };
export type LibraryDrawingEntry = LibraryEntryBase & {
  kind: "drawing";
  format: DrawingFormat;
  mimeType: string;
  size: number;
  lastModified: number;
  lastOpenedAt: number;
};
export type LibraryEntry = LibraryFolderEntry | LibraryDrawingEntry;
type LibraryContent = { id: string; blob: Blob };

export type LibraryErrorCode =
  | "INVALID_NAME"
  | "INVALID_FILE"
  | "FILE_TOO_LARGE"
  | "NAME_EXISTS"
  | "NOT_FOUND"
  | "INVALID_DESTINATION"
  | "STORAGE_FULL"
  | "STORAGE_UNAVAILABLE";

export class LibraryError extends Error {
  constructor(public readonly code: LibraryErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "LibraryError";
  }
}

let databasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function toLibraryError(error: unknown): LibraryError {
  if (error instanceof LibraryError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new LibraryError("STORAGE_FULL", { cause: error });
  }
  return new LibraryError("STORAGE_UNAVAILABLE", { cause: error });
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(new LibraryError("STORAGE_UNAVAILABLE"));
  }
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      let blocked = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        const entryStore = database.objectStoreNames.contains(ENTRY_STORE)
          ? request.transaction!.objectStore(ENTRY_STORE)
          : database.createObjectStore(ENTRY_STORE, { keyPath: "id" });
        if (!entryStore.indexNames.contains("parentId")) {
          entryStore.createIndex("parentId", "parentId", { unique: false });
        }
        if (!database.objectStoreNames.contains(CONTENT_STORE)) {
          database.createObjectStore(CONTENT_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          databasePromise = null;
          database.close();
        };
        database.onclose = () => { databasePromise = null; };
        resolve(database);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new LibraryError("STORAGE_UNAVAILABLE"));
      };
    }).catch((error: unknown): never => {
      databasePromise = null;
      throw toLibraryError(error);
    });
  }
  return databasePromise;
}

// Keep reads, validation and writes in one transaction. IndexedDB serializes
// overlapping writes, including writes from another app window.
async function inTransaction<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  let transaction: IDBTransaction | undefined;
  let complete: Promise<void> | undefined;
  try {
    const database = await openDatabase();
    transaction = database.transaction(stores, mode);
    complete = transactionComplete(transaction);
    // Request failures may abort before the operation's promise is observed.
    void complete.catch(() => undefined);
    const result = await operation(transaction);
    await complete;
    return result;
  } catch (error) {
    try { transaction?.abort(); } catch { /* Already committed or aborted. */ }
    await complete?.catch(() => undefined);
    throw toLibraryError(error);
  }
}

function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeEntryName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function isValidEntryName(name: string): boolean {
  const normalized = normalizeEntryName(name);
  return normalized.length > 0 && normalized.length <= MAX_NAME_LENGTH &&
    normalized !== "." && normalized !== ".." &&
    !/[\\/\u0000-\u001f\u007f]/.test(name);
}

function nameKey(name: string): string {
  return normalizeEntryName(name).toLowerCase();
}

function hasName(
  entries: readonly LibraryEntry[], parentId: string, name: string, ignoredId?: string,
): boolean {
  return entries.some((entry) => entry.parentId === parentId &&
    entry.id !== ignoredId && nameKey(entry.name) === nameKey(name));
}

export function createUniqueEntryName(
  desiredName: string,
  usedNames: readonly string[],
  preserveExtension = true,
): string {
  const name = normalizeEntryName(desiredName);
  const used = new Set(usedNames.map(nameKey));
  if (!used.has(nameKey(name))) {
    return name;
  }
  const lastDot = name.lastIndexOf(".");
  const hasExtension = preserveExtension && lastDot > 0 &&
    lastDot < name.length - 1 && name.length - lastDot <= 32;
  const stem = hasExtension ? name.slice(0, lastDot) : name;
  const extension = hasExtension ? name.slice(lastDot) : "";
  for (let suffix = 2; ; suffix += 1) {
    const addition = ` (${suffix})`;
    const prefix = stem.slice(0, MAX_NAME_LENGTH - addition.length - extension.length)
      .replace(/[\ud800-\udbff]$/, "");
    const candidate = `${prefix}${addition}${extension}`;
    if (!used.has(nameKey(candidate))) {
      return candidate;
    }
  }
}

function readEntries(transaction: IDBTransaction): Promise<LibraryEntry[]> {
  return requestResult(transaction.objectStore(ENTRY_STORE).getAll());
}

function readAllEntries(): Promise<LibraryEntry[]> {
  return inTransaction(ENTRY_STORE, "readonly", readEntries);
}

function ensureFolderExists(entries: readonly LibraryEntry[], folderId: string): void {
  if (folderId === ROOT_FOLDER_ID) { return; }
  const folder = entries.find((entry) => entry.id === folderId);
  if (!folder || folder.kind !== "folder") {
    throw new LibraryError("INVALID_DESTINATION");
  }
}

export async function requestPersistentLibraryStorage(): Promise<void> {
  try {
    if (typeof globalThis.navigator?.storage?.persist === "function") {
      await navigator.storage.persist();
    }
  } catch { /* Persistence is optional; app-private storage still works. */ }
}

export async function listLibraryChildren(parentId: string): Promise<LibraryEntry[]> {
  const entries = await inTransaction(ENTRY_STORE, "readonly", async (transaction) => {
    const store = transaction.objectStore(ENTRY_STORE);
    const [children, parent] = await Promise.all([
      requestResult<LibraryEntry[]>(store.index("parentId").getAll(parentId)),
      parentId === ROOT_FOLDER_ID ? Promise.resolve(null) :
        requestResult<LibraryEntry | undefined>(store.get(parentId)),
    ]);
    if (parentId !== ROOT_FOLDER_ID && parent?.kind !== "folder") {
      throw new LibraryError("INVALID_DESTINATION");
    }
    return children;
  });
  return entries.sort((left, right) => left.kind !== right.kind
    ? left.kind === "folder" ? -1 : 1
    : left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));
}

export async function listRecentDrawings(limit = 5): Promise<LibraryDrawingEntry[]> {
  const entries = await readAllEntries();
  return entries.filter((entry): entry is LibraryDrawingEntry =>
    entry.kind === "drawing" && entry.lastOpenedAt > 0)
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .slice(0, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 5);
}

export async function listLibraryFolders(): Promise<LibraryFolderEntry[]> {
  const entries = await readAllEntries();
  return entries.filter((entry): entry is LibraryFolderEntry => entry.kind === "folder")
    .sort((left, right) => left.name.localeCompare(right.name, undefined,
      { numeric: true, sensitivity: "base" }));
}

export async function getLibraryPath(folderId: string): Promise<LibraryFolderEntry[]> {
  if (folderId === ROOT_FOLDER_ID) { return []; }
  const entries = await readAllEntries();
  const folders = new Map(entries.filter((entry): entry is LibraryFolderEntry =>
    entry.kind === "folder").map((folder) => [folder.id, folder]));
  const path: LibraryFolderEntry[] = [];
  const visited = new Set<string>();
  let currentId = folderId;
  while (currentId !== ROOT_FOLDER_ID) {
    if (visited.has(currentId)) { throw new LibraryError("INVALID_DESTINATION"); }
    visited.add(currentId);
    const folder = folders.get(currentId);
    if (!folder) { throw new LibraryError("NOT_FOUND"); }
    path.unshift(folder);
    currentId = folder.parentId;
  }
  return path;
}

export async function createLibraryFolder(parentId: string, requestedName: string): Promise<LibraryFolderEntry> {
  if (!isValidEntryName(requestedName)) { throw new LibraryError("INVALID_NAME"); }
  const name = normalizeEntryName(requestedName);
  return inTransaction(ENTRY_STORE, "readwrite", async (transaction) => {
    const entries = await readEntries(transaction);
    ensureFolderExists(entries, parentId);
    if (hasName(entries, parentId, name)) { throw new LibraryError("NAME_EXISTS"); }
    const now = Date.now();
    const folder: LibraryFolderEntry = {
      id: createId(), kind: "folder", parentId, name, createdAt: now, updatedAt: now,
    };
    transaction.objectStore(ENTRY_STORE).add(folder);
    return folder;
  });
}

export async function importDrawingToLibrary(file: File, parentId = ROOT_FOLDER_ID): Promise<LibraryDrawingEntry> {
  if (!isValidEntryName(file.name)) { throw new LibraryError("INVALID_NAME"); }
  const requestedName = normalizeEntryName(file.name);
  const format = detectDrawingFormat(requestedName);
  if (!format) { throw new LibraryError("INVALID_FILE"); }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new LibraryError("INVALID_FILE");
  }
  if (file.size > fileSizeLimit(format)) { throw new LibraryError("FILE_TOO_LARGE"); }
  return inTransaction([ENTRY_STORE, CONTENT_STORE], "readwrite", async (transaction) => {
    const entries = await readEntries(transaction);
    ensureFolderExists(entries, parentId);
    const now = Date.now();
    const entry: LibraryDrawingEntry = {
      id: createId(), kind: "drawing", parentId,
      // Importing another file must never silently replace an existing drawing.
      name: createUniqueEntryName(requestedName,
        entries.filter((item) => item.parentId === parentId).map((item) => item.name)),
      format, mimeType: file.type || "application/octet-stream", size: file.size,
      lastModified: file.lastModified || now, lastOpenedAt: now,
      createdAt: now, updatedAt: now,
    };
    transaction.objectStore(ENTRY_STORE).add(entry);
    transaction.objectStore(CONTENT_STORE).add({
      id: entry.id, blob: file.slice(0, file.size, entry.mimeType),
    } satisfies LibraryContent);
    return entry;
  });
}

async function readStoredDrawing(transaction: IDBTransaction, entryId: string): Promise<{
  entry: LibraryDrawingEntry;
  file: File;
}> {
  const [entry, content] = await Promise.all([
    requestResult<LibraryEntry | undefined>(transaction.objectStore(ENTRY_STORE).get(entryId)),
    requestResult<LibraryContent | undefined>(transaction.objectStore(CONTENT_STORE).get(entryId)),
  ]);
  if (!entry || entry.kind !== "drawing" || !content?.blob) {
    throw new LibraryError("NOT_FOUND");
  }
  if (!(content.blob instanceof Blob) || content.blob.size !== entry.size || content.blob.size <= 0) {
    throw new LibraryError("INVALID_FILE");
  }
  if (content.blob.size > fileSizeLimit(entry.format)) {
    throw new LibraryError("FILE_TOO_LARGE");
  }
  return {
    entry,
    file: new File([content.blob], entry.name,
      { type: entry.mimeType, lastModified: entry.lastModified }),
  };
}

export async function openLibraryDrawing(entryId: string): Promise<File> {
  try {
    return await inTransaction([ENTRY_STORE, CONTENT_STORE], "readwrite", async (transaction) => {
      const { entry, file } = await readStoredDrawing(transaction, entryId);
      transaction.objectStore(ENTRY_STORE).put({ ...entry, lastOpenedAt: Date.now() });
      return file;
    });
  } catch (error) {
    if (!(error instanceof LibraryError) || error.code !== "STORAGE_FULL") {
      throw error;
    }
  }
  // A full device must still be able to open drawings already in the library.
  // Recent-file tracking is optional; recover with a consistent read-only read.
  return inTransaction([ENTRY_STORE, CONTENT_STORE], "readonly", async (transaction) => {
    const { file } = await readStoredDrawing(transaction, entryId);
    return file;
  });
}

/** Preserve relative archive folders and commit all selected documents together. */
export async function importArchiveFilesToLibrary(
  files: readonly ExtractedArchiveFile[],
  parentId: string,
  folderName: string,
  signal?: AbortSignal,
): Promise<{ folder: LibraryFolderEntry; entries: LibraryDrawingEntry[] }> {
  throwIfArchiveAborted(signal);
  if (!files.length || !isValidEntryName(folderName)) throw new LibraryError("INVALID_FILE");
  const normalized = files.map(({ path, file }) => {
    const safePath = normalizeArchivePath(path);
    const format = detectDrawingFormat(safePath);
    if (!format || isArchiveFormat(format) || file.size <= 0 ||
        file.name !== safePath.split("/").slice(-1)[0]) throw new LibraryError("INVALID_FILE");
    return { path: safePath, file, format };
  });
  validateArchiveEntries(normalized.map(({ path, file }) => archiveEntry(path, file.size)));
  const filePaths = new Set(normalized.map(({ path }) => path.toLowerCase()));
  for (const { path } of normalized) {
    const parts = path.toLowerCase().split("/");
    for (let end = 1; end < parts.length; end++) {
      if (filePaths.has(parts.slice(0, end).join("/"))) throw new LibraryError("INVALID_FILE");
    }
  }
  return inTransaction([ENTRY_STORE, CONTENT_STORE], "readwrite", async (transaction) => {
    const existing = await readEntries(transaction);
    ensureFolderExists(existing, parentId);
    throwIfArchiveAborted(signal);
    const cancel = () => { try { transaction.abort(); } catch { /* Already completed. */ } };
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    transaction.addEventListener("complete", cleanup, { once: true });
    transaction.addEventListener("abort", cleanup, { once: true });
    const now = Date.now();
    const entryStore = transaction.objectStore(ENTRY_STORE);
    const contentStore = transaction.objectStore(CONTENT_STORE);
    const folder: LibraryFolderEntry = {
      id: createId(), kind: "folder", parentId,
      name: createUniqueEntryName(folderName,
        existing.filter((entry) => entry.parentId === parentId).map((entry) => entry.name), false),
      createdAt: now, updatedAt: now,
    };
    entryStore.add(folder);
    const folders = new Map<string, string>([["", folder.id]]);
    const imported: LibraryDrawingEntry[] = [];
    for (const { path, file, format } of normalized) {
      const parts = path.split("/");
      let destination = folder.id;
      for (let end = 1; end < parts.length; end++) {
        const key = parts.slice(0, end).join("/").toLowerCase();
        let id = folders.get(key);
        if (!id) {
          id = createId();
          entryStore.add({ id, kind: "folder", parentId: destination, name: parts[end - 1], createdAt: now, updatedAt: now } satisfies LibraryFolderEntry);
          folders.set(key, id);
        }
        destination = id;
      }
      const entry: LibraryDrawingEntry = {
        id: createId(), kind: "drawing", parentId: destination, name: parts[parts.length - 1], format,
        mimeType: file.type || "application/octet-stream", size: file.size,
        lastModified: file.lastModified || now, lastOpenedAt: 0, createdAt: now, updatedAt: now,
      };
      entryStore.add(entry);
      contentStore.add({ id: entry.id, blob: file.slice(0, file.size, entry.mimeType) } satisfies LibraryContent);
      imported.push(entry);
    }
    return { folder, entries: imported };
  });
}

export async function renameLibraryEntry(entryId: string, requestedName: string): Promise<void> {
  if (!isValidEntryName(requestedName)) { throw new LibraryError("INVALID_NAME"); }
  const name = normalizeEntryName(requestedName);
  return inTransaction(ENTRY_STORE, "readwrite", async (transaction) => {
    const entries = await readEntries(transaction);
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) { throw new LibraryError("NOT_FOUND"); }
    if (hasName(entries, entry.parentId, name, entry.id)) { throw new LibraryError("NAME_EXISTS"); }
    if (entry.kind === "drawing" && detectDrawingFormat(name) !== entry.format) {
      throw new LibraryError("INVALID_NAME");
    }
    transaction.objectStore(ENTRY_STORE).put({ ...entry, name, updatedAt: Date.now() });
  });
}

function descendantIds(entries: readonly LibraryEntry[], entryId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const entry of entries) {
    const ids = children.get(entry.parentId) ?? [];
    ids.push(entry.id);
    children.set(entry.parentId, ids);
  }
  const descendants = new Set<string>([entryId]);
  const queue = [entryId];
  for (let index = 0; index < queue.length; index += 1) {
    for (const id of children.get(queue[index]) ?? []) {
      if (!descendants.has(id)) { descendants.add(id); queue.push(id); }
    }
  }
  return descendants;
}

export async function moveLibraryEntry(entryId: string, destinationFolderId: string): Promise<void> {
  return inTransaction(ENTRY_STORE, "readwrite", async (transaction) => {
    const entries = await readEntries(transaction);
    ensureFolderExists(entries, destinationFolderId);
    const entry = entries.find((item) => item.id === entryId);
    if (!entry) { throw new LibraryError("NOT_FOUND"); }
    if (entry.parentId === destinationFolderId) { return; }
    if (entry.kind === "folder" && descendantIds(entries, entry.id).has(destinationFolderId)) {
      throw new LibraryError("INVALID_DESTINATION");
    }
    const name = createUniqueEntryName(entry.name,
      entries.filter((item) => item.parentId === destinationFolderId).map((item) => item.name),
      entry.kind === "drawing");
    transaction.objectStore(ENTRY_STORE).put({
      ...entry, parentId: destinationFolderId, name, updatedAt: Date.now(),
    });
  });
}

export async function copyLibraryEntry(entryId: string, destinationFolderId: string): Promise<void> {
  return inTransaction([ENTRY_STORE, CONTENT_STORE], "readwrite", async (transaction) => {
    const entries = await readEntries(transaction);
    ensureFolderExists(entries, destinationFolderId);
    const source = entries.find((entry) => entry.id === entryId);
    if (!source) { throw new LibraryError("NOT_FOUND"); }
    const ids = descendantIds(entries, source.id);
    if (source.kind === "folder" && ids.has(destinationFolderId)) {
      throw new LibraryError("INVALID_DESTINATION");
    }
    const sourceEntries = entries.filter((entry) => ids.has(entry.id));
    const sourceDrawings = sourceEntries.filter((entry): entry is LibraryDrawingEntry =>
      entry.kind === "drawing");
    const contentStore = transaction.objectStore(CONTENT_STORE);
    const storedContents = await Promise.all(sourceDrawings.map((drawing) =>
      requestResult<LibraryContent | undefined>(contentStore.get(drawing.id))));
    const contents = new Map<string, Blob>();
    storedContents.forEach((content, index) => {
      const drawing = sourceDrawings[index];
      if (!content?.blob) { throw new LibraryError("NOT_FOUND"); }
      if (!(content.blob instanceof Blob) || content.blob.size !== drawing.size || content.blob.size <= 0) {
        throw new LibraryError("INVALID_FILE");
      }
      contents.set(drawing.id, content.blob);
    });
    const idMap = new Map(sourceEntries.map((entry) => [entry.id, createId()]));
    const now = Date.now();
    const entryStore = transaction.objectStore(ENTRY_STORE);
    const name = createUniqueEntryName(source.name,
      entries.filter((item) => item.parentId === destinationFolderId).map((item) => item.name),
      source.kind === "drawing");
    for (const entry of sourceEntries) {
      const id = idMap.get(entry.id)!;
      const isRootCopy = entry.id === source.id;
      const copied: LibraryEntry = {
        ...entry, id,
        parentId: isRootCopy ? destinationFolderId : idMap.get(entry.parentId)!,
        name: isRootCopy ? name : entry.name, createdAt: now, updatedAt: now,
        ...(entry.kind === "drawing" ? { lastOpenedAt: 0 } : {}),
      };
      entryStore.add(copied);
      if (entry.kind === "drawing") {
        contentStore.add({ id, blob: contents.get(entry.id)! } satisfies LibraryContent);
      }
    }
  });
}

export async function deleteLibraryEntry(entryId: string): Promise<void> {
  return inTransaction([ENTRY_STORE, CONTENT_STORE], "readwrite", async (transaction) => {
    const entries = await readEntries(transaction);
    if (!entries.some((item) => item.id === entryId)) { throw new LibraryError("NOT_FOUND"); }
    const ids = descendantIds(entries, entryId);
    const entryStore = transaction.objectStore(ENTRY_STORE);
    const contentStore = transaction.objectStore(CONTENT_STORE);
    for (const id of ids) { entryStore.delete(id); contentStore.delete(id); }
  });
}

export function unavailableDestinationIds(
  entry: LibraryEntry, folders: readonly LibraryFolderEntry[],
): Set<string> {
  return entry.kind === "folder" ? descendantIds([entry, ...folders], entry.id) : new Set();
}
