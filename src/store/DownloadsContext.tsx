import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { DownloadItem, DownloadOption, ErrorKind, VideoMetadata } from '../types';
import { loadJSON, saveJSON } from '../services/persistence';
import { AppError, isOnline, isOnWifi } from '../services/http';
import {
  deleteFile,
  ensureDownloadDir,
  fileSize,
  FileSystem,
  freeSpace,
  readHeader,
  tempUriFor,
} from '../services/downloads/fileStore';
import { assetExists, deleteSavedVideo, hasMediaPermission, saveToLibrary } from '../services/downloads/mediaSaver';
import { runDownload, type EngineDeps } from '../services/downloads/engine';
import { makeId } from '../utils/format';
import { useSettings } from './SettingsContext';
import { useHistory } from './HistoryContext';

interface DownloadsValue {
  items: DownloadItem[];
  loaded: boolean;
  enqueue: (meta: VideoMetadata, option: DownloadOption) => DownloadItem;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => void;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => void;
  remove: (id: string, alsoDeleteFile?: boolean) => Promise<void>;
  clearFinished: () => void;
  /** Re-check that completed downloads still exist on the device. */
  verifyFiles: () => Promise<void>;
  /** Download a completed-but-missing file again from the same source. */
  redownload: (id: string) => void;
}

const DownloadsContext = createContext<DownloadsValue | null>(null);

const ACTIVE: DownloadItem['status'][] = ['downloading', 'saving'];

