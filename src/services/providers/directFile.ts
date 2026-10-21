import type { VideoMetadata } from '../../types';
import { probeFile } from '../http';
import type { ParsedUrl } from '../url/parseUrl';
import { evaluateDirectProbe } from './directEligibility';

/**
 * Direct video file links (e.g. https://example.com/clip.mp4, a Dropbox dl=1
 * link, or a CDN link without an extension). The server's own response
 * decides eligibility: it must serve an actual video file, publicly.
 * The user must also confirm they have the rights to the file.
 */
export async function resolveDirectFile(u: ParsedUrl): Promise<VideoMetadata> {
  const probe = await probeFile(u.href);
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
        label: verdict.label,
        url: probe.finalUrl,
        fileName: verdict.fileName,
        mimeType: verdict.mimeType,
        sizeBytes: probe.contentLength,
        acceptsRanges: probe.acceptsRanges,
      },
    ],
  };
}
