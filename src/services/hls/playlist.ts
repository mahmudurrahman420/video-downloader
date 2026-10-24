/**
 * HLS (HTTP Live Streaming, RFC 8216) playlist parsing — pure, no I/O.
 * Supports master playlists (variant selection) and media playlists
 * (segments, init segment, byte ranges). Encrypted playlists are detected so
 * the app can refuse them instead of producing an unplayable file.
 */
import { resolveUrl } from '../url/resolveUrl';

export interface HlsVariant {
  uri: string;
  bandwidth?: number;
  width?: number;
  height?: number;
  codecs?: string;
  frameRate?: number;
  /** Variant has no video (audio-only rendition). */
  audioOnly: boolean;
}

export interface ByteRange {
  length: number;
  offset: number;
}

export interface HlsSegment {
  uri: string;
  duration: number;
  byteRange?: ByteRange;
}

export type HlsEncryption = 'none' | 'aes-128' | 'sample-aes' | 'drm';

export interface HlsMediaPlaylist {
  segments: HlsSegment[];
  init?: { uri: string; byteRange?: ByteRange };
  totalDuration: number;
  /** False for live streams that are still growing. */
  endList: boolean;
  encryption: HlsEncryption;
  /** Container produced by concatenating the segments. */
  container: 'ts' | 'mp4';
}

export function isHlsText(text: string): boolean {
  return text.replace(/^﻿/, '').trimStart().startsWith('#EXTM3U');
}

export function isMasterPlaylist(text: string): boolean {
  return /^#EXT-X-STREAM-INF:/m.test(text);
}

/** Parse an attribute list: KEY=VALUE,KEY="quoted, value" */
export function parseAttributes(list: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(list))) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

