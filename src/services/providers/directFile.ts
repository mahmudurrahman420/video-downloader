import type { VideoMetadata } from '../../types';
import { AppError, fetchText, probeFile } from '../http';
import type { ParsedUrl } from '../url/parseUrl';
import { evaluateDirectProbe } from './directEligibility';
import { isHlsText } from '../hls/playlist';
import { resolveHls } from './hls';
import { resolveWebPage } from './webpage';

const HLS_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl', 'vnd.apple.mpegurl'];

/**
 * Direct links: the server's own response decides what the link is.
 * - a video file → single download option (redirects are re-followed at
 *   download time, so expiring signed redirect targets keep working on retry)
 * - an HLS playlist → handed to the HLS adapter
 * - a web page → handed to the web-page adapter (videos the page publishes)
 */
export async function resolveDirectFile(u: ParsedUrl): Promise<VideoMetadata> {
  const probe = await probeFile(u.href);
  const type = (probe.contentType ?? '').split(';')[0].trim().toLowerCase();

  if (probe.ok && HLS_TYPES.includes(type)) return resolveHls(u.href, { sourceUrl: u.href });

  if (probe.ok && (type === 'text/html' || type === 'application/xhtml+xml')) {
    return resolveWebPage(u.href);
  }

  // Some servers label playlists as text/plain or octet-stream.
  if (probe.ok && (type === 'text/plain' || /\.m3u8$/i.test(u.pathname))) {
    const peek = await fetchText(u.href, 200_000);
    if (peek.ok && isHlsText(peek.text)) return resolveHls(u.href, { sourceUrl: u.href });
  }

  const verdict = evaluateDirectProbe(probe, u.pathname);
  if (!verdict.eligible) throw verdict.error;

  return {
    provider: 'direct',
    providerName: u.host,
    sourceUrl: u.href,
    title: verdict.fileName.replace(/\.[^.]+$/, ''),
    downloadAllowed: true,
    requiresRightsConfirmation: true,
    permissionNote:
      'This is a file published directly by its server. Only download it if you own it, it is openly licensed, or you otherwise have permission.',
    officialViewUrl: u.href,
    officialViewLabel: 'Open in browser',
    options: [
      {
        id: 'file',
        kind: 'file',
        label: verdict.label,
        // Keep the original link: if it redirects to a short-lived signed URL,
        // the redirect is followed fresh on every (re)try.
        url: u.href,
        fileName: verdict.fileName,
        mimeType: verdict.mimeType,
        sizeBytes: probe.contentLength,
        acceptsRanges: probe.acceptsRanges,
      },
    ],
  };
}

export { AppError };
