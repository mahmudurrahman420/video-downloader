import type { OwnerExportGuide, VideoMetadata } from '../../types';
import { AppError, fetchJSON } from '../http';
import { sourcePermitsDownload } from './policy';

interface VimeoOEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  duration?: number;
  description?: string;
}

export const VIMEO_OWNER_EXPORT: OwnerExportGuide = {
  platformName: 'Vimeo',
  steps: [
    'Sign in to Vimeo with the account that uploaded the video.',
    'Open the video from your Vimeo library and use its Download option to get the original or a transcoded file.',
    'Alternatively, enable downloads for viewers in the video\'s privacy/download settings.',
  ],
  links: [{ label: 'Open your Vimeo videos', url: 'https://vimeo.com/manage/videos' }],
  afterExport:
    'Upload the exported file to storage you control (e.g. Dropbox) and paste its share link here to save it with this app.',
};

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
    downloadAllowed: sourcePermitsDownload('vimeo'), // always false: see policy.ts
    permissionNote:
      "Vimeo only allows downloads when the video's owner enables them, and the download button is provided on Vimeo itself. Open the video on Vimeo to watch it or use its official download button if the owner has turned it on.",
    officialViewUrl: pageUrl,
    officialViewLabel: 'Open on Vimeo',
    ownerExport: VIMEO_OWNER_EXPORT,
    options: [],
  };
}
