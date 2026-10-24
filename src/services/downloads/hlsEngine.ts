/**
 * HLS download engine: downloads every segment of a complete, unencrypted
 * media playlist in order and appends them into one file (MPEG-TS, or
 * fragmented MP4 when the stream has an init segment). Progress is
 * checkpointed per segment so interrupted downloads resume where they left off.
 * Device access is injected, so this is unit-tested in Node.
 */
import { AppError, downloadHttpError } from '../errors';
import { hlsUnsupportedReason, isHlsText, isMasterPlaylist, parseMediaPlaylist } from '../hls/playlist';
import { sniffMedia } from './mediaSniff';
import type { DownloadTaskHandle, EngineOutcome } from './engine';

export interface HlsCheckpoint {
  segmentsDone: number;
  segmentCount: number;
  bytesCommitted: number;
}

export interface HlsEngineDeps {
  isOnline(): Promise<boolean>;
  isOnWifi(): Promise<boolean>;
  ensureDir(): Promise<void>;
  fileSize(uri: string): Promise<number>;
  deleteFile(uri: string): Promise<void>;
  readHeader(uri: string): Promise<Uint8Array>;
  fetchText(url: string): Promise<{ ok: boolean; status: number; text: string; finalUrl: string }>;
  createSegmentTask(url: string, fileUri: string, headers: Record<string, string>): DownloadTaskHandle;
  appendFile(src: string, dest: string): Promise<void>;
  delay(ms: number): Promise<void>;
  /** True once the user paused/cancelled; checked between segments. */
  shouldStop?(): boolean;
}

export interface HlsEngineInput {
  playlistUrl: string;
  tempUri: string;
  segmentTempUri: string;
  wifiOnly: boolean;
  checkpoint?: HlsCheckpoint;
}

export interface HlsEngineCallbacks {
  onStarted?: (bytesCommitted: number) => void;
  onProgress?: (cp: HlsCheckpoint) => void;
}

export const SEGMENT_RETRIES = 3;

interface Piece {
  uri: string;
  range?: { offset: number; length: number };
}

