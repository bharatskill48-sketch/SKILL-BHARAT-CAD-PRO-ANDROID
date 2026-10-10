import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DRAWING_FILE_ACCEPT, isArchiveFormat } from "../files/fileTypes";
import { ArchiveError, openArchive, type ArchiveEntry, type ArchiveSession } from "../files/archive";
import { throwIfArchiveAborted } from "../files/archiveRules";
import { useBackNavigation } from "../app/backNavigation";
import { filterAndSortEntries, type LibrarySort } from "./libraryPresentation";
import { useI18n } from "../i18n/I18nProvider";
import {
  copyLibraryEntry,
  createLibraryFolder,
  deleteLibraryEntry,
  getLibraryPath,
  importDrawingToLibrary,
  importArchiveFilesToLibrary,
  LibraryError,
  type LibraryEntry,
  type LibraryFolderEntry,
  listLibraryChildren,
  listLibraryFolders,
  listRecentDrawings,
  moveLibraryEntry,
  openLibraryDrawing,
  renameLibraryEntry,
  requestPersistentLibraryStorage,
  ROOT_FOLDER_ID,
  unavailableDestinationIds,
} from "../library/drawingLibrary";
import type { TranslationKey } from "../i18n/translations";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  DrawingFileIcon,
  ImportIcon,
  MoreIcon,
  MoveIcon,
  PlainFolderIcon,
  PlusIcon,
  RenameIcon,
  TrashIcon,
} from "./Icons";
import { LanguageSwitch } from "./LanguageSwitch";

type Props = {
  onOpen(file: File, libraryEntryId: string): void | Promise<void>;
  onClose(): void;
  incomingArchive?: File | null;
  onIncomingArchiveHandled?(): void;
};

type ArchiveDialog = {
  file: File;
  phase: "loading" | "ready" | "extracting" | "error";
  entries: ArchiveEntry[];
  selected: Set<string>;
  progress: number;
  error: string | null;
};

type TextDialogState =
  | { type: "create-folder"; value: string }
  | { type: "rename"; value: string; entry: LibraryEntry };

