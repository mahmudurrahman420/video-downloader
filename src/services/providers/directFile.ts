import type { VideoMetadata } from '../../types';
import { AppError, httpMessage, probeFile } from '../http';
import type { ParsedUrl } from '../url/parseUrl';
import { sanitizeFileName } from '../../utils/format';

/**
 * Direct video file links (e.g. https://example.com/clip.mp4) that a server
 * publishes openly. The user must confirm they have the rights to the file.
 */
export async function resolveDirectFile(u: ParsedUrl): Promise<VideoMetadata> {
  const probe = await probeFile(u.href);
  if (!probe.ok) {
    throw new AppError('http', httpMessage(probe.status), probe.status);
  }
  const type = (probe.contentType ?? '').split(';')[0].trim().toLowerCase();
  const looksLikeVideo = type.startsWith('video/') || type === 'application/octet-stream' || type === 'application/ogg' || type === '';
  if (!looksLikeVideo) {
    throw new AppError(
      'http',
      `This link returns "${type}" instead of a video file. It may be a web page or require signing in.`,
    );
  }
  const rawName = decodeURIComponent(u.pathname.split('/').pop() || 'video.mp4');
  const fileName = sanitizeFileName(rawName);
  const ext = fileName.split('.').pop()?.toUpperCase() ?? 'VIDEO';
  return {
    provider: 'direct',
    providerName: u.host,
    sourceUrl: u.href,
    title: fileName.replace(/\.[^.]+$/, ''),
    downloadAllowed: true,
    requiresRightsConfirmation: true,
    permissionNote:
      'This is a file published directly by its server. Only download it if you own it, it is openly licensed, or you otherwise have permission.',
    officialViewUrl: u.href,
    officialViewLabel: 'Open in browser',
    options: [
      {
        id: 'file',
        label: `${ext} file${type ? ` · ${type}` : ''}`,
        url: probe.finalUrl,
        fileName,
        mimeType: type.startsWith('video/') ? type : undefined,
        sizeBytes: probe.contentLength,
        acceptsRanges: probe.acceptsRanges,
      },
    ],
  };
}
