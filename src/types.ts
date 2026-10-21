import type { ThemeMode } from './theme/colors';

/** Identifier for each source integration the app knows about. */
export type ProviderId =
  | 'youtube'
  | 'vimeo'
  | 'internet-archive'
  | 'wikimedia-commons'
  | 'direct'
  | 'unsupported';

/**
 * A single file the source officially lets the user download.
 * Only providers that are allowed to offer downloads ever create these.
 */
export interface DownloadOption {
  id: string;
  label: string; // e.g. "MPEG4 · 1280×720"
  url: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Whether the server supports HTTP range requests (resumable). */
  acceptsRanges?: boolean;
}

/** Official way for the video's owner to get a downloadable copy. */
export interface OwnerExportGuide {
  platformName: string;
  steps: string[];
  links: { label: string; url: string }[];
  /** What to do with the exported file in this app. */
  afterExport: string;
}

export interface VideoMetadata {
  provider: ProviderId;
  providerName: string;
  sourceUrl: string;
  title: string;
  author?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  license?: string;
  description?: string;
  /** True only when the source's terms/API permit downloading. */
  downloadAllowed: boolean;
  /** Human explanation of why downloading is or isn't allowed. */
  permissionNote: string;
  /** Official place to watch when downloading is not permitted. */
  officialViewUrl?: string;
  officialViewLabel?: string;
  options: DownloadOption[];
  /** Official export workflow when the user owns the video. */
  ownerExport?: OwnerExportGuide;
  /** Direct links need the user to confirm they have the rights to the file. */
  requiresRightsConfirmation?: boolean;
}

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ErrorKind =
  | 'offline'
  | 'timeout'
  | 'http'
  | 'unsupported'
  | 'storage-permission'
  | 'storage-space'
  | 'interrupted'
  | 'corrupt'
  | 'wifi-required'
  | 'unknown';

export interface DownloadItem {
  id: string;
  title: string;
  provider: ProviderId;
  providerName: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  url: string;
  fileName: string;
  mimeType?: string;
  /** Bytes reported by the server (0 when unknown). */
  totalBytes: number;
  bytesWritten: number;
  acceptsRanges: boolean;
  status: DownloadStatus;
  errorKind?: ErrorKind;
  errorMessage?: string;
  /** App-private file used while downloading. */
  tempUri: string;
  /** Media library asset id once saved to shared storage. */
  assetId?: string;
  /** Human-readable path of the saved file (e.g. Movies/Video Downloader/x.mp4). */
  savedLocation?: string;
  /** Completed file was deleted from the device outside the app. */
  fileMissing?: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type HistoryOutcome =
  | 'looked-up'
  | 'downloaded'
  | 'download-failed'
  | 'view-only'
  | 'queued'
  | 'invalid'
  | 'error';

export interface HistoryEntry {
  id: string;
  url: string;
  title?: string;
  providerName?: string;
  thumbnailUrl?: string;
  outcome: HistoryOutcome;
  detail?: string;
  timestamp: number;
}

export interface AppSettings {
  themeMode: ThemeMode;
  wifiOnly: boolean;
  maxConcurrent: number;
  keepHistory: boolean;
}
