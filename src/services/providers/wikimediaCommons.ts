import type { DownloadOption, VideoMetadata } from '../../types';
import { AppError, fetchWithTimeout, httpMessage } from '../http';
import { sanitizeFileName } from '../../utils/format';

interface MediaInfo {
  url?: string;
  thumburl?: string;
  size?: number;
  width?: number;
  height?: number;
  duration?: number;
  mime?: string;
  mediatype?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, { value?: string }>;
  derivatives?: { src: string; type?: string; width?: number; height?: number; transcodekey?: string }[];
}

interface CommonsResponse {
  query?: {
    pages?: {
      title: string;
      missing?: boolean;
      invalid?: boolean;
      videoinfo?: MediaInfo[];
      imageinfo?: MediaInfo[];
    }[];
  };
}

const strip = (s?: string) => s?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Wikimedia Commons: official MediaWiki API. All Commons media is freely licensed
 * (public domain or open licenses), so downloading is permitted with attribution.
 */
export async function resolveWikimediaCommons(sourceUrl: string, fileTitle: string): Promise<VideoMetadata> {
  const params = [
    'action=query',
    'format=json',
    'formatversion=2',
    'origin=*',
    'prop=videoinfo',
    'viprop=url|size|mime|mediatype|extmetadata|derivatives',
    'viurlwidth=640',
    `titles=${encodeURIComponent(fileTitle)}`,
  ].join('&');
  const res = await fetchWithTimeout(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { Accept: 'application/json', 'Api-User-Agent': 'VideoDownloaderApp/1.0 (Android)' },
  });
  if (!res.ok) throw new AppError('http', httpMessage(res.status), res.status);
  const data = (await res.json()) as CommonsResponse;
  const page = data.query?.pages?.[0];
  if (!page || page.missing || page.invalid) {
    throw new AppError('http', 'This Wikimedia Commons file was not found.', 404);
  }
  const info = (page.videoinfo ?? page.imageinfo)?.[0];
  if (!info?.url) throw new AppError('http', 'Wikimedia Commons returned no file information.', 404);

  const isVideo = info.mediatype === 'VIDEO' || info.mime?.startsWith('video/') || info.mime === 'application/ogg';
  if (!isVideo) {
    throw new AppError('http', 'This Wikimedia Commons file is not a video.');
  }

  const meta = info.extmetadata ?? {};
  const license = strip(meta.LicenseShortName?.value);
  const artist = strip(meta.Artist?.value);
  const baseName = page.title.replace(/^File:/i, '');

  const options: DownloadOption[] = [
    {
      id: 'original',
      label: `Original · ${info.mime ?? 'video'}${info.width && info.height ? ` · ${info.width}×${info.height}` : ''}`,
      url: info.url,
      fileName: sanitizeFileName(baseName),
      mimeType: info.mime,
      sizeBytes: info.size,
    },
  ];

  // Commons also serves official transcodes (smaller files) of the same video.
  for (const d of info.derivatives ?? []) {
    if (!d.src || d.src === info.url || !d.transcodekey) continue;
    const ext = d.transcodekey.split('.').pop() ?? 'webm';
    if (!['webm', 'mp4'].includes(ext)) continue;
    options.push({
      id: d.transcodekey,
      label: `Transcode · ${d.transcodekey}`,
      url: d.src,
      fileName: sanitizeFileName(`${baseName.replace(/\.[^.]+$/, '')}.${d.transcodekey}`),
      mimeType: ext === 'mp4' ? 'video/mp4' : 'video/webm',
    });
  }

  return {
    provider: 'wikimedia-commons',
    providerName: 'Wikimedia Commons',
    sourceUrl,
    title: strip(meta.ObjectName?.value) || baseName.replace(/\.[^.]+$/, ''),
    author: artist,
    thumbnailUrl: info.thumburl,
    durationSeconds: info.duration,
    description: strip(meta.ImageDescription?.value)?.slice(0, 280),
    license,
    downloadAllowed: true,
    permissionNote: `Wikimedia Commons media is freely licensed${license ? ` (${license})` : ''}. Downloading is permitted — remember to credit the author when you reuse it.`,
    officialViewUrl: info.descriptionurl ?? sourceUrl,
    officialViewLabel: 'Open on Wikimedia Commons',
    options,
  };
}
