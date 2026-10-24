import type { ProviderId } from '../../types';

/**
 * Whether each source officially permits third-party downloading.
 * - YouTube: Terms of Service forbid it and there is no download API → never.
 * - Vimeo: downloads only via Vimeo itself when the owner enables them → not in-app.
 * - Internet Archive / Wikimedia Commons: publish files for public download
 *   (individual items can still be restricted — checked by their providers).
 * - HLS / web pages: only unencrypted, complete streams and files a public page
 *   openly publishes; platform pages and platform CDNs are excluded in detect.ts.
 * - Direct links: allowed only after the server proves it serves a public video
 *   file and the user confirms they have the rights to it.
 */
export const SOURCE_DOWNLOAD_POLICY: Record<ProviderId, boolean> = {
  youtube: false,
  vimeo: false,
  'internet-archive': true,
  'wikimedia-commons': true,
  direct: true,
  hls: true,
  webpage: true,
  unsupported: false,
};

export function sourcePermitsDownload(provider: ProviderId): boolean {
  return SOURCE_DOWNLOAD_POLICY[provider] === true;
}
