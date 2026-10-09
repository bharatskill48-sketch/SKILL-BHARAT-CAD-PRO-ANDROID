import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let library: typeof import("./drawingLibrary");
const drawing = (name = "plan.dxf", content = "original") =>
  new File([content], name, { type: "application/dxf", lastModified: 1234 });

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

async function openExistingDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("izcad-drawing-library", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe("drawing library storage", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", new IDBFactory());
    library = await import("./drawingLibrary");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves both files when different drawings share the same name", async () => {
    const first = await library.importDrawingToLibrary(drawing());
    const second = await library.importDrawingToLibrary(drawing("PLAN.dxf", "revised"));
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe("PLAN (2).dxf");
    expect(await (await library.openLibraryDrawing(first.id)).text()).toBe("original");
    expect(await (await library.openLibraryDrawing(second.id)).text()).toBe("revised");
  });

  it("rejects empty or unsupported files without creating library entries", async () => {
    await expect(library.importDrawingToLibrary(new File([], "empty.dxf")))
      .rejects.toMatchObject({ code: "INVALID_FILE" });
    await expect(library.importDrawingToLibrary(drawing("notes.pdf")))
      .rejects.toMatchObject({ code: "INVALID_FILE" });
    expect(await library.listLibraryChildren("root")).toHaveLength(0);
  });

  it("serializes concurrent imports so no file gets overwritten", async () => {
    const entries = await Promise.all([
      library.importDrawingToLibrary(drawing("plan.dxf", "one")),
      library.importDrawingToLibrary(drawing("plan.dxf", "two")),
      library.importDrawingToLibrary(drawing("plan.dxf", "three")),
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3);
    expect(new Set(entries.map((entry) => entry.name)).size).toBe(3);
    const files = await Promise.all(entries.map((entry) => library.openLibraryDrawing(entry.id)));
    expect(await Promise.all(files.map((file) => file.text()))).toEqual(["one", "two", "three"]);
  });

  it("checks folder name collisions inside the write transaction", async () => {
    const results = await Promise.allSettled([
      library.createLibraryFolder("root", "Project"),
      library.createLibraryFolder("root", "PROJECT"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected"))
      .toMatchObject({ reason: { code: "NAME_EXISTS" } });
    expect(await library.listLibraryChildren("root")).toHaveLength(1);
  });

  it("preserves a concurrent rename when moving an entry", async () => {
    const folder = await library.createLibraryFolder("root", "Destination");
    const entry = await library.importDrawingToLibrary(drawing());
    await Promise.all([
      library.renameLibraryEntry(entry.id, "updated.dxf"),
      library.moveLibraryEntry(entry.id, folder.id),
    ]);
    expect(await library.listLibraryChildren(folder.id))
      .toMatchObject([{ id: entry.id, name: "updated.dxf", parentId: folder.id }]);
  });

  it("copies entire folder trees and deletes only the requested tree", async () => {
    const folder = await library.createLibraryFolder("root", "Project");
    const child = await library.createLibraryFolder(folder.id, "Floor");
    const entry = await library.importDrawingToLibrary(drawing(), child.id);
    await library.copyLibraryEntry(folder.id, "root");
    const copy = (await library.listLibraryChildren("root")).find((item) => item.id !== folder.id)!;
    const copiedChild = (await library.listLibraryChildren(copy.id))[0];
    const copiedEntry = (await library.listLibraryChildren(copiedChild.id))[0];
    expect(copy.name).toBe("Project (2)");
    expect(copiedEntry.id).not.toBe(entry.id);
    expect(await (await library.openLibraryDrawing(copiedEntry.id)).text()).toBe("original");
    await library.deleteLibraryEntry(folder.id);
    await expect(library.openLibraryDrawing(entry.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await (await library.openLibraryDrawing(copiedEntry.id)).text()).toBe("original");
    expect(await library.getLibraryPath(copiedChild.id)).toMatchObject([
      { id: copy.id }, { id: copiedChild.id },
    ]);
  });

  it("rejects moving or copying a folder into its descendants", async () => {
    const folder = await library.createLibraryFolder("root", "Project");
    const child = await library.createLibraryFolder(folder.id, "Floor");
    await expect(library.moveLibraryEntry(folder.id, child.id))
      .rejects.toMatchObject({ code: "INVALID_DESTINATION" });
    await expect(library.copyLibraryEntry(folder.id, child.id))
      .rejects.toMatchObject({ code: "INVALID_DESTINATION" });
    expect(await library.listLibraryChildren("root")).toHaveLength(1);
    expect(await library.listLibraryChildren(child.id)).toHaveLength(0);
  });

  it("never resurrects an entry when opening and deleting overlap", async () => {
    const entry = await library.importDrawingToLibrary(drawing());
    await Promise.allSettled([
      library.openLibraryDrawing(entry.id), library.deleteLibraryEntry(entry.id),
    ]);
    expect(await library.listLibraryChildren("root")).toHaveLength(0);
  });

  it("rolls back metadata if storing file contents fails", async () => {
    await library.listLibraryChildren("root");
    const originalAdd = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (
      this: IDBObjectStore, value: unknown, key?: IDBValidKey,
    ) {
      if (this.name === "contents") {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      }
      return originalAdd.call(this, value, key);
    });
    await expect(library.importDrawingToLibrary(drawing()))
      .rejects.toMatchObject({ code: "STORAGE_FULL" });
    expect(await library.listLibraryChildren("root")).toHaveLength(0);
  });

  it("can open an existing drawing when updating recent-file metadata exceeds quota", async () => {
    const entry = await library.importDrawingToLibrary(drawing());
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });
    expect(await (await library.openLibraryDrawing(entry.id)).text()).toBe("original");
    expect(await library.listLibraryChildren("root")).toHaveLength(1);
  });

  it("does not classify an unknown database failure as a full disk", async () => {
    vi.spyOn(IDBFactory.prototype, "open").mockImplementation(() => {
      throw new DOMException("Database unavailable", "UnknownError");
    });
    await expect(library.listLibraryChildren("root"))
      .rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });

  it("handles asynchronous request aborts without changing existing contents", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "fixed-id" });
    const entry = await library.importDrawingToLibrary(drawing());
    await expect(library.importDrawingToLibrary(drawing("other.dxf", "revised")))
      .rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(await library.listLibraryChildren("root")).toHaveLength(1);
    expect(await (await library.openLibraryDrawing(entry.id)).text()).toBe("original");
  });

  it("does not create partial copies when a source's contents are missing", async () => {
    const folder = await library.createLibraryFolder("root", "Project");
    const entry = await library.importDrawingToLibrary(drawing(), folder.id);
    const database = await openExistingDatabase();
    const transaction = database.transaction("contents", "readwrite");
    const complete = transactionDone(transaction);
    transaction.objectStore("contents").delete(entry.id);
    await complete;
    database.close();
    await expect(library.copyLibraryEntry(folder.id, "root"))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await library.listLibraryChildren("root")).toHaveLength(1);
  });

  it("keeps modification dates and recent-file ordering separate", async () => {
    const entry = await library.importDrawingToLibrary(drawing());
    await library.copyLibraryEntry(entry.id, "root");
    const before = (await library.listLibraryChildren("root")).find((item) => item.id === entry.id)!;
    const file = await library.openLibraryDrawing(entry.id);
    const after = (await library.listLibraryChildren("root")).find((item) => item.id === entry.id)!;
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(file.lastModified).toBe(1234);
    expect((await library.listRecentDrawings()).map((item) => item.id)).toEqual([entry.id]);
    expect(await library.listRecentDrawings(-1)).toHaveLength(0);
  });

  it("retains the 1.x database's folders, names and file contents", async () => {
    const request = indexedDB.open("izcad-drawing-library", 1);
    request.onupgradeneeded = () => {
      const entries = request.result.createObjectStore("entries", { keyPath: "id" });
      entries.createIndex("parentId", "parentId");
      request.result.createObjectStore("contents", { keyPath: "id" });
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["entries", "contents"], "readwrite");
    const complete = transactionDone(transaction);
    transaction.objectStore("entries").put({
      id: "legacy-folder", kind: "folder", parentId: "root", name: "1.x Project",
      createdAt: 1, updatedAt: 1,
    });
    transaction.objectStore("entries").put({
      id: "legacy-file", kind: "drawing", parentId: "legacy-folder", name: "archive.dxf",
      createdAt: 1, updatedAt: 1, format: "dxf", mimeType: "application/dxf",
      size: 6, lastModified: 1234, lastOpenedAt: 2,
    });
    transaction.objectStore("contents").put({ id: "legacy-file", blob: new Blob(["legacy"]) });
    await complete;
    database.close();
    expect(await library.listLibraryChildren("root"))
      .toMatchObject([{ id: "legacy-folder", name: "1.x Project" }]);
    const file = await library.openLibraryDrawing("legacy-file");
    expect(file.name).toBe("archive.dxf");
    expect(await file.text()).toBe("legacy");
    expect((await indexedDB.databases())[0].version).toBe(1);
  });
});
