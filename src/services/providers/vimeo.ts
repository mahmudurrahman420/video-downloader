import type { VideoMetadata } from '../../types';
import { AppError, fetchJSON } from '../http';

interface VimeoOEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  duration?: number;
  description?: string;
}

/**
 * Vimeo: metadata via Vimeo's official oEmbed API.
 * Vimeo only exposes download files through its authenticated API, and only when
 * the video owner enables downloads, so this MVP offers official viewing instead.
 */
export async function resolveVimeo(sourceUrl: string, id: string): Promise<VideoMetadata> {
  const pageUrl = `https://vimeo.com/${id}`;
  let data: VimeoOEmbed;
  try {
    data = await fetchJSON<VimeoOEmbed>(
      `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(pageUrl)}`,
    );
  } catch (e) {
    if (e instanceof AppError && (e.status === 403 || e.status === 404)) {
      throw new AppError('http', 'This Vimeo video is private or could not be found.', e.status);
    }
    throw e;
  }
  return {
    provider: 'vimeo',
    providerName: 'Vimeo',
    sourceUrl,
    title: data.title ?? 'Vimeo video',
    author: data.author_name,
    thumbnailUrl: data.thumbnail_url,
    durationSeconds: data.duration,
    description: data.description,
    downloadAllowed: false,
    permissionNote:
      "Vimeo only allows downloads when the video's owner enables them, and the download button is provided on Vimeo itself. Open the video on Vimeo to watch it or use its official download button if the owner has turned it on.",
    officialViewUrl: pageUrl,
    officialViewLabel: 'Open on Vimeo',
    options: [],
  };
}
