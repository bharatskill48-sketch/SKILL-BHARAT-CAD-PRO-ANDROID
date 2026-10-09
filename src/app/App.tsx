import {
  lazy,
  Suspense,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Browser } from "@capacitor/browser";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { DrawingLibrary } from "../components/DrawingLibrary";
import { ErrorScreen } from "../components/ErrorScreen";
import { CloseIcon, FolderIcon, ShieldIcon } from "../components/Icons";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { LoadingScreen } from "../components/LoadingScreen";
import { ViewerToolbar } from "../components/ViewerToolbar";
import { dispatchBackNavigation, useBackNavigation } from "./backNavigation";
import { version } from "../../package.json";
import { convertDwgToDxf } from "../dwg/convertDwg";
import { toDrawingFile } from "../files/fileTypes";
import { useI18n } from "../i18n/I18nProvider";
import {
  importDrawingToLibrary,
  ROOT_FOLDER_ID,
} from "../library/drawingLibrary";
import {
  incomingDrawingPlugin,
  readIncomingDrawingFile,
  type IncomingDrawing,
} from "../native/incomingDrawing";
import {
  AppError,
  type AppErrorCode,
  type DrawingFile,
  type LoadingPhase,
  type ViewerCommand,
  type ViewerHandle,
} from "../types/drawing";

const DrawingCanvas = lazy(() =>
  import("../components/DrawingCanvas").then((module) => ({
    default: module.DrawingCanvas,
  })),
);

type AppState =
  | { status: "home" }
  | {
      status: "loading";
      drawing: DrawingFile;
      renderFile: File | null;
      phase: LoadingPhase;
      progress: number | null;
    }
  | { status: "viewer"; drawing: DrawingFile; renderFile: File }
  | { status: "error"; error: AppError };