function lines(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function parseMasterPlaylist(text: string, baseUrl: string): HlsVariant[] {
  const ls = lines(text);
  const variants: HlsVariant[] = [];
  for (let i = 0; i < ls.length; i++) {
    if (!ls[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = parseAttributes(ls[i].slice('#EXT-X-STREAM-INF:'.length));
    let j = i + 1;
    while (j < ls.length && ls[j].startsWith('#')) j++;
    if (j >= ls.length) break;
    const res = attrs.RESOLUTION?.match(/^(\d+)x(\d+)$/i);
    const codecs = attrs.CODECS;
    const hasVideoCodec = codecs ? /(avc|hvc|hev|vp0?9|av01|mp4v)/i.test(codecs) : undefined;
    variants.push({
      uri: resolveUrl(baseUrl, ls[j]),
      bandwidth: attrs['AVERAGE-BANDWIDTH'] ? Number(attrs['AVERAGE-BANDWIDTH']) : attrs.BANDWIDTH ? Number(attrs.BANDWIDTH) : undefined,
      width: res ? Number(res[1]) : undefined,
      height: res ? Number(res[2]) : undefined,
      codecs,
      frameRate: attrs['FRAME-RATE'] ? Number(attrs['FRAME-RATE']) : undefined,
      audioOnly: !res && hasVideoCodec === false,
    });
    i = j;
  }
  // De-duplicate identical URIs, keep highest quality first.
  const seen = new Set<string>();
  return variants
    .filter((v) => (seen.has(v.uri) ? false : (seen.add(v.uri), true)))
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
}

function parseByteRange(value: string, previousEnd: number | undefined): ByteRange | undefined {
  const m = value.match(/^(\d+)(?:@(\d+))?$/);
  if (!m) return undefined;
  const length = Number(m[1]);
  const offset = m[2] !== undefined ? Number(m[2]) : previousEnd ?? 0;
  return { length, offset };
}

export function parseMediaPlaylist(text: string, baseUrl: string): HlsMediaPlaylist {
  const ls = lines(text);
  const segments: HlsSegment[] = [];
  let init: HlsMediaPlaylist['init'];
  let encryption: HlsEncryption = 'none';
  let endList = false;
  let pendingDuration: number | undefined;
  let pendingRange: ByteRange | undefined;
  let lastRangeEnd: number | undefined;

  for (const l of ls) {
    if (l.startsWith('#EXTINF:')) {
      pendingDuration = parseFloat(l.slice(8));
    } else if (l.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = parseByteRange(l.slice(17), lastRangeEnd);
    } else if (l.startsWith('#EXT-X-KEY:') || l.startsWith('#EXT-X-SESSION-KEY:')) {
      const a = parseAttributes(l.slice(l.indexOf(':') + 1));
      const method = (a.METHOD ?? 'NONE').toUpperCase();
      const keyFormat = (a.KEYFORMAT ?? 'identity').toLowerCase();
      if (method === 'NONE') continue;
      let kind: HlsEncryption = method === 'AES-128' ? 'aes-128' : 'sample-aes';
      if (keyFormat !== 'identity' || /^skd:|^data:text\/plain;base64/i.test(a.URI ?? '')) kind = 'drm';
      // Keep the strongest protection seen.
      const rank = { none: 0, 'aes-128': 1, 'sample-aes': 2, drm: 3 } as const;
      if (rank[kind] > rank[encryption]) encryption = kind;
    } else if (l.startsWith('#EXT-X-MAP:')) {
      const a = parseAttributes(l.slice(11));
      if (a.URI) {
        init = {
          uri: resolveUrl(baseUrl, a.URI),
          byteRange: a.BYTERANGE ? parseByteRange(a.BYTERANGE, 0) : undefined,
        };
      }
    } else if (l === '#EXT-X-ENDLIST') {
      endList = true;
    } else if (l.startsWith('#EXT-X-PLAYLIST-TYPE:') && /VOD/i.test(l)) {
      // VOD playlists are complete even if a server omits ENDLIST.
      endList = true;
    } else if (!l.startsWith('#')) {
      const seg: HlsSegment = { uri: resolveUrl(baseUrl, l), duration: pendingDuration ?? 0 };
      if (pendingRange) {
        seg.byteRange = pendingRange;
        lastRangeEnd = pendingRange.offset + pendingRange.length;
      }
      segments.push(seg);
      pendingDuration = undefined;
      pendingRange = undefined;
    }
  }

  const firstUri = (init?.uri ?? segments[0]?.uri ?? '').split('?')[0].toLowerCase();
  const container: 'ts' | 'mp4' = init || /\.(m4s|mp4|m4v|cmfv)$/.test(firstUri) ? 'mp4' : 'ts';
  return {
    segments,
    init,
    totalDuration: segments.reduce((s, x) => s + (Number.isFinite(x.duration) ? x.duration : 0), 0),
    endList,
    encryption,
    container,
  };
}

/** Explain why a media playlist cannot be saved, or undefined if it can. */
export function hlsUnsupportedReason(p: HlsMediaPlaylist): string | undefined {
  if (p.encryption === 'drm' || p.encryption === 'sample-aes') {
    return 'This stream is protected with DRM, so it cannot be downloaded.';
  }
  if (p.encryption === 'aes-128') {
    return 'This stream is encrypted by its publisher (AES-128 key protection), so it is not offered for download.';
  }
  if (!p.endList) {
    return 'This is a live stream that is still broadcasting. It can be downloaded only after the broadcast ends and becomes a complete recording.';
  }
  if (p.segments.length === 0) return 'This playlist contains no video segments.';
  return undefined;
}

export function variantLabel(v: HlsVariant): string {
  const res = v.height ? `${v.height}p` : v.audioOnly ? 'Audio only' : 'Auto';
  const rate = v.bandwidth ? ` · ${(v.bandwidth / 1_000_000).toFixed(v.bandwidth >= 10_000_000 ? 0 : 1)} Mbps` : '';
  const fps = v.frameRate && v.frameRate > 31 ? ` · ${Math.round(v.frameRate)}fps` : '';
  return `${res}${fps}${rate}`;
}

/** Rough size estimate from bandwidth × duration (bits → bytes). */
export function estimateBytes(bandwidth: number | undefined, durationSeconds: number): number | undefined {
  if (!bandwidth || !durationSeconds) return undefined;
  return Math.round((bandwidth * durationSeconds) / 8);
}
