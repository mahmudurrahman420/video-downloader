/**
 * Download engine: performs one download attempt and verifies the result.
 * All device access is injected, so the rules here are unit-tested in Node
 * with fake file systems and fake network tasks.
 */
import { AppError, downloadHttpError } from '../errors';
import { sniffMedia } from './mediaSniff';

export interface DownloadTaskHandle {
  /** Resolves with the HTTP status when finished, or null/undefined if paused/cancelled. */
  downloadAsync(): Promise<{ status: number } | null | undefined>;
}

export interface EngineDeps {
  isOnline(): Promise<boolean>;
  isOnWifi(): Promise<boolean>;
  ensureDir(): Promise<void>;
  fileSize(uri: string): Promise<number>;
  deleteFile(uri: string): Promise<void>;
  freeSpace(): Promise<number | undefined>;
  readHeader(uri: string): Promise<Uint8Array>;
  createTask(
    url: string,
    fileUri: string,
    onProgress: (written: number, expected: number) => void,
    resumeData?: string,
  ): DownloadTaskHandle;
  now?: () => number;
}

export interface EngineInput {
  url: string;
  tempUri: string;
  /** Known size in bytes, 0 if unknown. */
  totalBytes: number;
  acceptsRanges: boolean;
  wifiOnly: boolean;
}

export interface EngineCallbacks {
  onStarted?: (task: DownloadTaskHandle, bytesWritten: number) => void;
  onProgress?: (bytesWritten: number, totalBytes: number) => void;
}

export type EngineOutcome =
  | { type: 'downloaded'; size: number; container?: string }
  | { type: 'failed'; error: AppError; bytesWritten: number }
  | { type: 'stopped'; bytesWritten: number }
  | { type: 'restart'; reason: string };

export const SPACE_MARGIN = 50 * 1024 * 1024; // keep 50 MB free
export const PROGRESS_INTERVAL_MS = 250;

/**
 * Throttle native progress events to one UI update per interval, always
 * delivering the final 100% event. Tracks the best-known total size.
 */
export function createProgressReporter(
  emit: (written: number, total: number) => void,
  knownTotal: number,
  now: () => number = Date.now,
  intervalMs = PROGRESS_INTERVAL_MS,
) {
  let last = -Infinity;
  let total = knownTotal;
  let written = 0;
  const report = (w: number, expected: number) => {
    written = w;
    if (expected > 0) total = expected;
    const done = total > 0 && w >= total;
    const t = now();
    if (!done && t - last < intervalMs) return;
    last = t;
    emit(w, total);
  };
  return {
    report,
    get total() {
      return total;
    },
    get written() {
      return written;
    },
  };
}

/** Fraction 0..1 for a progress bar; 0 when the total is unknown. */
export function progressFraction(written: number, total: number): number {
  if (!total || total <= 0 || !Number.isFinite(written)) return 0;
  return Math.max(0, Math.min(1, written / total));
}

export async function runDownload(
  input: EngineInput,
  deps: EngineDeps,
  cb: EngineCallbacks = {},
): Promise<EngineOutcome> {
  const partialSize = () => deps.fileSize(input.tempUri);

  if (!(await deps.isOnline())) {
    return {
      type: 'failed',
      error: new AppError('offline', 'No internet connection. Connect and tap Retry.'),
      bytesWritten: await partialSize(),
    };
  }
  if (input.wifiOnly && !(await deps.isOnWifi())) {
    return {
      type: 'failed',
      error: new AppError('wifi-required', 'Wi-Fi only downloads are on. Connect to Wi-Fi or change this in Settings.'),
      bytesWritten: await partialSize(),
    };
  }

  await deps.ensureDir();
  let written = await partialSize();
  let resumeData: string | undefined;
  if (written > 0 && input.acceptsRanges && (!input.totalBytes || written < input.totalBytes)) {
    resumeData = String(written);
  } else if (written > 0) {
    await deps.deleteFile(input.tempUri);
    written = 0;
  }

  const remaining = input.totalBytes ? input.totalBytes - written : 0;
  const free = await deps.freeSpace();
  if (free !== undefined && remaining > 0 && free < remaining + SPACE_MARGIN) {
    return {
      type: 'failed',
      error: new AppError('storage-space', 'Not enough free storage on this device for this video. Free up space and tap Retry.'),
      bytesWritten: written,
    };
  }

  const reporter = createProgressReporter((w, t) => cb.onProgress?.(w, t), input.totalBytes, deps.now ?? Date.now);
  const task = deps.createTask(input.url, input.tempUri, reporter.report, resumeData);
  cb.onStarted?.(task, written);

  let result: { status: number } | null | undefined;
  try {
    result = await task.downloadAsync();
  } catch {
    const online = await deps.isOnline();
    if (!input.acceptsRanges) await deps.deleteFile(input.tempUri);
    const partial = await partialSize();
    return {
      type: 'failed',
      error: online
        ? new AppError(
            'interrupted',
            input.acceptsRanges
              ? 'The download was interrupted. Tap Retry to continue where it stopped.'
              : 'The download was interrupted. This server does not support resuming, so Retry will start over.',
          )
        : new AppError('offline', 'Connection lost during download. Reconnect and tap Retry.'),
      bytesWritten: partial,
    };
  }

  // Paused or cancelled by the user: the native task resolves without a result.
  if (!result) return { type: 'stopped', bytesWritten: await partialSize() };

  const { status } = result;
  if (status === 416 && resumeData) {
    await deps.deleteFile(input.tempUri);
    return { type: 'restart', reason: 'The server rejected the resume position; restarting from the beginning.' };
  }
  if (status < 200 || status >= 300) {
    // The native layer writes the error body into the file — never keep it.
    await deps.deleteFile(input.tempUri);
    return { type: 'failed', error: downloadHttpError(status), bytesWritten: 0 };
  }
  if (resumeData && status === 200) {
    // Server ignored our Range request and resent the whole file, which was
    // appended to the partial data — discard and restart cleanly.
    await deps.deleteFile(input.tempUri);
    return { type: 'restart', reason: 'The server does not support resuming; restarting from the beginning.' };
  }

  const size = await partialSize();
  const expected = reporter.total || input.totalBytes;
  if (size <= 0) {
    await deps.deleteFile(input.tempUri);
    return {
      type: 'failed',
      error: new AppError('corrupt', 'The server sent an empty file. Nothing was saved.'),
      bytesWritten: 0,
    };
  }
  if (expected > 0 && size < expected) {
    return {
      type: 'failed',
      error: new AppError(
        'interrupted',
        `Download incomplete (${size} of ${expected} bytes received). Tap Retry to ${input.acceptsRanges ? 'continue' : 'try again'}.`,
      ),
      bytesWritten: size,
    };
  }
  if (expected > 0 && size > expected) {
    await deps.deleteFile(input.tempUri);
    return {
      type: 'failed',
      error: new AppError('corrupt', 'The downloaded file is larger than the server reported, so it may be corrupted. Tap Retry.'),
      bytesWritten: 0,
    };
  }

  const sniff = sniffMedia(await deps.readHeader(input.tempUri));
  if (sniff.kind === 'not-video') {
    await deps.deleteFile(input.tempUri);
    return {
      type: 'failed',
      error: new AppError(
        'corrupt',
        `The server sent ${sniff.detected} instead of a video file (it may require signing in or the link expired). Nothing was saved.`,
      ),
      bytesWritten: 0,
    };
  }

  return { type: 'downloaded', size, container: sniff.kind === 'video' ? sniff.container : undefined };
}