export async function runHlsDownload(
  input: HlsEngineInput,
  deps: HlsEngineDeps,
  cb: HlsEngineCallbacks = {},
): Promise<EngineOutcome> {
  const committed = () => deps.fileSize(input.tempUri);

  if (!(await deps.isOnline())) {
    return { type: 'failed', error: new AppError('offline', 'No internet connection. Connect and tap Retry.'), bytesWritten: await committed() };
  }
  if (input.wifiOnly && !(await deps.isOnWifi())) {
    return {
      type: 'failed',
      error: new AppError('wifi-required', 'Wi-Fi only downloads are on. Connect to Wi-Fi or change this in Settings.'),
      bytesWritten: await committed(),
    };
  }
  await deps.ensureDir();

  // Fetch the media playlist fresh each run (segment URLs may be re-signed).
  let res;
  try {
    res = await deps.fetchText(input.playlistUrl);
  } catch {
    return {
      type: 'failed',
      error: new AppError('offline', 'Could not load the stream playlist. Check your connection and tap Retry.'),
      bytesWritten: await committed(),
    };
  }
  if (!res.ok) return { type: 'failed', error: downloadHttpError(res.status), bytesWritten: await committed() };
  if (!isHlsText(res.text) || isMasterPlaylist(res.text)) {
    return { type: 'failed', error: new AppError('unsupported', 'The stream playlist changed and is no longer a playable media playlist.'), bytesWritten: 0 };
  }
  const playlist = parseMediaPlaylist(res.text, res.finalUrl);
  const reason = hlsUnsupportedReason(playlist);
  if (reason) return { type: 'failed', error: new AppError('unsupported', reason), bytesWritten: 0 };

  const pieces: Piece[] = [];
  if (playlist.init) pieces.push({ uri: playlist.init.uri, range: playlist.init.byteRange });
  for (const s of playlist.segments) pieces.push({ uri: s.uri, range: s.byteRange });
  const segmentCount = pieces.length;

  // Resume only if the file on disk matches the last checkpoint exactly.
  let done = 0;
  let bytes = 0;
  const cp = input.checkpoint;
  const onDisk = await committed();
  if (cp && cp.segmentCount === segmentCount && cp.segmentsDone > 0 && cp.segmentsDone <= segmentCount && onDisk === cp.bytesCommitted) {
    done = cp.segmentsDone;
    bytes = cp.bytesCommitted;
  } else if (onDisk > 0) {
    await deps.deleteFile(input.tempUri);
  }
  cb.onStarted?.(bytes);

  for (let i = done; i < segmentCount; i++) {
    if (deps.shouldStop?.()) return { type: 'stopped', bytesWritten: bytes };
    const piece = pieces[i];
    const headers: Record<string, string> = piece.range
      ? { Range: `bytes=${piece.range.offset}-${piece.range.offset + piece.range.length - 1}` }
      : {};

    let attempt = 0;
    let ok = false;
    while (!ok) {
      await deps.deleteFile(input.segmentTempUri);
      let result: { status: number } | null | undefined;
      try {
        result = await deps.createSegmentTask(piece.uri, input.segmentTempUri, headers).downloadAsync();
      } catch {
        attempt++;
        if (attempt > SEGMENT_RETRIES || !(await deps.isOnline())) {
          await deps.deleteFile(input.segmentTempUri);
          const online = await deps.isOnline();
          return {
            type: 'failed',
            error: online
              ? new AppError('interrupted', `The stream download was interrupted at segment ${i + 1} of ${segmentCount}. Tap Retry to continue.`)
              : new AppError('offline', 'Connection lost during download. Reconnect and tap Retry — it will continue where it stopped.'),
            bytesWritten: bytes,
          };
        }
        await deps.delay(1000 * 2 ** (attempt - 1));
        continue;
      }
      if (!result) {
        // Paused or cancelled: drop the partial segment, keep committed ones.
        await deps.deleteFile(input.segmentTempUri);
        return { type: 'stopped', bytesWritten: bytes };
      }
      if (result.status < 200 || result.status >= 300) {
        await deps.deleteFile(input.segmentTempUri);
        if ((result.status >= 500 || result.status === 429) && attempt < SEGMENT_RETRIES) {
          attempt++;
          await deps.delay(1000 * 2 ** (attempt - 1));
          continue;
        }
        return { type: 'failed', error: downloadHttpError(result.status), bytesWritten: bytes };
      }
      if (piece.range && result.status !== 206) {
        await deps.deleteFile(input.segmentTempUri);
        return {
          type: 'failed',
          error: new AppError('http', 'The stream server does not support the byte-range requests this stream requires.'),
          bytesWritten: bytes,
        };
      }
      const size = await deps.fileSize(input.segmentTempUri);
      if (size <= 0 || (piece.range && size !== piece.range.length)) {
        attempt++;
        if (attempt > SEGMENT_RETRIES) {
          await deps.deleteFile(input.segmentTempUri);
          return {
            type: 'failed',
            error: new AppError('corrupt', `Segment ${i + 1} of ${segmentCount} arrived incomplete. Tap Retry.`),
            bytesWritten: bytes,
          };
        }
        continue;
      }
      await deps.appendFile(input.segmentTempUri, input.tempUri);
      await deps.deleteFile(input.segmentTempUri);
      bytes += size;
      ok = true;
    }
    cb.onProgress?.({ segmentsDone: i + 1, segmentCount, bytesCommitted: bytes });
  }

  const total = await committed();
  if (total <= 0 || total !== bytes) {
    await deps.deleteFile(input.tempUri);
    return { type: 'failed', error: new AppError('corrupt', 'The joined stream file is incomplete. Tap Retry.'), bytesWritten: 0 };
  }
  const sniff = sniffMedia(await deps.readHeader(input.tempUri));
  if (sniff.kind === 'not-video') {
    await deps.deleteFile(input.tempUri);
    return {
      type: 'failed',
      error: new AppError('corrupt', `The stream returned ${sniff.detected} instead of video data. Nothing was saved.`),
      bytesWritten: 0,
    };
  }
  return { type: 'downloaded', size: total, container: sniff.kind === 'video' ? sniff.container : playlist.container };
}
