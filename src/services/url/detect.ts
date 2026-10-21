import type { ProviderId } from '../../types';
import { hostMatches, parseUrl, ParsedUrl } from './parseUrl';

export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mkv', 'mov', '3gp', 'ogv', 'avi'];

/**
 * Hosts whose raw media URLs are signed, temporary stream links extracted
 * from a platform player. Downloading them bypasses the platform's terms,
 * so the app refuses them even though they look like "direct files".
 */
const PLATFORM_STREAM_HOSTS = [
  'googlevideo.com',
  'fbcdn.net',
  'cdninstagram.com',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'twimg.com',
  'vimeocdn.com',
  'akamaized.net',
  'nflxvideo.net',
];

/** Platforms we recognise but cannot download from. */
const VIEW_ONLY_PLATFORMS: { domain: string; name: string }[] = [
  { domain: 'facebook.com', name: 'Facebook' },
  { domain: 'fb.watch', name: 'Facebook' },
  { domain: 'instagram.com', name: 'Instagram' },
  { domain: 'tiktok.com', name: 'TikTok' },
  { domain: 'twitter.com', name: 'X (Twitter)' },
  { domain: 'x.com', name: 'X (Twitter)' },
  { domain: 'dailymotion.com', name: 'Dailymotion' },
  { domain: 'twitch.tv', name: 'Twitch' },
  { domain: 'netflix.com', name: 'Netflix' },
];

export type Detection =
  | { kind: 'invalid'; reason: string }
  | {
      kind: 'supported';
      provider: ProviderId;
      url: ParsedUrl;
      id?: string;
      /** Direct link without a recognisable video extension: the server's response decides. */
      needsServerCheck?: boolean;
    }
  | { kind: 'unsupported'; url: ParsedUrl; platformName?: string; reason: string };

export function youtubeId(u: ParsedUrl): string | undefined {
  const idRe = /^[A-Za-z0-9_-]{11}$/;
  if (hostMatches(u.host, 'youtu.be')) {
    const id = u.pathname.split('/')[1];
    return id && idRe.test(id) ? id : undefined;
  }
  if (hostMatches(u.host, 'youtube.com') || hostMatches(u.host, 'youtube-nocookie.com')) {
    if (u.query.v && idRe.test(u.query.v)) return u.query.v;
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : undefined;
  }
  return undefined;
}

/** File types that are clearly not videos — rejected without a network request. */
const NON_VIDEO_EXTENSIONS = [
  'html', 'htm', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'pdf', 'zip', 'rar', '7z',
  'apk', 'exe', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'mp3', 'm4a', 'wav', 'flac', 'aac', 'json', 'xml',
];

/** Streaming manifests are not single files and cannot be saved as one download. */
const STREAM_MANIFEST_EXTENSIONS = ['m3u8', 'mpd'];

/**
 * Dropbox share links (dl=0) open a preview page. Dropbox documents that
 * setting dl=1 returns the file itself — the owner's official direct link.
 */
