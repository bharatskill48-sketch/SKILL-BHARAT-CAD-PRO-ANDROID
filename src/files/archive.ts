import { detectDrawingFormat, isArchiveFormat, toDrawingFile } from "./fileTypes";
import { ArchiveError, throwIfArchiveAborted, type ArchiveEntry, type ExtractedArchiveFile } from "./archiveRules";

export { ArchiveError, ARCHIVE_LIMITS, normalizeArchivePath, validateArchiveEntries } from "./archiveRules";
export type { ArchiveEntry, ArchiveErrorCode, ExtractedArchiveFile } from "./archiveRules";

export type ArchiveSession = {
  entries: ArchiveEntry[];
  readonly closed: boolean;
  extract(paths: string[], signal?: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<ExtractedArchiveFile[]>;
  close(): void;
};

type WorkerReply = {
  id: number;
  entries?: ArchiveEntry[];
  files?: Array<{ path: string; data: Uint8Array<ArrayBuffer> }>;
  progress?: { done: number; total: number };
  error?: "OPEN_FAILED" | "ENCRYPTED" | "LIMIT_EXCEEDED" | "INVALID_PATH";
};

export async function openArchive(file: File, signal?: AbortSignal): Promise<ArchiveSession> {
  toDrawingFile(file);
  const format = detectDrawingFormat(file.name);
  if (!format || !isArchiveFormat(format)) throw new ArchiveError("OPEN_FAILED");
  throwIfArchiveAborted(signal);
  const worker = new Worker(new URL("../workers/archive.worker.ts", import.meta.url), { type: "module" });
  let closed = false;
  let requestId = 0;
  let pending: { reject(error: unknown): void } | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    worker.terminate();
    pending?.reject(new DOMException("Archive extraction cancelled.", "AbortError"));
    pending = null;
  };
  const request = (message: object, abortSignal?: AbortSignal, onProgress?: (done: number, total: number) => void) =>
    new Promise<WorkerReply>((resolve, reject) => {
      if (closed) { reject(new DOMException("Archive closed.", "AbortError")); return; }
      if (pending) { reject(new ArchiveError("OPEN_FAILED")); return; }
      const id = ++requestId;
      const cleanup = () => {
        window.clearTimeout(timeout);
        abortSignal?.removeEventListener("abort", abort);
        worker.onmessage = null;
        worker.onerror = null;
        pending = null;
      };
      const fail = (error: unknown) => { cleanup(); reject(error); };
      const abort = () => { close(); };
      const timeout = window.setTimeout(() => {
        fail(new ArchiveError("LIMIT_EXCEEDED"));
        close();
      }, 60000);
      pending = { reject: fail };
      abortSignal?.addEventListener("abort", abort, { once: true });
      worker.onerror = () => { fail(new ArchiveError("OPEN_FAILED")); close(); };
      worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
        if (data.id !== id) return;
        if (data.progress) { onProgress?.(data.progress.done, data.progress.total); return; }
        cleanup();
        if (data.error) reject(new ArchiveError(data.error));
        else resolve(data);
      };
      if (abortSignal?.aborted) { abort(); return; }
      worker.postMessage({ ...message, id });
    });
  try {
    const reply = await request({ action: "open", file, format, runtimeUrl: new URL(`${import.meta.env.BASE_URL}wasm/libarchive.wasm`, location.href).href }, signal);
    return {
      entries: reply.entries ?? [], get closed() { return closed; }, close,
      async extract(paths, abortSignal, onProgress) {
        const result = await request({ action: "extract", paths }, abortSignal, onProgress);
        return (result.files ?? []).map(({ path, data }) => ({
          path, file: new File([data], path.split("/").slice(-1)[0], {
            type: path.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
          }),
        }));
      },
    };
  } catch (error) { close(); throw error; }
}