type DestinationDialogState = {
  operation: "copy" | "move";
  entry: LibraryEntry;
};

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
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(value)} ${units[exponent - 1]}`;
}

function formatDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(timestamp);
}

function stopPropagation(event: MouseEvent<HTMLButtonElement>): void {
  event.stopPropagation();
}

function libraryErrorKey(error: unknown): TranslationKey {
  if (error instanceof ArchiveError) {
    return error.code === "ENCRYPTED" ? "archiveEncryptedUnsupported" :
      error.code === "LIMIT_EXCEEDED" ? "archiveLimitExceeded" :
        error.code === "INVALID_PATH" ? "archiveInvalidPath" : "archiveOpenFailed";
  }
  if (!(error instanceof LibraryError)) {
    return "libraryOperationFailed";
  }

  switch (error.code) {
    case "INVALID_NAME":
      return "invalidLibraryName";
    case "NAME_EXISTS":
      return "libraryNameExists";
    case "INVALID_DESTINATION":
      return "invalidLibraryDestination";
    case "STORAGE_FULL":
      return "libraryStorageFull";
    case "INVALID_FILE":
      return "libraryInvalidFile";
    case "FILE_TOO_LARGE":
      return "libraryFileTooLarge";
    case "STORAGE_UNAVAILABLE":
      return "libraryStorageUnavailable";
    case "NOT_FOUND":
      return "libraryNotFound";
  }
}

function folderLabel(
  folder: LibraryFolderEntry,
  folders: readonly LibraryFolderEntry[],
  rootLabel: string,
): string {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const names = [folder.name];
  const visited = new Set([folder.id]);
  let parentId = folder.parentId;

  while (parentId !== ROOT_FOLDER_ID) {
    if (visited.has(parentId)) {
      break;
    }
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) {
      break;
    }
    names.unshift(parent.name);
    parentId = parent.parentId;
  }

  return `${rootLabel} / ${names.join(" / ")}`;
}

export function DrawingLibrary({ onOpen, onClose, incomingArchive, onIncomingArchiveHandled }: Props) {
  const { locale, t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const loadIdRef = useRef(0);
  const archiveControllerRef = useRef<AbortController | null>(null);
  const archiveSessionRef = useRef<ArchiveSession | null>(null);
  const archiveGenerationRef = useRef(0);
  const [archiveDialog, setArchiveDialog] = useState<ArchiveDialog | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState(ROOT_FOLDER_ID);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [recentEntries, setRecentEntries] = useState<LibraryEntry[]>([]);
  const [path, setPath] = useState<LibraryFolderEntry[]>([]);
  const [allFolders, setAllFolders] = useState<LibraryFolderEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<LibraryEntry | null>(null);
  const [textDialog, setTextDialog] = useState<TextDialogState | null>(null);
  const [destinationDialog, setDestinationDialog] =
    useState<DestinationDialogState | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<LibraryEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("name");
  const [noticeError, setNoticeError] = useState(false);
  const visibleEntries = useMemo(
    () => filterAndSortEntries(entries, query, sort, locale),
    [entries, query, sort, locale],
  );
  const modal = archiveDialog ? "archive" : textDialog ? "text" : destinationDialog ? "destination" : deleteEntry ? "delete" : selectedEntry ? "actions" : null;

  const reload = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setLoading(true);
    try {
      const [children, folderPath, recent, folders] = await Promise.all([
        listLibraryChildren(currentFolderId),
        getLibraryPath(currentFolderId),
        currentFolderId === ROOT_FOLDER_ID
          ? listRecentDrawings()
          : Promise.resolve([]),
        listLibraryFolders(),
      ]);
      if (loadId !== loadIdRef.current) return;
      setEntries(children);
      setPath(folderPath);
      setRecentEntries(recent);
      setAllFolders(folders);
    } catch (error) {
      if (loadId !== loadIdRef.current) return;
      setNotice(t(libraryErrorKey(error)));
      setNoticeError(true);
      setEntries([]);
    } finally {
      if (loadId === loadIdRef.current) setLoading(false);
    }
  }, [currentFolderId, t]);

  const closeArchive = useCallback(() => {
    archiveGenerationRef.current += 1;
    archiveControllerRef.current?.abort();
    archiveControllerRef.current = null;
    archiveSessionRef.current?.close();
    archiveSessionRef.current = null;
    setArchiveDialog(null);
  }, []);

  const prepareArchive = useCallback(async (file: File, entryId?: string) => {
    archiveControllerRef.current?.abort();
    archiveSessionRef.current?.close();
    archiveSessionRef.current = null;
    const generation = ++archiveGenerationRef.current;
    const controller = new AbortController();
    archiveControllerRef.current = controller;
    setArchiveDialog({ file, phase: "loading", entries: [], selected: new Set(), progress: 0, error: null });
    try {
      const session = await openArchive(file, controller.signal);
      if (controller.signal.aborted || generation !== archiveGenerationRef.current) { session.close(); return; }
      archiveSessionRef.current = session;
      // Retain the original archive independently from its extracted documents.
      if (!entryId) {
        await importDrawingToLibrary(file, currentFolderId);
        await reload();
      }
      if (controller.signal.aborted || generation !== archiveGenerationRef.current) return;
      setArchiveDialog({ file, phase: "ready", entries: session.entries,
        selected: new Set(session.entries.filter((entry) => entry.supported).map((entry) => entry.path)), progress: 0, error: null });
    } catch (error) {
      if (controller.signal.aborted || generation !== archiveGenerationRef.current) return;
      archiveSessionRef.current?.close();
      archiveSessionRef.current = null;
      setArchiveDialog({ file, phase: "error", entries: [], selected: new Set(), progress: 0, error: t(libraryErrorKey(error)) });
    }
  }, [currentFolderId, reload, t]);

  useEffect(() => {
    if (!incomingArchive) return;
    void prepareArchive(incomingArchive);
    onIncomingArchiveHandled?.();
  }, [incomingArchive, onIncomingArchiveHandled, prepareArchive]);

  useEffect(() => () => {
    archiveGenerationRef.current += 1;
    archiveControllerRef.current?.abort();
    archiveSessionRef.current?.close();
  }, []);

  const extractArchive = useCallback(async () => {
    if (!archiveDialog || archiveDialog.phase !== "ready" || !archiveDialog.selected.size || !archiveSessionRef.current) return;
    const session = archiveSessionRef.current;
    const controller = new AbortController();
    archiveControllerRef.current = controller;
    const generation = archiveGenerationRef.current;
    const selection = Array.from(archiveDialog.selected);
    setArchiveDialog((dialog) => dialog ? { ...dialog, phase: "extracting", progress: 0 } : null);
    try {
      const files = await session.extract(selection, controller.signal, (done, total) => {
        if (generation === archiveGenerationRef.current) setArchiveDialog((dialog) => dialog ? { ...dialog, progress: total ? done / total : 0 } : null);
      });
      throwIfArchiveAborted(controller.signal);
      const folderName = archiveDialog.file.name.replace(/\.(?:zip|rar)$/i, "") || "Archive";
      const result = await importArchiveFilesToLibrary(files, currentFolderId, folderName, controller.signal);
      if (controller.signal.aborted || generation !== archiveGenerationRef.current) return;
      await reload();
      closeArchive();
      setCurrentFolderId(result.folder.id);
      setNotice(`${t("archiveImported")}: ${result.entries.length}`);
      setNoticeError(false);
    } catch (error) {
      if (controller.signal.aborted || generation !== archiveGenerationRef.current) return;
      setArchiveDialog((dialog) => dialog ? { ...dialog, phase: session.closed ? "error" : "ready", error: t(libraryErrorKey(error)) } : null);
    }
  }, [archiveDialog, closeArchive, currentFolderId, reload, t]);

  useEffect(() => {
    void requestPersistentLibraryStorage();
  }, []);

  useEffect(() => {
    void reload();
    return () => { loadIdRef.current += 1; };
  }, [reload]);

  useEffect(() => { setQuery(""); }, [currentFolderId]);

  useEffect(() => {
    if (!modal) return;
    const dialog = shellRef.current?.querySelector<HTMLElement>("[aria-modal='true']");
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']"));
    controls()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape" && modal === "archive") { event.preventDefault(); closeArchive(); return; }
      if (event.key !== "Tab") return;
      const elements = controls();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    dialog.addEventListener("keydown", trapFocus);
    return () => { dialog.removeEventListener("keydown", trapFocus); previous?.focus(); };
  }, [closeArchive, modal]);

  useEffect(() => {
    if (!notice || noticeError) {
      return;
    }

    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice, noticeError]);

  const runOperation = useCallback(
    async (operation: () => Promise<void>, successKey?: TranslationKey) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        await operation();
        if (successKey) {
          setNotice(t(successKey));
          setNoticeError(false);
        }
        await reload();
      } catch (error) {
        setNotice(t(libraryErrorKey(error)));
        setNoticeError(true);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [reload, t],
  );

  const openEntry = useCallback(
    async (entry: LibraryEntry) => {
      if (busyRef.current || loading) return;
      if (entry.kind === "folder") {
        setCurrentFolderId(entry.id);
        return;
      }

      busyRef.current = true;
      setBusy(true);
      try {
        const file = await openLibraryDrawing(entry.id);
        if (isArchiveFormat(entry.format)) await prepareArchive(file, entry.id);
        else await onOpen(file, entry.id);
      } catch (error) {
        setNotice(t(libraryErrorKey(error)));
        setNoticeError(true);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [loading, onOpen, prepareArchive, t],
  );

  const handleImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0 || busyRef.current) {
        return;
      }

      busyRef.current = true;
      setBusy(true);
      try {
        if (files.length === 1) {
          const entry = await importDrawingToLibrary(files[0], currentFolderId);
          const storedFile = await openLibraryDrawing(entry.id);
          if (isArchiveFormat(entry.format)) await prepareArchive(storedFile, entry.id);
          else await onOpen(storedFile, entry.id);
        } else {
          let imported = 0;
          let failed = 0;
          let firstError: unknown;
          for (const file of files) {
            try {
              await importDrawingToLibrary(file, currentFolderId);
              imported += 1;
            } catch (error) {
              firstError ??= error;
              failed += 1;
            }
          }
          await reload();
          setNotice(`${t("importedDrawings")}: ${imported}${failed ? ` · ${t("failedDrawings")}: ${failed}. ${t(libraryErrorKey(firstError))}` : ""}`);
          setNoticeError(failed > 0);
        }
      } catch (error) {
        setNotice(t(libraryErrorKey(error)));
        setNoticeError(true);
        await reload();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [currentFolderId, onOpen, prepareArchive, reload, t],
  );

  const submitTextDialog = useCallback(() => {
    if (!textDialog) {
      return;
    }

    const dialog = textDialog;
    setTextDialog(null);
    if (dialog.type === "create-folder") {
      void runOperation(
        () => createLibraryFolder(currentFolderId, dialog.value).then(() => undefined),
        "folderCreated",
      );
      return;
    }

    void runOperation(
      () => renameLibraryEntry(dialog.entry.id, dialog.value),
      "renamed",
    );
  }, [currentFolderId, runOperation, textDialog]);

  const unavailableDestinations = useMemo(
    () =>
      destinationDialog
        ? unavailableDestinationIds(destinationDialog.entry, allFolders)
        : new Set<string>(),
    [allFolders, destinationDialog],
  );

  const chooseDestination = useCallback(
    (destinationFolderId: string) => {
      if (!destinationDialog) {
        return;
      }

      const { entry, operation } = destinationDialog;
      setDestinationDialog(null);
      void runOperation(
        () =>
          operation === "copy"
            ? copyLibraryEntry(entry.id, destinationFolderId)
            : moveLibraryEntry(entry.id, destinationFolderId),
        operation === "copy" ? "copied" : "moved",
      );
    },
    [destinationDialog, runOperation],
  );

  const goBack = useCallback(() => {
    if (archiveDialog) { closeArchive(); return; }
    if (busyRef.current) return;
    if (textDialog) { setTextDialog(null); return; }
    if (destinationDialog) { setDestinationDialog(null); return; }
    if (deleteEntry) { setDeleteEntry(null); return; }
    if (selectedEntry) { setSelectedEntry(null); return; }
    if (query) { setQuery(""); return; }
    if (path.length === 0) {
      onClose();
      return;
    }

    setCurrentFolderId(
      path.length === 1 ? ROOT_FOLDER_ID : path[path.length - 2].id,
    );
  }, [archiveDialog, closeArchive, deleteEntry, destinationDialog, onClose, path, query, selectedEntry, textDialog]);
  useBackNavigation(goBack, true);

  return (
    <div ref={shellRef} className="app-shell library-shell" aria-busy={busy || loading}>
      <header className="library-topbar" inert={modal !== null}>
        <button
          type="button"
          className="icon-button"
          aria-label={t("back")}
          title={t("back")}
          onClick={goBack}
          disabled={busy || loading}
        >
          <ArrowLeftIcon />
        </button>
        <div className="library-heading">
          <strong>{t("libraryTitle")}</strong>
          <span>{t("librarySubtitle")}</span>
        </div>
        <LanguageSwitch />
        <button
          type="button"
          className="icon-button library-close"
          aria-label={t("closeLibrary")}
          title={t("closeLibrary")}
          onClick={onClose}
          disabled={busy}
        >
          <CloseIcon />
        </button>
      </header>

      <main className="library-content" inert={modal !== null}>
        <nav className="library-breadcrumbs" aria-label={t("mainFolder")}>
          <button
            type="button"
            className={path.length === 0 ? "active" : ""}
            onClick={() => setCurrentFolderId(ROOT_FOLDER_ID)}
            disabled={busy || loading}
          >
            {t("mainFolder")}
          </button>
          {path.map((folder, index) => (
            <span key={folder.id}>
              <ChevronRightIcon />
              <button
                type="button"
                className={index === path.length - 1 ? "active" : ""}
                onClick={() => setCurrentFolderId(folder.id)}
                disabled={busy || loading}
              >
                {folder.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="library-primary-actions">
          <button
            type="button"
            className="open-button compact library-import-button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <ImportIcon />
            <span>{t("importDrawing")}</span>
          </button>
          <button
            type="button"
            className="library-secondary-button"
            disabled={busy}
            onClick={() =>
              setTextDialog({ type: "create-folder", value: "" })
            }
          >
            <PlusIcon />
            <span>{t("newFolder")}</span>
          </button>
          <input
            ref={inputRef}
            hidden
            type="file"
            accept={DRAWING_FILE_ACCEPT}
            multiple
            onChange={handleImport}
          />
        </div>

        {recentEntries.length > 0 && !query ? (
          <section className="recent-section">
            <h2>{t("recentDrawings")}</h2>
            <div className="recent-list">
              {recentEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="recent-card"
                  disabled={busy}
                  onClick={() => void openEntry(entry)}
                >
                  <span className="recent-format">{entry.kind === "drawing" ? entry.format : ""}</span>
                  <strong>{entry.name}</strong>
                  {entry.kind === "drawing" ? (
                    <small>{formatBytes(entry.size, locale)}</small>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="library-entries-section">
          <h2>{t("filesAndFolders")}</h2>
          <div className="library-filter-row">
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder={t("searchLibrary")} aria-label={t("searchLibrary")} />
            <select value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)} aria-label={t("sortLibrary")}>
              <option value="name">{t("sortName")}</option>
              <option value="recent">{t("sortRecent")}</option>
              <option value="size">{t("sortSize")}</option>
            </select>
          </div>
          {loading ? (
            <div className="library-loading" aria-label={t("loading")}>
              <span />
              <span />
              <span />
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="library-empty">
              <PlainFolderIcon />
              <strong>{t(query ? "noSearchResults" : "emptyFolderTitle")}</strong>
              {query ? <button type="button" className="cancel-button" onClick={() => setQuery("")}>{t("clearSearch")}</button> : <p>{t("emptyFolderDescription")}</p>}
            </div>
          ) : (
            <div className="library-entry-list">
              {visibleEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="library-entry"
                >
                  <button type="button" className="library-entry-open" disabled={busy}
                    onClick={() => void openEntry(entry)}>
                  <span
                    className={`library-entry-icon ${entry.kind}`}
                    aria-hidden="true"
                  >
                    {entry.kind === "folder" ? (
                      <PlainFolderIcon />
                    ) : (
                      <DrawingFileIcon />
                    )}
                  </span>
                  <span className="library-entry-copy">
                    <strong>{entry.name}</strong>
                    <small>
                      {entry.kind === "folder"
                        ? formatDate(entry.updatedAt, locale)
                        : `${entry.format.toUpperCase()} · ${formatBytes(entry.size, locale)} · ${formatDate(entry.updatedAt, locale)}`}
                    </small>
                  </span>
                  {entry.kind === "folder" ? (
                    <ChevronRightIcon className="entry-chevron" />
                  ) : null}
                  </button>
                  <button
                    type="button"
                    className="entry-more-button"
                    aria-label={`${t("itemActions")}: ${entry.name}`}
                    title={t("itemActions")}
                    disabled={busy}
                    onClick={(event) => {
                      stopPropagation(event);
                      setSelectedEntry(entry);
                    }}
                  >
                    <MoreIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {notice ? (
        <div className="library-notice" role={noticeError ? "alert" : "status"} onClick={() => setNotice(null)}>
          {notice}
        </div>
      ) : null}

      {busy ? (
        <div className="library-busy" aria-hidden="true">
          <span />
        </div>
      ) : null}

      {archiveDialog ? (
        <div className="library-modal-backdrop" onClick={closeArchive}>
          <section className="library-dialog archive-dialog" role="dialog" aria-modal="true"
            aria-label={t("archiveTitle")} onClick={(event) => event.stopPropagation()}>
            <h2>{t("archiveTitle")}</h2>
            <strong>{archiveDialog.file.name}</strong>
            <p>{t("archiveDescription")}</p>
            {archiveDialog.phase === "loading" ? <p className="archive-status" role="status">{t("archiveLoading")}</p> : null}
            {archiveDialog.error ? <p className="archive-status" role="alert">{archiveDialog.error}</p> : null}
            {archiveDialog.entries.length > 0 ? (
              <>
                <div className="archive-selection-actions">
                  <button type="button" disabled={archiveDialog.phase !== "ready"}
                    onClick={() => setArchiveDialog({ ...archiveDialog, selected: new Set(archiveDialog.entries.filter((entry) => entry.supported).map((entry) => entry.path)) })}>{t("archiveSelectAll")}</button>
                  <button type="button" disabled={archiveDialog.phase !== "ready"}
                    onClick={() => setArchiveDialog({ ...archiveDialog, selected: new Set() })}>{t("archiveSelectNone")}</button>
                </div>
                <div className="archive-entry-list">
                  {archiveDialog.entries.map((entry) => (
                    <label key={entry.path} className={`archive-entry${entry.supported ? "" : " archive-unsupported"}`}>
                      <input type="checkbox" checked={archiveDialog.selected.has(entry.path)} disabled={!entry.supported || archiveDialog.phase !== "ready"}
                        onChange={(event) => {
                          const selected = new Set(archiveDialog.selected);
                          if (event.target.checked) selected.add(entry.path); else selected.delete(entry.path);
                          setArchiveDialog({ ...archiveDialog, selected });
                        }} />
                      <span className="archive-entry-copy"><span>{entry.path}{entry.directory ? "/" : ""}</span>
                        <small>{entry.directory ? t("folderName") : `${formatBytes(entry.size, locale)}${entry.supported ? "" : ` · ${t("archiveUnsupportedFile")}`}`}</small></span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}
            {archiveDialog.phase === "ready" && !archiveDialog.entries.some((entry) => entry.supported)
              ? <p className="archive-status">{t("archiveNoSupportedFiles")}</p> : null}
            {archiveDialog.phase === "extracting" ? <p className="archive-status" role="status">{t("archiveImporting")} {Math.round(archiveDialog.progress * 100)}%</p> : null}
            <div className="dialog-actions">
              <button type="button" className="dialog-cancel" onClick={closeArchive}>{t("cancel")}</button>
              <button type="button" className="dialog-confirm" disabled={archiveDialog.phase !== "ready" || !archiveDialog.selected.size}
                onClick={() => void extractArchive()}>{t("archiveExtract")} ({archiveDialog.selected.size})</button>
            </div>
          </section>
        </div>
      ) : null}

      {selectedEntry ? (
        <div
          className="library-modal-backdrop action-sheet-backdrop"
          onClick={() => setSelectedEntry(null)}
        >
          <section
            className="library-action-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("itemActions")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="action-sheet-handle" />
            <strong className="action-sheet-title">{selectedEntry.name}</strong>
            <div className="action-sheet-grid">
              <button
                type="button"
                onClick={() => {
                  setTextDialog({
                    type: "rename",
                    value: selectedEntry.name,
                    entry: selectedEntry,
                  });
                  setSelectedEntry(null);
                }}
              >
                <RenameIcon />
                <span>{t("rename")}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDestinationDialog({
                    operation: "copy",
                    entry: selectedEntry,
                  });
                  setSelectedEntry(null);
                }}
              >
                <CopyIcon />
                <span>{t("copy")}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDestinationDialog({
                    operation: "move",
                    entry: selectedEntry,
                  });
                  setSelectedEntry(null);
                }}
              >
                <MoveIcon />
                <span>{t("move")}</span>
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setDeleteEntry(selectedEntry);
                  setSelectedEntry(null);
                }}
              >
                <TrashIcon />
                <span>{t("delete")}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {textDialog ? (
        <div
          className="library-modal-backdrop"
          onClick={() => setTextDialog(null)}
        >
          <form
            className="library-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t(textDialog.type === "create-folder" ? "newFolder" : "rename")}
            onSubmit={(event) => {
              event.preventDefault();
              submitTextDialog();
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>
              {textDialog.type === "create-folder"
                ? t("newFolder")
                : t("rename")}
            </h2>
            <label>
              <span>
                {textDialog.type === "create-folder"
                  ? t("folderName")
                  : t("rename")}
              </span>
              <input
                autoFocus
                value={textDialog.value}
                maxLength={220}
                onChange={(event) =>
                  setTextDialog({ ...textDialog, value: event.target.value })
                }
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="dialog-cancel"
                onClick={() => setTextDialog(null)}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                className="dialog-confirm"
                disabled={!textDialog.value.trim()}
              >
                {textDialog.type === "create-folder"
                  ? t("create")
                  : t("save")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {destinationDialog ? (
        <div
          className="library-modal-backdrop"
          onClick={() => setDestinationDialog(null)}
        >
          <section
            className="library-dialog destination-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("chooseDestination")}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{t("chooseDestination")}</h2>
            <div className="destination-list">
              <button
                type="button"
                disabled={unavailableDestinations.has(ROOT_FOLDER_ID)}
                onClick={() => chooseDestination(ROOT_FOLDER_ID)}
              >
                <PlainFolderIcon />
                <span>{t("mainFolder")}</span>
              </button>
              {allFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  disabled={unavailableDestinations.has(folder.id)}
                  onClick={() => chooseDestination(folder.id)}
                >
                  <PlainFolderIcon />
                  <span>{folderLabel(folder, allFolders, t("mainFolder"))}</span>
                </button>
              ))}
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="dialog-cancel"
                onClick={() => setDestinationDialog(null)}
              >
                {t("cancel")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {deleteEntry ? (
        <div
          className="library-modal-backdrop"
          onClick={() => setDeleteEntry(null)}
        >
          <section
            className="library-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={t("deleteTitle")}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{t("deleteTitle")}</h2>
            <p>
              {deleteEntry.kind === "folder"
                ? t("deleteFolderDescription")
                : t("deleteDrawingDescription")}
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="dialog-cancel"
                onClick={() => setDeleteEntry(null)}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                className="dialog-delete"
                onClick={() => {
                  const entry = deleteEntry;
                  setDeleteEntry(null);
                  void runOperation(
                    () => deleteLibraryEntry(entry.id),
                    "deleted",
                  );
                }}
              >
                {t("delete")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