export function dropboxDirectUrl(u: ParsedUrl): string | undefined {
  if (!hostMatches(u.host, 'dropbox.com')) return undefined;
  if (!/^\/(s|scl\/fi|sh)\//.test(u.pathname)) return undefined;
  const [base, frag] = u.href.split('#');
  let next: string;
  if (/[?&]dl=\d/.test(base)) next = base.replace(/([?&])dl=\d/, '$1dl=1');
  else next = `${base}${base.includes('?') ? '&' : '?'}dl=1`;
  return frag ? `${next}#${frag}` : next;
}

function fileExtension(pathname: string): string | undefined {
  const last = pathname.split('/').pop() ?? '';
  const m = last.match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : undefined;
}

export function detectSource(input: string): Detection {
  if (!input.trim()) return { kind: 'invalid', reason: 'Paste or type a video link first.' };
  const u = parseUrl(input);
  if (!u) {
    return {
      kind: 'invalid',
      reason: "That doesn't look like a valid web link. Links start with http:// or https://.",
    };
  }

  // YouTube
  if (hostMatches(u.host, 'youtube.com') || hostMatches(u.host, 'youtu.be') || hostMatches(u.host, 'youtube-nocookie.com')) {
    const id = youtubeId(u);
    if (!id) {
      return { kind: 'unsupported', url: u, platformName: 'YouTube', reason: 'This YouTube link does not point to a single video.' };
    }
    return { kind: 'supported', provider: 'youtube', url: u, id };
  }

  // Vimeo
  if (hostMatches(u.host, 'vimeo.com')) {
    const m = u.pathname.match(/\/(\d{5,})/);
    if (!m) return { kind: 'unsupported', url: u, platformName: 'Vimeo', reason: 'This Vimeo link does not point to a single video.' };
    return { kind: 'supported', provider: 'vimeo', url: u, id: m[1] };
  }

  // Internet Archive: archive.org/details/<identifier>
  if (hostMatches(u.host, 'archive.org')) {
    const m = u.pathname.match(/^\/(?:details|download|embed)\/([^/]+)/);
    if (!m) return { kind: 'unsupported', url: u, platformName: 'Internet Archive', reason: 'Open a specific item page (archive.org/details/…) and copy its link.' };
    return { kind: 'supported', provider: 'internet-archive', url: u, id: decodeURIComponent(m[1]) };
  }

  // Wikimedia Commons file pages
  if (hostMatches(u.host, 'commons.wikimedia.org')) {
    const fromPath = u.pathname.match(/^\/wiki\/(File:.+)$/i);
    const title = fromPath ? decodeURIComponent(fromPath[1]) : u.query.title?.startsWith('File:') ? u.query.title : undefined;
    if (!title) return { kind: 'unsupported', url: u, platformName: 'Wikimedia Commons', reason: 'Open a specific file page (commons.wikimedia.org/wiki/File:…) and copy its link.' };
    return { kind: 'supported', provider: 'wikimedia-commons', url: u, id: title.replace(/_/g, ' ') };
  }

  // Platform stream CDNs are never downloadable.
  if (PLATFORM_STREAM_HOSTS.some((d) => hostMatches(u.host, d))) {
    return {
      kind: 'unsupported',
      url: u,
      reason: 'This is a temporary streaming link taken from a video platform. Downloading it is not authorized by the platform.',
    };
  }

  const platform = VIEW_ONLY_PLATFORMS.find((p) => hostMatches(u.host, p.domain));
  if (platform) {
    return {
      kind: 'unsupported',
      url: u,
      platformName: platform.name,
      reason: `${platform.name} does not offer an official download API for third-party apps. You can watch it in the official app or website.`,
    };
  }

  if (hostMatches(u.host, 'drive.google.com') || hostMatches(u.host, 'docs.google.com')) {
    return {
      kind: 'unsupported',
      url: u,
      platformName: 'Google Drive',
      reason:
        'Google Drive share links open a preview page, not the file. Open the file in Google Drive and use its Download button, or host the file somewhere that provides a direct link.',
    };
  }

  const dropbox = dropboxDirectUrl(u);
  if (dropbox) {
    const du = parseUrl(dropbox);
    if (du) return { kind: 'supported', provider: 'direct', url: du, needsServerCheck: true };
  }

  const ext = fileExtension(u.pathname);
  if (ext && STREAM_MANIFEST_EXTENSIONS.includes(ext)) {
    return {
      kind: 'unsupported',
      url: u,
      reason: 'This is a streaming playlist (HLS/DASH), not a single video file, so it cannot be saved as a download.',
    };
  }
  if (ext && NON_VIDEO_EXTENSIONS.includes(ext)) {
    return { kind: 'unsupported', url: u, reason: `This link points to a .${ext} file, not a video.` };
  }
  if (ext && VIDEO_EXTENSIONS.includes(ext)) {
    return { kind: 'supported', provider: 'direct', url: u };
  }

  // Any other http(s) link may still be a direct media file (CDN links, ?download=1,
  // signed storage URLs). Ask the server what it actually serves before deciding.
  return { kind: 'supported', provider: 'direct', url: u, needsServerCheck: true };
}
