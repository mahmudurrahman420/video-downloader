import type { DownloadOption, VideoMetadata } from '../../types';
import { AppError, fetchText, httpMessage } from '../http';
import {
  estimateBytes,
  hlsUnsupportedReason,
  isHlsText,
  isMasterPlaylist,
  parseMasterPlaylist,
  parseMediaPlaylist,
  variantLabel,
  type HlsMediaPlaylist,
} from '../hls/playlist';
import { sanitizeFileName } from '../../utils/format';

export interface HlsContext {
  sourceUrl?: string;
  title?: string;
  thumbnailUrl?: string;
  providerName?: string;
  author?: string;
}

const MAX_VARIANTS = 8;

async function loadPlaylist(url: string): Promise<{ text: string; finalUrl: string }> {
  const res = await fetchText(url, 5_000_000);
  if (!res.ok) throw new AppError('http', httpMessage(res.status), res.status);
  if (!isHlsText(res.text)) {
    throw new AppError('unsupported', 'This link does not return a valid HLS playlist.');
  }
  return { text: res.text, finalUrl: res.finalUrl };
}

function titleFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0].split('/').filter(Boolean);
  // ".../movie-name/master.m3u8" → "movie-name"
  const last = path.pop() ?? 'video';
  const base = last.replace(/\.m3u8$/i, '');
  const generic = /^(master|index|playlist|prog_index|manifest|stream|main|video)$/i.test(base);
  const name = generic && path.length ? path.pop()! : base;
  try {
    return decodeURIComponent(name).replace(/[_-]+/g, ' ').trim() || 'Video';
  } catch {
    return name || 'Video';
  }
}

/**
 * HLS (.m3u8) streams: complete (VOD), unencrypted streams are downloaded
 * segment by segment and joined into one playable file. Live, DRM and
 * key-encrypted streams are refused with a specific explanation.
 */
export async function resolveHls(url: string, ctx: HlsContext = {}): Promise<VideoMetadata> {
  const top = await loadPlaylist(url);
  const title = ctx.title || titleFromUrl(top.finalUrl);
  const safeBase = sanitizeFileName(title, 'mp4').replace(/\.[^.]+$/, '');

  let media: HlsMediaPlaylist;
  const options: DownloadOption[] = [];

  if (isMasterPlaylist(top.text)) {
    const all = parseMasterPlaylist(top.text, top.finalUrl);
    const video = all.filter((v) => !v.audioOnly);
    const variants = (video.length ? video : all).slice(0, MAX_VARIANTS);
    if (variants.length === 0) throw new AppError('unsupported', 'This HLS playlist lists no playable streams.');

    // Inspect the best variant: encryption, live/VOD and duration are shared by all renditions.
    const best = await loadPlaylist(variants[0].uri);
    media = parseMediaPlaylist(best.text, best.finalUrl);
    const reason = hlsUnsupportedReason(media);
    if (reason) throw new AppError('unsupported', reason);

    for (const v of variants) {
      const ext = media.container;
      options.push({
        id: v.uri,
        kind: 'hls',
        label: `${variantLabel(v)} · ${ext === 'mp4' ? 'MP4' : 'MPEG-TS'}`,
        url: v.uri,
        fileName: `${safeBase}${v.height ? ` ${v.height}p` : ''}.${ext}`,
        mimeType: ext === 'mp4' ? 'video/mp4' : 'video/mp2t',
        sizeBytes: estimateBytes(v.bandwidth, media.totalDuration),
        sizeEstimated: true,
        height: v.height,
      });
    }
    // Media playlists that sit behind an audio-only master entry are not offered as video.
  } else {
    media = parseMediaPlaylist(top.text, top.finalUrl);
    const reason = hlsUnsupportedReason(media);
    if (reason) throw new AppError('unsupported', reason);
    options.push({
      id: top.finalUrl,
      kind: 'hls',
      label: `Stream · ${media.container === 'mp4' ? 'MP4' : 'MPEG-TS'} · ${media.segments.length} segments`,
      url: top.finalUrl,
      fileName: `${safeBase}.${media.container}`,
      mimeType: media.container === 'mp4' ? 'video/mp4' : 'video/mp2t',
    });
  }

  return {
    provider: 'hls',
    providerName: ctx.providerName ?? 'HLS stream',
    sourceUrl: ctx.sourceUrl ?? url,
    title,
    author: ctx.author,
    thumbnailUrl: ctx.thumbnailUrl,
    durationSeconds: media.totalDuration || undefined,
    downloadAllowed: true,
    requiresRightsConfirmation: true,
    permissionNote:
      'This is an unencrypted stream published openly by its server. It will be saved as one video file. Only download it if you own it, it is openly licensed, or you otherwise have permission.',
    officialViewUrl: ctx.sourceUrl ?? url,
    officialViewLabel: 'Open original',
    options,
  };
}
