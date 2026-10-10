import { DxfViewer } from "dxf-viewer";
import { Color, Vector3 } from "three";
import {
  AppError,
  type LoadingPhase,
  type ViewerCommand,
} from "../types/drawing";
import { detectDxfEncoding } from "./dxfEncoding";
import { validateDrawingFileSize } from "../files/fileTypes";
import {
  getSavedDrawingView,
  resolveSavedDrawingView,
  type SavedDrawingView,
} from "./savedView";
import { installXclipRendering } from "./xclipRendering";
import {
  DEFAULT_VIEWER_OVERLAY_RESERVE,
  fitPaddingForViewport,
} from "./viewerLayout";
import {
  nearestEntity, nearestSnap,
  type MeasurementGeometry, type MeasurementSettings,
  type MeasurableEntity, type SnapPoint,
} from "./measurementGeometry";
import type { DrawingPoint } from "./savedView";
import { selectInitialDrawingBounds } from "./initialView";

export type MeasurementPick = { point: DrawingPoint; snapped: SnapPoint["kind"] | null; entity: MeasurableEntity | null };

installXclipRendering(DxfViewer);

const LOAD_TIMEOUT_MS = 3 * 60 * 1000;
const HEADER_BYTES = 64 * 1024;

function abortError(): DOMException {
  return new DOMException("Drawing loading was cancelled.", "AbortError");
}

type ProgressCallback = (
  phase: LoadingPhase,
  processed: number,
  total: number,
) => void;

