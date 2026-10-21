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
  tempUriFor,
} from '../services/downloads/fileStore';
import { deleteSavedVideo, saveToLibrary } from '../services/downloads/mediaSaver';
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
}

const DownloadsContext = createContext<DownloadsValue | null>(null);

const SPACE_MARGIN = 50 * 1024 * 1024; // keep 50 MB free
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

  // ---- the actual download --------------------------------------------------
  const start = useCallback(
    async (id: string) => {
      if (starting.current.has(id) || tasks.current.has(id)) return;
      starting.current.add(id);
      try {
        const it = get(id);
        if (!it) return;

        if (!(await isOnline())) {
          fail(id, 'offline', 'No internet connection. Connect and tap Retry.');
          return;
        }
        if (settingsRef.current.wifiOnly && !(await isOnWifi())) {
          fail(id, 'wifi-required', 'Wi-Fi only downloads are on. Connect to Wi-Fi or change this in Settings.');
          return;
        }

        await ensureDownloadDir();
        let written = await fileSize(it.tempUri);
        let resumeData: string | undefined;
        if (written > 0 && it.acceptsRanges && (!it.totalBytes || written < it.totalBytes)) {
          resumeData = String(written);
        } else if (written > 0) {
          await deleteFile(it.tempUri);
          written = 0;
        }

        const remaining = it.totalBytes ? it.totalBytes - written : 0;
        const free = await freeSpace();
        if (free !== undefined && remaining > 0 && free < remaining + SPACE_MARGIN) {
          fail(id, 'storage-space', 'Not enough free storage on this device for this video.');
          return;
        }

        let lastUpdate = 0;
        const task = FileSystem.createDownloadResumable(
          it.url,
          it.tempUri,
          {},
          ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
            const now = Date.now();
            if (now - lastUpdate < 250 && totalBytesWritten !== totalBytesExpectedToWrite) return;
            lastUpdate = now;
            patch(id, {
              bytesWritten: totalBytesWritten,
              totalBytes: totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : get(id)?.totalBytes ?? 0,
            });
          },
          resumeData,
        );
        tasks.current.set(id, task);
        patch(id, { status: 'downloading', bytesWritten: written, errorKind: undefined, errorMessage: undefined });
        starting.current.delete(id);

        let result: FileSystem.FileSystemDownloadResult | undefined;
        try {
          result = await task.downloadAsync();
        } catch (e) {
          tasks.current.delete(id);
          const partial = await fileSize(it.tempUri);
          const online = await isOnline();
          fail(
            id,
            online ? 'interrupted' : 'offline',
            online
              ? `The download was interrupted${it.acceptsRanges ? ' — tap Retry to continue where it stopped' : ''}.`
              : 'Connection lost during download. Reconnect and tap Retry.',
          );
          patch(id, { bytesWritten: partial });
          return;
        }
        tasks.current.delete(id);

        // Paused or cancelled by the user: native layer resolves with no result.
        if (!result) {
          const reason = stopReason.current.get(id);
          stopReason.current.delete(id);
          if (reason === 'cancel') return; // cancel() already updated state
          patch(id, { status: 'paused', bytesWritten: await fileSize(it.tempUri) });
          return;
        }

        // ---- verify the file is real before calling it a success ----
        const status = result.status;
        if (status < 200 || status >= 300) {
          await deleteFile(it.tempUri);
          fail(id, 'http', `The server refused the download (HTTP ${status}).`);
          return;
        }
        if (resumeData && status === 200) {
          // Server ignored our Range request and resent the whole file, which
          // was appended to the partial data — discard and restart cleanly.
          await deleteFile(it.tempUri);
          patch(id, { acceptsRanges: false, bytesWritten: 0, status: 'queued' });
          return;
        }
        const size = await fileSize(it.tempUri);
        const expected = get(id)?.totalBytes ?? 0;
        if (size <= 0) {
          await deleteFile(it.tempUri);
          fail(id, 'corrupt', 'The server sent an empty file. Nothing was saved.');
          return;
        }
        if (expected > 0 && size !== expected) {
          fail(
            id,
            'corrupt',
            `Download incomplete (${size} of ${expected} bytes). Tap Retry to try again.`,
          );
          patch(id, { bytesWritten: size });
          return;
        }
        patch(id, { bytesWritten: size, totalBytes: expected || size });
        await saveCompleted(id);
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

  const clearFinished = useCallback(() => {
    setAll((prev) => prev.filter((i) => !['completed', 'cancelled'].includes(i.status)));
  }, [setAll]);

  const value = useMemo(
    () => ({ items, loaded, enqueue, pause, resume, cancel, retry, remove, clearFinished }),
    [items, loaded, enqueue, pause, resume, cancel, retry, remove, clearFinished],
  );

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads(): DownloadsValue {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error('useDownloads must be used inside DownloadsProvider');
  return ctx;
}