function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length,
  );
  const value = bytes / 1024 ** exponent;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units[exponent - 1]}`;
}

function toAppError(error: unknown, fallback: AppErrorCode): AppError {
  return error instanceof AppError
    ? error
    : new AppError(fallback, undefined, { cause: error });
}

function openExternalLink(event: MouseEvent<HTMLAnchorElement>): void {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  event.preventDefault();
  void Browser.open({ url: event.currentTarget.href }).catch(() => undefined);
}

export function App() {
  const { locale, t } = useI18n();
  const [state, setState] = useState<AppState>({ status: "home" });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryNotice, setLibraryNotice] = useState(false);
  const viewerRef = useRef<ViewerHandle>(null);
  const requestIdRef = useRef(0);
  const incomingRequestIdRef = useRef(0);
  const handledIncomingIdsRef = useRef(new Set<string>());
  const conversionAbortRef = useRef<AbortController | null>(null);
  const incomingAbortRef = useRef<AbortController | null>(null);
  const lastDrawingRef = useRef<{ file: File; libraryEntryId?: string } | null>(null);
  const pendingImportRef = useRef<{ file: File; requestId: number } | null>(null);

  const openFile = useCallback(async (file: File, libraryEntryId?: string) => {
    incomingRequestIdRef.current += 1;
    incomingAbortRef.current?.abort();
    conversionAbortRef.current?.abort();
    conversionAbortRef.current = null;
    const requestId = ++requestIdRef.current;
    lastDrawingRef.current = null;
    pendingImportRef.current = null;
    setLibraryNotice(false);

    let drawing: DrawingFile;
    try {
      drawing = toDrawingFile(file);
    } catch (error) {
      setState({
        status: "error",
        error: toAppError(error, "UNSUPPORTED_FORMAT"),
      });
      return;
    }

    lastDrawingRef.current = { file, libraryEntryId };
    if (!libraryEntryId) pendingImportRef.current = { file, requestId };
    setLibraryOpen(false);
    setState({
      status: "loading",
      drawing,
      renderFile: null,
      phase: drawing.format === "dwg" ? "converting" : "reading",
      progress: null,
    });

    const conversionController =
      drawing.format === "dwg" ? new AbortController() : null;
    conversionAbortRef.current = conversionController;

    try {
      const renderFile =
        drawing.format === "dwg"
          ? await convertDwgToDxf(
              file,
              conversionController?.signal,
            )
          : file;
      if (requestId !== requestIdRef.current) {
        return;
      }

      setState({
        status: "loading",
        drawing,
        renderFile,
        phase: "fetch",
        progress: null,
      });
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setState({
          status: "error",
          error: toAppError(error, "DWG_CONVERSION_FAILED"),
        });
      }
    } finally {
      if (conversionAbortRef.current === conversionController) {
        conversionAbortRef.current = null;
      }
    }
  }, []);

  const openIncomingDrawing = useCallback(
    async (incoming: IncomingDrawing) => {
      if (handledIncomingIdsRef.current.has(incoming.id)) {
        return;
      }

      handledIncomingIdsRef.current.add(incoming.id);
      // Only retain a bounded deduplication history during long sessions.
      if (handledIncomingIdsRef.current.size > 100) {
        handledIncomingIdsRef.current.delete(handledIncomingIdsRef.current.values().next().value!);
      }
      incomingAbortRef.current?.abort();
      const controller = new AbortController();
      incomingAbortRef.current = controller;
      const incomingRequestId = ++incomingRequestIdRef.current;
      const appRequestId = requestIdRef.current;
      let file: File;

      try {
        file = await readIncomingDrawingFile(incoming, controller.signal);
      } catch (error) {
        if (
          incomingRequestId === incomingRequestIdRef.current &&
          appRequestId === requestIdRef.current
        ) {
          requestIdRef.current += 1;
          conversionAbortRef.current?.abort();
          conversionAbortRef.current = null;
          pendingImportRef.current = null;
          lastDrawingRef.current = null;
          setLibraryOpen(false);
          setState({
            status: "error",
            error: toAppError(error, "FILE_READ_FAILED"),
          });
        }
        return;
      } finally {
        if (incomingAbortRef.current === controller) incomingAbortRef.current = null;
        void incomingDrawingPlugin
          .acknowledgeDrawing({ id: incoming.id })
          .catch(() => undefined);
      }

      if (
        incomingRequestId === incomingRequestIdRef.current &&
        appRequestId === requestIdRef.current
      ) {
        await openFile(file);
      }
    },
    [openFile],
  );

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let disposed = false;
    let listener: PluginListenerHandle | null = null;

    void (async () => {
      listener = await incomingDrawingPlugin.addListener(
        "drawingReceived",
        (drawing) => {
          if (!disposed) {
            void openIncomingDrawing(drawing);
          }
        },
      );

      if (disposed) {
        await listener.remove();
        return;
      }

      const { drawing } = await incomingDrawingPlugin.getPendingDrawing();
      if (drawing && !disposed) {
        await openIncomingDrawing(drawing);
      }
    })().catch(() => {
      if (!disposed) {
        console.error("Incoming drawing bridge could not be initialized.");
      }
    });

    return () => {
      disposed = true;
      if (listener) {
        void listener.remove();
      }
    };
  }, [openIncomingDrawing]);

  const handleProgress = useCallback(
    (phase: LoadingPhase, processed: number, total: number) => {
      setState((current) => {
        if (current.status !== "loading") {
          return current;
        }

        return {
          ...current,
          phase,
          progress:
            total > 0 && Number.isFinite(processed) && Number.isFinite(total)
              ? Math.min(1, Math.max(0, processed / total)) : null,
        };
      });
    },
    [],
  );

  const handleViewerReady = useCallback(() => {
    const pending = pendingImportRef.current;
    pendingImportRef.current = null;
    if (pending && pending.requestId === requestIdRef.current) {
      void importDrawingToLibrary(pending.file, ROOT_FOLDER_ID).catch(() => {
        if (pending.requestId === requestIdRef.current) setLibraryNotice(true);
      });
    }
    setState((current) => {
      if (current.status !== "loading" || !current.renderFile) {
        return current;
      }
      return {
        status: "viewer",
        drawing: current.drawing,
        renderFile: current.renderFile,
      };
    });
  }, []);

  const handleViewerError = useCallback((error: unknown) => {
    pendingImportRef.current = null;
    setState({
      status: "error",
      error: toAppError(error, "DXF_OPEN_FAILED"),
    });
  }, []);

  const closeDrawing = useCallback(() => {
    incomingRequestIdRef.current += 1;
    requestIdRef.current += 1;
    conversionAbortRef.current?.abort();
    conversionAbortRef.current = null;
    incomingAbortRef.current?.abort();
    incomingAbortRef.current = null;
    pendingImportRef.current = null;
    lastDrawingRef.current = null;
    setLibraryNotice(false);
    setState({ status: "home" });
  }, []);

  const handleBack = useCallback(() => {
    if (libraryOpen) {
      setLibraryOpen(false);
    } else if (state.status !== "home") {
      closeDrawing();
    } else if (Capacitor.isNativePlatform()) {
      void incomingDrawingPlugin.exitApp().catch(() => undefined);
    }
  }, [closeDrawing, libraryOpen, state.status]);
  useBackNavigation(handleBack);

  useEffect(() => {
    let disposed = false;
    let backListener: PluginListenerHandle | null = null;
    if (Capacitor.isNativePlatform()) {
      void incomingDrawingPlugin.addListener("backPressed", dispatchBackNavigation)
        .then((listener) => {
          if (disposed) void listener.remove();
          else backListener = listener;
        }).catch(() => undefined);
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        dispatchBackNavigation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      disposed = true;
      void backListener?.remove();
      window.removeEventListener("keydown", onKeyDown);
      requestIdRef.current += 1;
      incomingRequestIdRef.current += 1;
      conversionAbortRef.current?.abort();
      incomingAbortRef.current?.abort();
    };
  }, []);

  const sendCommand = useCallback((command: ViewerCommand) => {
    viewerRef.current?.execute(command);
  }, []);

  const canvasRequestId = requestIdRef.current;
  const canvas =
    (state.status === "loading" && state.renderFile) ||
    state.status === "viewer" ? (
      <Suspense fallback={null}>
        <DrawingCanvas
          ref={viewerRef}
          key={requestIdRef.current}
          file={
            state.status === "viewer" ? state.renderFile : state.renderFile!
          }
          onProgress={(phase, processed, total) => {
            if (canvasRequestId === requestIdRef.current) handleProgress(phase, processed, total);
          }}
          onReady={() => {
            if (canvasRequestId === requestIdRef.current) handleViewerReady();
          }}
          onError={(error) => {
            if (canvasRequestId === requestIdRef.current) handleViewerError(error);
          }}
        />
      </Suspense>
    ) : null;

  let content;
  if (state.status === "error") {
    content = (
      <>
        <header className="topbar minimal">
          <div className="wordmark">izCAD</div>
          <LanguageSwitch />
        </header>
        <ErrorScreen
          error={state.error}
          onOpenLibrary={() => setLibraryOpen(true)}
          onRetry={lastDrawingRef.current ? () => {
            const last = lastDrawingRef.current;
            if (last) void openFile(last.file, last.libraryEntryId);
          } : undefined}
          onClose={closeDrawing}
        />
      </>
    );
  } else if (state.status === "home") {
    content = (
      <>
        <header className="topbar">
          <div className="wordmark">
            iz<span>CAD</span>
          </div>
          <LanguageSwitch />
        </header>

        <main className="hero">
          <div className="hero-graphic" aria-hidden="true">
            <div className="cad-card card-back">
              <span />
              <span />
              <span />
            </div>
            <div className="cad-card card-front">
              <svg viewBox="0 0 220 160">
                <path d="M26 124V42h56l25 22h87v60H26Z" />
                <path d="M43 108V60h31l22 18h78v30H43Z" />
                <circle cx="145" cy="92" r="10" />
                <path d="M111 78v30M128 78v30" />
              </svg>
              <span className="format-chip">DXF</span>
            </div>
          </div>

          <section className="hero-copy">
            <p className="eyebrow">ANDROID CAD VIEWER</p>
            <h1>{t("tagline")}</h1>
            <p className="lead">{t("description")}</p>
            <button
              type="button"
              className="open-button"
              onClick={() => setLibraryOpen(true)}
            >
              <FolderIcon />
              <span>{t("myDrawings")}</span>
            </button>

            <div className="feature-row">
              <div>
                <span className="feature-dot" />
                <strong>{t("supportedFormats")}</strong>
              </div>
              <div>
                <ShieldIcon />
                <strong>{t("offline")}</strong>
              </div>
            </div>
            <p className="privacy-copy">{t("privateFiles")}</p>
            <nav className="legal-links" aria-label={t("privacyAndLicenses")}>
              <a
                href="https://sites.google.com/view/izcad-gp-pp/ana-sayfa"
                target="_blank"
                rel="noreferrer"
                onClick={openExternalLink}
              >
                {t("privacyAndLicenses")}
              </a>
              <span aria-hidden="true">•</span>
              <a
                href="https://github.com/orgofjs/izCAD"
                target="_blank"
                rel="noreferrer"
                onClick={openExternalLink}
              >
                {t("sourceCode")}
              </a>
            </nav>
            <p className="version-copy">{t("appVersion")} {version.replace(/\.0$/, "")}</p>
          </section>
        </main>
      </>
    );
  } else if (state.status === "loading") {
    content = (
        <LoadingScreen
          phase={state.phase}
          progress={state.progress}
          fileName={state.drawing.name}
          onCancel={closeDrawing}
        />
    );
  } else {
    content = (
    <>
      <header className="viewer-header">
        <div className="file-heading">
          <span className="file-format">{state.drawing.format}</span>
          <div>
            <strong>{state.drawing.name}</strong>
            <span>
              {t("fileSize")}: {formatBytes(state.drawing.size, locale)}
            </span>
          </div>
        </div>
        <div className="viewer-header-actions">
          <button
            type="button"
            className="open-button compact"
            aria-label={t("myDrawings")}
            title={t("myDrawings")}
            onClick={() => setLibraryOpen(true)}
          >
            <FolderIcon />
            <span>{t("myDrawings")}</span>
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t("close")}
            title={t("close")}
            onClick={closeDrawing}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <ViewerToolbar onCommand={sendCommand} />
      {libraryNotice ? <div className="library-notice" role="status">{t("librarySaveFailed")}</div> : null}
    </>
    );
  }

  return (
    <div className={`app-shell ${state.status === "home" ? "home" : "viewer-shell"}`}>
      <div className="canvas-layer" inert={libraryOpen} aria-hidden={libraryOpen}>{canvas}</div>
      <div className="app-content" hidden={libraryOpen}>{content}</div>
      {libraryOpen ? (
        <div className="library-overlay">
          <DrawingLibrary onClose={() => setLibraryOpen(false)} onOpen={openFile} />
        </div>
      ) : null}
    </div>
  );
}
