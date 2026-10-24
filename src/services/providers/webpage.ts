import type { DownloadOption, VideoMetadata } from '../../types';
import { AppError, fetchText, httpMessage, probeFile } from '../http';
import { detectSource, isPlatformStreamHost } from '../url/detect';
import { parseUrl } from '../url/parseUrl';
import { extractPageVideos, isHlsCandidate, type PageVideoCandidate } from '../web/extractPageVideos';
import { evaluateDirectProbe } from './directEligibility';
import { resolveHls } from './hls';
import { resolveYouTube } from './youtube';
import { resolveVimeo } from './vimeo';

const MAX_CANDIDATES = 6;

async function optionsForFile(c: PageVideoCandidate, index: number): Promise<DownloadOption | undefined> {
  const u = parseUrl(c.url);
  if (!u) return undefined;
  const probe = await probeFile(c.url);
  const verdict = evaluateDirectProbe(probe, u.pathname);
  if (!verdict.eligible) return undefined;
  const res = c.height ? `${c.height}p · ` : '';
  return {
    id: `file-${index}-${c.url}`,
    kind: 'file',
    label: `${res}${verdict.label}`,
    url: c.url,
    fileName: verdict.fileName,
    mimeType: verdict.mimeType,
    sizeBytes: probe.contentLength,
    acceptsRanges: probe.acceptsRanges,
    height: c.height,
  };
}

/**
 * Generic web pages: offers the video files the page openly publishes in its
 * markup (og:video, JSON-LD contentUrl, <video>/<source>). Embedded YouTube or
 * Vimeo players are handed to those providers; platform CDN links are skipped.
 */
export async function resolveWebPage(pageUrl: string, preloadedHtml?: { text: string; finalUrl: string }): Promise<VideoMetadata> {
  let html = preloadedHtml;
  if (!html) {
    const res = await fetchText(pageUrl);
    if (!res.ok) throw new AppError('http', httpMessage(res.status), res.status);
    html = { text: res.text, finalUrl: res.finalUrl };
  }
  const page = extractPageVideos(html.text, html.finalUrl);
  const host = parseUrl(html.finalUrl)?.host ?? '';

  const embedded: PageVideoCandidate[] = [];
  const files: PageVideoCandidate[] = [];
  for (const c of page.candidates) {
    const cu = parseUrl(c.url);
    if (!cu || isPlatformStreamHost(cu.rawHost)) continue;
    const d = detectSource(c.url);
    if (d.kind === 'supported' && (d.provider === 'youtube' || d.provider === 'vimeo')) embedded.push(c);
    else if (d.kind === 'unsupported' && d.platformName) continue; // other platform players
    else files.push(c);
  }

  const options: DownloadOption[] = [];
  let hlsMeta: VideoMetadata | undefined;
  const errors: string[] = [];
  for (const [i, c] of files.slice(0, MAX_CANDIDATES).entries()) {
    try {
      if (isHlsCandidate(c)) {
        if (hlsMeta) continue;
        hlsMeta = await resolveHls(c.url, {
          sourceUrl: pageUrl,
          title: page.title,
          thumbnailUrl: page.thumbnailUrl,
          providerName: host,
        });
        options.push(...hlsMeta.options);
      } else {
        const opt = await optionsForFile(c, i);
        if (opt) options.push(opt);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (options.length === 0) {
    // Fall back to an embedded YouTube/Vimeo player's own (preview) result.
    const emb = embedded[0];
    if (emb) {
      const d = detectSource(emb.url);
      if (d.kind === 'supported' && d.provider === 'youtube') return resolveYouTube(emb.url, d.id!);
      if (d.kind === 'supported' && d.provider === 'vimeo') return resolveVimeo(emb.url, d.id!);
    }
    throw new AppError(
      'unsupported',
      errors[0] ??
        (page.candidates.length
          ? 'This page’s video is served through a protected or platform player, so there is no downloadable file.'
          : 'No downloadable video was found on this page. Open the page, play the video, and copy the direct link to the video file if the site provides one.'),
    );
  }

  options.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return {
    provider: 'webpage',
    providerName: host,
    sourceUrl: pageUrl,
    title: page.title ?? hlsMeta?.title ?? options[0].fileName.replace(/\.[^.]+$/, ''),
    author: page.author,
    thumbnailUrl: page.thumbnailUrl,
    description: page.description?.slice(0, 280),
    durationSeconds: hlsMeta?.durationSeconds,
    downloadAllowed: true,
    requiresRightsConfirmation: true,
    permissionNote:
      'This page publishes its video file openly. Only download it if you own it, it is openly licensed, or you otherwise have permission.',
    officialViewUrl: pageUrl,
    officialViewLabel: 'Open page',
    options,
  };
}