export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const itemsRef = useRef<DownloadItem[]>([]);
  const tasks = useRef(new Map<string, FileSystem.DownloadResumable>());
  const stopReason = useRef(new Map<string, 'pause' | 'cancel'>());
  const starting = useRef(new Set<string>());
  const { settings } = useSettings();
  const history = useHistory();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // ---- state helpers -------------------------------------------------------
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePersist = useCallback(() => {
    if (persistTimer.current) return;
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      saveJSON('downloads', itemsRef.current);
    }, 800);
  }, []);

  const setAll = useCallback(
    (updater: (prev: DownloadItem[]) => DownloadItem[]) => {
      setItems((prev) => {
        const next = updater(prev);
        itemsRef.current = next;
        return next;
      });
      schedulePersist();
    },
    [schedulePersist],
  );

  const patch = useCallback(
    (id: string, changes: Partial<DownloadItem>) => {
      setAll((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes, updatedAt: Date.now() } : it)));
    },
    [setAll],
  );

  const get = (id: string) => itemsRef.current.find((i) => i.id === id);

  const fail = useCallback(
    (id: string, kind: ErrorKind, message: string) => {
      patch(id, { status: 'failed', errorKind: kind, errorMessage: message });
      const it = get(id);
      if (it) {
        history.add({
          url: it.sourceUrl,
          title: it.title,
          providerName: it.providerName,
          thumbnailUrl: it.thumbnailUrl,
          outcome: 'download-failed',
          detail: message,
        });
      }
    },
    [patch, history],
  );

  // ---- load persisted items & recover from interruptions --------------------
  useEffect(() => {
    (async () => {
      const stored = await loadJSON<DownloadItem[]>('downloads', []);
      const recovered = await Promise.all(
        stored.map(async (it) => {
          if (it.status === 'downloading') {
            const written = await fileSize(it.tempUri);
            return {
              ...it,
              status: 'paused' as const,
              bytesWritten: written,
              errorKind: 'interrupted' as const,
              errorMessage: it.acceptsRanges
                ? 'Download was interrupted when the app closed. Tap Resume to continue.'
                : 'Download was interrupted. This server does not support resuming, so it will restart from the beginning.',
            };
          }
          if (it.status === 'saving') {
            return {
              ...it,
              status: 'failed' as const,
              errorKind: 'interrupted' as const,
              errorMessage: 'Saving to your device was interrupted. Tap Retry to finish saving.',
            };
          }
          return it;
        }),
      );
      itemsRef.current = recovered;
      setItems(recovered);
      setLoaded(true);
      saveJSON('downloads', recovered);
    })();
  }, []);

  // Flush state when the app goes to background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') saveJSON('downloads', itemsRef.current);
    });
    return () => sub.remove();
  }, []);

  // ---- saving to shared storage ---------------------------------------------
  const saveCompleted = useCallback(
    async (id: string) => {
      const it = get(id);
      if (!it) return;
      patch(id, { status: 'saving', errorKind: undefined, errorMessage: undefined });
      try {
        const { assetId, location } = await saveToLibrary(it.tempUri);
        await deleteFile(it.tempUri);
        patch(id, { status: 'completed', assetId, savedLocation: location, completedAt: Date.now() });
        history.add({
          url: it.sourceUrl,
          title: it.title,
          providerName: it.providerName,
          thumbnailUrl: it.thumbnailUrl,
          outcome: 'downloaded',
          detail: location,
        });
      } catch (e) {
        const err = e instanceof AppError ? e : new AppError('unknown', String(e));
        // Keep the downloaded file so Retry only needs to save again.
        fail(id, err.kind, err.message);
      }
    },
    [patch, fail, history],
  );

  // ---- the actual download (logic lives in services/downloads/engine.ts) ----
  const start = useCallback(
    async (id: string) => {
      if (starting.current.has(id) || tasks.current.has(id)) return;
      starting.current.add(id);
      try {
        const it = get(id);
        if (!it) return;

        const deps: EngineDeps = {
          isOnline,
          isOnWifi,
          ensureDir: ensureDownloadDir,
          fileSize,
          deleteFile,
          freeSpace,
          readHeader: (uri) => readHeader(uri),
          createTask: (url, fileUri, onProgress, resumeData) => {
            const task = FileSystem.createDownloadResumable(
              url,
              fileUri,
              {},
              ({ totalBytesWritten, totalBytesExpectedToWrite }) =>
                onProgress(totalBytesWritten, totalBytesExpectedToWrite),
              resumeData,
            );
            tasks.current.set(id, task);
            return task;
          },
        };

        const outcome = await runDownload(
          {
            url: it.url,
            tempUri: it.tempUri,
            totalBytes: it.totalBytes,
            acceptsRanges: it.acceptsRanges,
            wifiOnly: settingsRef.current.wifiOnly,
          },
          deps,
          {
            onStarted: (_task, bytesWritten) => {
              starting.current.delete(id);
              patch(id, { status: 'downloading', bytesWritten, errorKind: undefined, errorMessage: undefined });
            },
            onProgress: (bytesWritten, totalBytes) => patch(id, { bytesWritten, totalBytes }),
          },
        );
        tasks.current.delete(id);

        switch (outcome.type) {
          case 'stopped': {
            const reason = stopReason.current.get(id);
            stopReason.current.delete(id);
            if (reason !== 'cancel') patch(id, { status: 'paused', bytesWritten: outcome.bytesWritten });
            return;
          }
          case 'restart':
            patch(id, { acceptsRanges: false, bytesWritten: 0, status: 'queued', errorMessage: undefined });
            return;
          case 'failed':
            fail(id, outcome.error.kind, outcome.error.message);
            patch(id, { bytesWritten: outcome.bytesWritten });
            return;
          case 'downloaded':
            patch(id, { bytesWritten: outcome.size, totalBytes: outcome.size });
            await saveCompleted(id);
            return;
        }
      } catch (e) {
        tasks.current.delete(id);
        const err = e instanceof AppError ? e : new AppError('unknown', e instanceof Error ? e.message : String(e));
        fail(id, err.kind, err.message);
      } finally {
        starting.current.delete(id);
      }
    },
    [fail, patch, saveCompleted],
  );

  // ---- queue runner -----------------------------------------------------------
  useEffect(() => {
    if (!loaded) return;
    const active = items.filter((i) => ACTIVE.includes(i.status)).length + starting.current.size;
    const slots = Math.max(0, settings.maxConcurrent - active);
    if (slots === 0) return;
    items
      .filter((i) => i.status === 'queued' && !starting.current.has(i.id))
      .reverse() // oldest first (list is newest-first)
      .slice(0, slots)
      .forEach((i) => start(i.id));
  }, [items, loaded, settings.maxConcurrent, start]);

  // ---- public actions -----------------------------------------------------------
  const enqueue = useCallback(
    (meta: VideoMetadata, option: DownloadOption): DownloadItem => {
      const id = makeId();
      const item: DownloadItem = {
        id,
        title: meta.title,
        provider: meta.provider,
        providerName: meta.providerName,
        sourceUrl: meta.sourceUrl,
        thumbnailUrl: meta.thumbnailUrl,
        url: option.url,
        fileName: option.fileName,
        mimeType: option.mimeType,
        totalBytes: option.sizeBytes ?? 0,
        bytesWritten: 0,
        // Archive.org and Wikimedia support ranges; direct links were probed.
        // Verified again on resume: falls back if the server ignores ranges.
        acceptsRanges: option.acceptsRanges ?? true,
        status: 'queued',
        tempUri: tempUriFor(id, option.fileName),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setAll((prev) => [item, ...prev]);
      history.add({
        url: meta.sourceUrl,
        title: meta.title,
        providerName: meta.providerName,
        thumbnailUrl: meta.thumbnailUrl,
        outcome: 'queued',
        detail: option.label,
      });
      return item;
    },
    [setAll, history],
  );

  const pause = useCallback(
    async (id: string) => {
      const task = tasks.current.get(id);
      if (task) {
        stopReason.current.set(id, 'pause');
        try {
          await task.pauseAsync();
        } catch {
          // Task may have just finished.
        }
      } else if (get(id)?.status === 'queued') {
        patch(id, { status: 'paused' });
      }
    },
    [patch],
  );

  const resume = useCallback(
    (id: string) => patch(id, { status: 'queued', errorKind: undefined, errorMessage: undefined }),
    [patch],
  );

  const cancel = useCallback(
    async (id: string) => {
      const task = tasks.current.get(id);
      if (task) {
        stopReason.current.set(id, 'cancel');
        try {
          await task.pauseAsync();
        } catch {}
        tasks.current.delete(id);
      }
      const it = get(id);
      if (it) await deleteFile(it.tempUri);
      patch(id, { status: 'cancelled', bytesWritten: 0, errorKind: undefined, errorMessage: undefined });
    },
    [patch],
  );

  const retry = useCallback(
    async (id: string) => {
      const it = get(id);
      if (!it) return;
      // If the full file is already on disk, only the save step failed.
      const size = await fileSize(it.tempUri);
      if (size > 0 && it.totalBytes > 0 && size === it.totalBytes) {
        await saveCompleted(id);
        return;
      }
      if (it.status === 'cancelled') await deleteFile(it.tempUri);
      patch(id, { status: 'queued', errorKind: undefined, errorMessage: undefined });
    },
    [patch, saveCompleted],
  );

  const remove = useCallback(
    async (id: string, alsoDeleteFile = false) => {
      const it = get(id);
      if (!it) return;
      if (tasks.current.has(id)) await cancel(id);
      await deleteFile(it.tempUri);
      if (alsoDeleteFile && it.assetId) await deleteSavedVideo(it.assetId);
      setAll((prev) => prev.filter((i) => i.id !== id));
    },
    [cancel, setAll],
  );

  const verifyFiles = useCallback(async () => {
    // Without media permission the check can't see the files; don't mark them missing falsely.
    if (!(await hasMediaPermission())) return;
    const completed = itemsRef.current.filter((i) => i.status === 'completed' && i.assetId);
    for (const it of completed) {
      const exists = await assetExists(it.assetId!);
      if (exists === !it.fileMissing) continue;
      patch(it.id, { fileMissing: !exists });
    }
  }, [patch]);

  const redownload = useCallback(
    (id: string) =>
      patch(id, {
        status: 'queued',
        bytesWritten: 0,
        assetId: undefined,
        savedLocation: undefined,
        fileMissing: undefined,
        completedAt: undefined,
        errorKind: undefined,
        errorMessage: undefined,
      }),
    [patch],
  );

  const clearFinished = useCallback(() => {
    setAll((prev) => prev.filter((i) => !['completed', 'cancelled'].includes(i.status)));
  }, [setAll]);

  const value = useMemo(
    () => ({ items, loaded, enqueue, pause, resume, cancel, retry, remove, clearFinished, verifyFiles, redownload }),
    [items, loaded, enqueue, pause, resume, cancel, retry, remove, clearFinished, verifyFiles, redownload],
  );

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads(): DownloadsValue {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error('useDownloads must be used inside DownloadsProvider');
  return ctx;
}
