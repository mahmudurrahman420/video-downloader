import type { OwnerExportGuide, VideoMetadata } from '../../types';
import { AppError, fetchJSON } from '../http';
import { sourcePermitsDownload } from './policy';

interface OEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

/** YouTube's own tools for creators to get copies of videos they uploaded. */
export const YOUTUBE_OWNER_EXPORT: OwnerExportGuide = {
  platformName: 'YouTube',
  steps: [
    'Sign in to YouTube Studio with the channel that uploaded the video (use a browser in desktop mode).',
    'Open Content, find the video, tap the ⋮ Options menu and choose Download. The file is saved as an MP4 at the quality it was uploaded.',
    'To export many videos at once, use Google Takeout and select "YouTube and YouTube Music" → videos.',
  ],
  links: [
    { label: 'Open YouTube Studio', url: 'https://studio.youtube.com' },
    { label: 'Open Google Takeout', url: 'https://takeout.google.com' },
  ],
  afterExport:
    'The exported file is yours. To save it with this app on another device, upload it to storage you control (e.g. Dropbox) and paste its share link here.',
};

/**
 * YouTube: metadata comes from YouTube's official oEmbed endpoint.
 * YouTube's Terms of Service do not allow third-party apps to download videos,
 * and there is no official download API, so this provider is view-only.
 */
export async function resolveYouTube(sourceUrl: string, id: string): Promise<VideoMetadata> {
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;
  let data: OEmbed = {};
  try {
    data = await fetchJSON<OEmbed>(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`,
    );
  } catch (e) {
    if (e instanceof AppError && (e.status === 401 || e.status === 403)) {
      throw new AppError('http', 'This YouTube video is private, age-restricted or has embedding disabled.', e.status);
    }
    if (e instanceof AppError && (e.status === 404 || e.status === 400)) {
      throw new AppError('http', 'This YouTube video was not found. It may be private or removed.', e.status);
    }
    throw e;
  }
  return {
    provider: 'youtube',
    providerName: 'YouTube',
    sourceUrl,
    title: data.title ?? 'YouTube video',
    author: data.author_name,
    thumbnailUrl: data.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    downloadAllowed: sourcePermitsDownload('youtube'), // always false: see policy.ts
    permissionNote:
      "YouTube's Terms of Service don't permit downloading videos through third-party apps, and YouTube offers no official download API. You can watch it in the YouTube app — YouTube Premium members can also save videos for offline viewing inside the official app.",
    officialViewUrl: watchUrl,
    officialViewLabel: 'Watch on YouTube',
    ownerExport: YOUTUBE_OWNER_EXPORT,
    options: [],
  };
}
