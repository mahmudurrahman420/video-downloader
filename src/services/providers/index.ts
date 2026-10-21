import type { VideoMetadata } from '../../types';
import { detectSource } from '../url/detect';
import { AppError } from '../http';
import { resolveYouTube } from './youtube';
import { resolveVimeo } from './vimeo';
import { resolveInternetArchive } from './internetArchive';
import { resolveWikimediaCommons } from './wikimediaCommons';
import { resolveDirectFile } from './directFile';

export type ResolveResult =
  | { type: 'metadata'; data: VideoMetadata }
  | { type: 'unsupported'; url: string; platformName?: string; reason: string }
  | { type: 'invalid'; reason: string };

/** Validate the link, then ask the matching official API for metadata. */
export async function resolveLink(input: string): Promise<ResolveResult> {
  const d = detectSource(input);
  if (d.kind === 'invalid') return { type: 'invalid', reason: d.reason };
  if (d.kind === 'unsupported') {
    return { type: 'unsupported', url: d.url.href, platformName: d.platformName, reason: d.reason };
  }
  const href = d.url.href;
  switch (d.provider) {
    case 'youtube':
      return { type: 'metadata', data: await resolveYouTube(href, d.id!) };
    case 'vimeo':
      return { type: 'metadata', data: await resolveVimeo(href, d.id!) };
    case 'internet-archive':
      return { type: 'metadata', data: await resolveInternetArchive(href, d.id!) };
    case 'wikimedia-commons':
      return { type: 'metadata', data: await resolveWikimediaCommons(href, d.id!) };
    case 'direct':
      return { type: 'metadata', data: await resolveDirectFile(d.url) };
    default:
      throw new AppError('unknown', 'Unsupported source.');
  }
}

export const SUPPORTED_SOURCES = [
  { name: 'Internet Archive', detail: 'Public items · download', icon: 'library-outline' as const, download: true },
  { name: 'Wikimedia Commons', detail: 'Free-licensed · download', icon: 'globe-outline' as const, download: true },
  { name: 'Direct video files', detail: '.mp4 .webm .mkv · download', icon: 'document-outline' as const, download: true },
  { name: 'YouTube', detail: 'Preview · watch officially', icon: 'logo-youtube' as const, download: false },
  { name: 'Vimeo', detail: 'Preview · watch officially', icon: 'logo-vimeo' as const, download: false },
];
