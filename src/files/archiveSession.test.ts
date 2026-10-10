import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openArchive } from "./archive";

class ArchiveWorker {
  static latest: ArchiveWorker;
  onmessage: ((event: { data: object }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  messages: Array<{ id: number; action: string; paths?: string[] }> = [];
  constructor() { ArchiveWorker.latest = this; }
  postMessage(message: { id: number; action: string; paths?: string[] }) { this.messages.push(message); }
  reply(data: object) {
    this.onmessage?.({ data: { ...data, id: this.messages[this.messages.length - 1].id } });
  }
}

describe("archive worker lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("location", { href: "http://localhost/" });
    vi.stubGlobal("Worker", ArchiveWorker);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("cancels an active preview and releases its worker", async () => {
    const controller = new AbortController();
    const request = openArchive(new File(["ZIP"], "plans.zip"), controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(ArchiveWorker.latest.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("extracts only the selected paths and terminates on close", async () => {
    const opened = openArchive(new File(["ZIP"], "plans.zip"));
    const worker = ArchiveWorker.latest;
    worker.reply({ entries: [{ path: "docs/plan.pdf", supported: true, size: 3, directory: false, format: "pdf" }] });
    const session = await opened;
    const progress = vi.fn();
    const extraction = session.extract(["docs/plan.pdf"], undefined, progress);
    expect(worker.messages[1].paths).toEqual(["docs/plan.pdf"]);
    worker.reply({ progress: { done: 1, total: 1 } });
    worker.reply({ files: [{ path: "docs/plan.pdf", data: new Uint8Array([1, 2, 3]) }] });
    const files = await extraction;
    expect(progress).toHaveBeenCalledWith(1, 1);
    expect(files[0].file.name).toBe("plan.pdf");
    expect(files[0].file.type).toBe("application/pdf");
    session.close(); session.close();
    expect(session.closed).toBe(true);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops stalled decoders and reports the archive processing limit", async () => {
    const opened = openArchive(new File(["RAR"], "plans.rar"));
    const rejected = expect(opened).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await vi.advanceTimersByTimeAsync(60000);
    await rejected;
    expect(ArchiveWorker.latest.terminate).toHaveBeenCalledOnce();
  });
});
