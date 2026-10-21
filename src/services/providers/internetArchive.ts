import type { DownloadOption, VideoMetadata } from '../../types';
import { AppError, fetchJSON } from '../http';
import { sanitizeFileName } from '../../utils/format';

interface IAFile {
  name: string;
  source?: string;
  format?: string;
  size?: string;
  length?: string;
  width?: string;
  height?: string;
  private?: string | boolean;
}

interface IAMetadata {
  metadata?: {
    identifier?: string;
    title?: string | string[];
    creator?: string | string[];
    description?: string | string[];
    licenseurl?: string;
    mediatype?: string;
    'access-restricted-item'?: string | boolean;
  };
  files?: IAFile[];
  is_dark?: boolean;
}

const VIDEO_FORMATS = /(mpeg4|h\.264|h264|webm|ogg video|matroska|quicktime|512kb mpeg4|mp4)/i;
const VIDEO_EXT = /\.(mp4|m4v|webm|ogv|mkv|mov)$/i;

const first = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);

function stripHtml(s?: string) {
  return s?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseLength(len?: string): number | undefined {
  if (!len) return undefined;
  if (/^\d+(\.\d+)?$/.test(len)) return Number(len);
  const parts = len.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'webm':
      return 'video/webm';
    case 'ogv':
      return 'video/ogg';
    case 'mkv':
      return 'video/x-matroska';
    case 'mov':
      return 'video/quicktime';
    default:
      return 'video/mp4';
  }
}

/**
 * Internet Archive: official Metadata API (archive.org/metadata/<id>).
 * The Archive publishes download links for public items; we only offer files
 * that are not private and items that are not access-restricted.
 */
export async function resolveInternetArchive(sourceUrl: string, identifier: string): Promise<VideoMetadata> {
  const data = await fetchJSON<IAMetadata>(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  if (!data.metadata || !data.files) {
    throw new AppError('http', 'This Internet Archive item does not exist or is unavailable.', 404);
  }
  const md = data.metadata;
  const title = first(md.title) ?? identifier;
  const restricted =
    data.is_dark === true ||
    md['access-restricted-item'] === true ||
    md['access-restricted-item'] === 'true';

  const videoFiles = data.files.filter(
    (f) =>
      f.private !== true &&
      f.private !== 'true' &&
      (VIDEO_FORMATS.test(f.format ?? '') || VIDEO_EXT.test(f.name)) &&
      VIDEO_EXT.test(f.name),
  );

  const duration = videoFiles.map((f) => parseLength(f.length)).find((d) => d && d > 0);

  const options: DownloadOption[] = restricted
    ? []
    : videoFiles
        .map((f) => {
          const size = Number(f.size);
          const dims = f.width && f.height ? ` · ${f.width}×${f.height}` : '';
          const label = `${f.format ?? f.name.split('.').pop()?.toUpperCase()}${dims}`;
          const encodedPath = f.name.split('/').map(encodeURIComponent).join('/');
          return {
            id: f.name,
            label,
            url: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodedPath}`,
            fileName: sanitizeFileName(f.name.split('/').pop() ?? f.name),
            mimeType: mimeFor(f.name),
            sizeBytes: Number.isFinite(size) && size > 0 ? size : undefined,
          };
        })
        // Prefer MP4 first, then by size descending (higher quality first).
        .sort((a, b) => {
          const mp4 = (o: DownloadOption) => (o.mimeType === 'video/mp4' ? 0 : 1);
          return mp4(a) - mp4(b) || (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
        });

  let permissionNote: string;
  if (restricted) {
    permissionNote = 'This item is access-restricted by the Internet Archive, so it cannot be downloaded.';
  } else if (options.length === 0) {
    permissionNote = 'This item has no publicly downloadable video files.';
  } else {
    permissionNote = md.licenseurl
      ? 'The Internet Archive publishes these files for download under the license shown.'
      : 'The Internet Archive publishes these files for public download. Check the item page for any usage terms.';
  }

  return {
    provider: 'internet-archive',
    providerName: 'Internet Archive',
    sourceUrl,
    title,
    author: first(md.creator),
    thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
    durationSeconds: duration,
    description: stripHtml(first(md.description))?.slice(0, 280),
    license: md.licenseurl,
    downloadAllowed: options.length > 0,
    permissionNote,
    officialViewUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    officialViewLabel: 'Open on Internet Archive',
    options,
  };
}