export class DrawingViewer {
  private readonly viewer: DxfViewer;
  private objectUrl: string | null = null;
  private savedView: SavedDrawingView | null = null;
  private worker: Worker | null = null;
  private cancelLoad: ((reason: unknown) => void) | null = null;
  private loadId = 0;
  private destroyed = false;
  private ready = false;
  private initialFitFrame: number | null = null;
  private geometry: MeasurementGeometry = { units: "drawing", entities: [], snaps: [], limited: false, completeBounds: false, fitBounds: [], fitCompleteBounds: false };
  private measurement: MeasurementSettings | null = null;
  private readonly touches = new Map<number, { x: number; y: number; time: number; moved: boolean }>();
  private multiTouch = false;
  private readonly pointerDown = (event: PointerEvent): void => {
    if (!this.measurement?.enabled || !this.ready) return;
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY, time: performance.now(), moved: false });
    try { this.viewer.GetCanvas().setPointerCapture(event.pointerId); } catch { /* Synthetic events or a detached canvas. */ }
    if (this.touches.size > 1) this.multiTouch = true;
  };
  private readonly pointerMove = (event: PointerEvent): void => {
    const start = this.touches.get(event.pointerId);
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) start.moved = true;
  };
  private readonly pointerCancel = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId);
    if (!this.touches.size) this.multiTouch = false;
  };
  private readonly pointerUp = (event: PointerEvent): void => {
    const start = this.touches.get(event.pointerId);
    const canPick = start && !start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8 && !this.multiTouch && performance.now() - start.time < 1000 && (event.button === 0 || event.pointerType === "touch");
    this.pointerCancel(event);
    if (!canPick || !this.measurement?.enabled || !this.ready) return;
    const canvas = this.viewer.GetCanvas();
    const rect = canvas.getBoundingClientRect();
    const v = new Vector3((event.clientX - rect.left) * 2 / rect.width - 1, -(event.clientY - rect.top) * 2 / rect.height + 1, 0).unproject(this.viewer.GetCamera());
    const origin = this.viewer.GetOrigin();
    let point: DrawingPoint = { x: v.x + origin.x, y: v.y + origin.y };
    const camera = this.viewer.GetCamera();
    const tolerance = 18 * (camera.right - camera.left) / camera.zoom / rect.width;
    const snapped = this.measurement.snapping && this.measurement.mode !== "object" ? nearestSnap(this.geometry.snaps, point, tolerance) : null;
    if (snapped) point = { x: snapped.x, y: snapped.y };
    const entity = this.measurement.mode === "object" ? nearestEntity(this.geometry.entities, point, tolerance) : null;
    this.onPick?.({ point, snapped: snapped?.kind ?? null, entity });
  };
  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.destroyed) {
      return;
    }
    this.ready = false;
    const error = new AppError(
      "RENDER_FAILED",
      "The drawing's WebGL context was lost.",
    );
    if (this.cancelLoad) {
      this.cancelLoad(error);
    } else {
      this.onError?.(error);
    }
  };

  constructor(
    container: HTMLElement,
    private readonly onError?: (error: unknown) => void,
    private readonly onPick?: (pick: MeasurementPick) => void,
    private readonly onViewChanged?: () => void,
  ) {
    this.viewer = new DxfViewer(container, {
      autoResize: true,
      clearColor: new Color("#0b1118"),
      clearAlpha: 1,
      antialias: true,
      colorCorrection: true,
      blackWhiteInversion: true,
      pointSize: 3,
      // The worker replaces the parsed document with its compact measurement index.
      retainParsedDxf: true,
      preserveDrawingBuffer: false,
    });
    // dxf-viewer returns a partially initialized instance when WebGL creation
    // fails instead of throwing. Detect it before requesting any canvas methods.
    if (!this.viewer.HasRenderer()) {
      throw new AppError("RENDER_FAILED", "WebGL could not be initialized.");
    }
    this.viewer.GetCanvas().addEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    const canvas = this.viewer.GetCanvas();
    canvas.addEventListener("pointerdown", this.pointerDown);
    canvas.addEventListener("pointermove", this.pointerMove);
    canvas.addEventListener("pointerup", this.pointerUp);
    canvas.addEventListener("pointercancel", this.pointerCancel);
    canvas.addEventListener("__dxf_viewChanged", this.viewChanged);
  }

  async load(file: File, onProgress: ProgressCallback): Promise<void> {
    if (this.destroyed) {
      throw abortError();
    }
    validateDrawingFileSize(file.size);
    this.cancelLoad?.(abortError());
    this.cancelInitialFit();
    const loadId = ++this.loadId;
    this.ready = false;
    this.releaseWorker();
    this.releaseObjectUrl();
    this.savedView = getSavedDrawingView(file);
    const interrupted = new Promise<never>((_resolve, reject) => {
      this.cancelLoad = reject;
    });
    const timeout = window.setTimeout(() => {
      if (loadId === this.loadId) {
        this.cancelLoad?.(new AppError("DXF_OPEN_FAILED", "Drawing loading timed out."));
      }
    }, LOAD_TIMEOUT_MS);

    try {
      const prefix = await Promise.race([
        file.slice(0, HEADER_BYTES).arrayBuffer(),
        interrupted,
      ]);
      if (this.destroyed || loadId !== this.loadId) {
        throw abortError();
      }
      // The pinned viewer exposes fileEncoding only in constructor options, but
      // clones the options for every worker request. Set it before Load starts.
      const options = (this.viewer as unknown as {
        options: { fileEncoding: string };
      }).options;
      options.fileEncoding = detectDxfEncoding(new Uint8Array(prefix));
      this.objectUrl = URL.createObjectURL(file);

      await Promise.race([
        this.viewer.Load({
          url: this.objectUrl,
          fonts: [new URL("fonts/IzCadSans-Regular.ttf", document.baseURI).href],
          progressCbk: (phase, processed, total) => {
            if (!this.destroyed && loadId === this.loadId) {
              onProgress(phase, processed, total);
            }
          },
          workerFactory: () => {
            const worker = new Worker(
              new URL("../workers/drawing.worker.ts", import.meta.url),
              { type: "module", name: "izcad-dxf-worker" },
            );
            this.worker = worker;
            const failed = (event: Event): void => {
              if (!this.destroyed && loadId === this.loadId) {
                this.cancelLoad?.(new AppError(
                  "DXF_OPEN_FAILED",
                  event instanceof ErrorEvent ? event.message : "The drawing worker failed.",
                ));
              }
            };
            // dxf-viewer 1.0.48 does not reliably reject requests on worker errors.
            worker.addEventListener("error", failed);
            worker.addEventListener("messageerror", failed);
            return worker;
          },
        }),
        interrupted,
      ]);

      if (this.destroyed || loadId !== this.loadId) {
        throw abortError();
      }
      const retained = (this.viewer as unknown as { parsedDxf?: { izcadMeasurement?: MeasurementGeometry } }).parsedDxf;
      this.geometry = retained?.izcadMeasurement ?? { units: "drawing", entities: [], snaps: [], limited: false, completeBounds: false, fitBounds: [], fitCompleteBounds: false };
      (this.viewer as unknown as { parsedDxf: unknown }).parsedDxf = null;
      if (!this.applySavedView()) {
        this.fit(true);
        // The ready callback mounts the header and toolbar after this promise
        // resolves. On the next frame their measured bounds include safe-area
        // insets, so refine the initial fit once without changing a saved camera.
        if (typeof requestAnimationFrame === "function") {
          this.initialFitFrame = requestAnimationFrame(() => {
            this.initialFitFrame = null;
            if (!this.destroyed && loadId === this.loadId && this.ready) {
              try {
                this.fit(true);
              } catch (error) {
                this.onError?.(new AppError("RENDER_FAILED", undefined, { cause: error }));
              }
            }
          });
        }
      }
      this.ready = true;
      this.onViewChanged?.();
    } catch (error) {
      if (!this.destroyed && loadId === this.loadId) {
        try {
          this.viewer.Clear();
        } catch {
          // Preserve the original load error if the failed renderer cannot clear.
        }
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (loadId === this.loadId) {
        this.cancelLoad = null;
        this.releaseWorker();
        this.releaseObjectUrl();
      }
    }
  }

  execute(command: ViewerCommand): void {
    if (this.destroyed || !this.ready) {
      return;
    }
    this.cancelInitialFit();
    switch (command) {
      case "zoom-in":
        this.zoom(1.25);
        break;
      case "zoom-out":
        this.zoom(0.8);
        break;
      case "fit":
        this.fit();
        break;
      case "reset":
        if (!this.applySavedView()) {
          this.fit(true);
        }
        break;
    }
  }

  private readonly viewChanged = (): void => { this.onViewChanged?.(); };

  getMeasurementGeometry(): MeasurementGeometry { return this.geometry; }

  configureMeasurement(settings: MeasurementSettings): void {
    this.measurement = settings;
    if (!settings.enabled) { this.touches.clear(); this.multiTouch = false; }
  }

  projectPoints(points: readonly DrawingPoint[]): DrawingPoint[] {
    const camera = this.viewer.GetCamera(), origin = this.viewer.GetOrigin();
    const canvas = this.viewer.GetCanvas();
    const width = canvas.clientWidth || canvas.width, height = canvas.clientHeight || canvas.height;
    return points.map((point) => {
      const v = new Vector3(point.x - origin.x, point.y - origin.y, 0).project(camera);
      return { x: (v.x + 1) * width / 2, y: (1 - v.y) * height / 2 };
    });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.ready = false;
    this.cancelInitialFit();
    this.cancelLoad?.(abortError());
    this.cancelLoad = null;
    this.releaseWorker();
    this.releaseObjectUrl();
    const canvas = this.viewer.GetCanvas();
    const renderer = this.viewer.GetRenderer();
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    canvas.removeEventListener("pointerdown", this.pointerDown);
    canvas.removeEventListener("pointermove", this.pointerMove);
    canvas.removeEventListener("pointerup", this.pointerUp);
    canvas.removeEventListener("pointercancel", this.pointerCancel);
    canvas.removeEventListener("__dxf_viewChanged", this.viewChanged);
    this.touches.clear();
    this.geometry = { units: "drawing", entities: [], snaps: [], limited: false, completeBounds: false, fitBounds: [], fitCompleteBounds: false };
    try {
      this.viewer.Destroy();
    } finally {
      // dispose() releases GPU buffers but leaves the context allocated. Android
      // can otherwise exhaust its WebGL context budget after opening many files.
      renderer?.forceContextLoss();
      canvas.remove();
    }
  }

  private zoom(factor: number): void {
    const camera = this.viewer.GetCamera();
    camera.zoom = Math.min(1000, Math.max(0.01, camera.zoom * factor));
    camera.updateProjectionMatrix();
    this.viewer.Render();
    this.onViewChanged?.();
  }

  private fit(initial = false): void {
    const bounds = initial && this.geometry.fitCompleteBounds
      ? selectInitialDrawingBounds(this.viewer.GetBounds(), this.geometry.fitBounds)
      : this.viewer.GetBounds();
    if (!bounds) {
      return;
    }

    const origin = this.viewer.GetOrigin();
    const canvas = this.viewer.GetCanvas();
    const viewportHeight = canvas.clientHeight || canvas.height;
    const viewportBounds = canvas.getBoundingClientRect?.();
    const shell = canvas.closest?.<HTMLElement>(".viewer-shell") ?? canvas.parentElement?.parentElement;
    const header = shell?.querySelector<HTMLElement>(".viewer-header")?.getBoundingClientRect();
    const toolbar = shell?.querySelector<HTMLElement>(".viewer-toolbar")?.getBoundingClientRect();
    const reserve = Math.max(
      DEFAULT_VIEWER_OVERLAY_RESERVE,
      header && viewportBounds ? header.bottom - viewportBounds.top + 8 : 0,
      toolbar && viewportBounds && toolbar.width > toolbar.height
        ? viewportBounds.bottom - toolbar.top + 8
        : 0,
    );
    this.viewer.FitView(
      bounds.minX - origin.x,
      bounds.maxX - origin.x,
      bounds.minY - origin.y,
      bounds.maxY - origin.y,
      fitPaddingForViewport(viewportHeight, reserve),
    );
    this.viewer.Render();
    this.onViewChanged?.();
  }

  private applySavedView(): boolean {
    if (!this.savedView) {
      return false;
    }
    const canvas = this.viewer.GetCanvas();
    const viewportAspect = canvas.width / canvas.height;
    const origin = this.viewer.GetOrigin();
    const resolved = resolveSavedDrawingView(
      this.savedView,
      this.geometry.fitCompleteBounds ? selectInitialDrawingBounds(this.viewer.GetBounds(), this.geometry.fitBounds) : this.viewer.GetBounds(),
      origin,
      viewportAspect,
    );
    if (!resolved) {
      return false;
    }

    this.viewer.SetView(
      new Vector3(resolved.center.x, resolved.center.y, 0),
      resolved.width,
    );
    this.viewer.Render();
    return true;
  }

  private releaseObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private releaseWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private cancelInitialFit(): void {
    if (this.initialFitFrame !== null) {
      cancelAnimationFrame(this.initialFitFrame);
      this.initialFitFrame = null;
    }
  }
}
