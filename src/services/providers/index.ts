import type { ProviderId, VideoMetadata } from '../../types';
import { detectSource, type Detection } from '../url/detect';
import { AppError } from '../errors';
import { resolveYouTube } from './youtube';
import { resolveVimeo } from './vimeo';
import { resolveInternetArchive } from './internetArchive';
import { resolveWikimediaCommons } from './wikimediaCommons';
import { resolveDirectFile } from './directFile';
import { resolveHls } from './hls';

export type ResolveResult =
  | { type: 'metadata'; data: VideoMetadata }
  | { type: 'unsupported'; url: string; platformName?: string; reason: string }
  | { type: 'invalid'; reason: string };

type Supported = Extract<Detection, { kind: 'supported' }>;

/**
 * One adapter per source. Each is a separate module with its own API calls;
 * the registry only routes and isolates failures, so a broken or changed
 * provider surfaces its own error without affecting any other provider.
 */
export interface ProviderAdapter {
  id: ProviderId;
  name: string;
  /** Hard time limit for one lookup (API + probes). */
  timeoutMs: number;
  resolve(d: Supported): Promise<VideoMetadata>;
}

export const ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = {
  youtube: { id: 'youtube', name: 'YouTube', timeoutMs: 20000, resolve: (d) => resolveYouTube(d.url.href, d.id!) },
  vimeo: { id: 'vimeo', name: 'Vimeo', timeoutMs: 20000, resolve: (d) => resolveVimeo(d.url.href, d.id!) },
  'internet-archive': {
    id: 'internet-archive',
    name: 'Internet Archive',
    timeoutMs: 25000,
    resolve: (d) => resolveInternetArchive(d.url.href, d.id!),
  },
  'wikimedia-commons': {
    id: 'wikimedia-commons',
    name: 'Wikimedia Commons',
    timeoutMs: 25000,
    resolve: (d) => resolveWikimediaCommons(d.url.href, d.id!),
  },
  hls: { id: 'hls', name: 'HLS stream', timeoutMs: 30000, resolve: (d) => resolveHls(d.url.href, { sourceUrl: d.url.href }) },
  // Direct links also cover web pages and HLS discovered by content type.
  direct: { id: 'direct', name: 'Direct link', timeoutMs: 45000, resolve: (d) => resolveDirectFile(d.url) },
};

function withTimeout<T>(p: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new AppError('timeout', `${name} took too long to respond. Please try again.`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Run one adapter, converting any unexpected crash into a provider-scoped AppError. */
export async function runAdapter(adapter: ProviderAdapter, d: Supported): Promise<VideoMetadata> {
  try {
    const meta = await withTimeout(adapter.resolve(d), adapter.timeoutMs, adapter.name);
    // Never show download buttons for a source whose policy forbids it, or with no options.
    if (meta.downloadAllowed && meta.options.length === 0) {
      return { ...meta, downloadAllowed: false };
    }
    return meta;
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new AppError('unknown', `${adapter.name} returned something unexpected (${msg}). Other sources are unaffected.`);
  }
}

/** Validate the link, then route it to the matching adapter. */
export async function resolveLink(input: string): Promise<ResolveResult> {
  const d = detectSource(input);
  if (d.kind === 'invalid') return { type: 'invalid', reason: d.reason };
  if (d.kind === 'unsupported') {
    return { type: 'unsupported', url: d.url.href, platformName: d.platformName, reason: d.reason };
  }
  const adapter = ADAPTERS[d.provider];
  if (!adapter) throw new AppError('unknown', 'Unsupported source.');
  return { type: 'metadata', data: await runAdapter(adapter, d) };
}

export const SUPPORTED_SOURCES = [
  { name: 'Direct video links', detail: '.mp4 .webm .mkv, redirects, Dropbox · download', icon: 'document-outline' as const, download: true },
  { name: 'HLS streams (.m3u8)', detail: 'Choose resolution · saved as one file', icon: 'layers-outline' as const, download: true },
  { name: 'Web pages with video', detail: 'Videos a page publishes openly · download', icon: 'globe-outline' as const, download: true },
  { name: 'Internet Archive', detail: 'Public items · all formats', icon: 'library-outline' as const, download: true },
  { name: 'Wikimedia Commons', detail: 'Free-licensed · original + transcodes', icon: 'images-outline' as const, download: true },
  { name: 'YouTube · Vimeo', detail: 'Preview · open in app · owner export', icon: 'logo-youtube' as const, download: false },
  { name: 'Facebook · Instagram · TikTok', detail: 'Explained · open in app · own-data export', icon: 'logo-instagram' as const, download: false },
];
