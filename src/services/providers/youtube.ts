import type { VideoMetadata } from '../../types';
import { AppError, fetchJSON } from '../http';

interface OEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
}

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
    downloadAllowed: false,
    permissionNote:
      "YouTube's Terms of Service don't permit downloading videos through third-party apps, and YouTube offers no official download API. You can watch it in the YouTube app — YouTube Premium members can also save videos for offline viewing inside the official app.",
    officialViewUrl: watchUrl,
    officialViewLabel: 'Watch on YouTube',
    options: [],
  };
}
