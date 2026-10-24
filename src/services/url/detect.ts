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

export function isPlatformStreamHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return PLATFORM_STREAM_HOSTS.some((d) => hostMatches(h, d));
}

/** Platforms we recognise but cannot download from. */
const VIEW_ONLY_PLATFORMS: { domain: string; name: string; reason: string }[] = [
  {
    domain: 'facebook.com',
    name: 'Facebook',
    reason:
      "Facebook doesn't let third-party apps download videos from its pages; its video files are only reachable through Facebook's own player. To save your own Facebook videos, use Facebook's \"Download your information\" tool, or the Download option on videos you posted.",
  },
  {
    domain: 'fb.watch',
    name: 'Facebook',
    reason:
      "Facebook doesn't let third-party apps download videos; they are only reachable through Facebook's own player. Your own videos can be exported with Facebook's \"Download your information\" tool.",
  },
  {
    domain: 'instagram.com',
    name: 'Instagram',
    reason:
      "Instagram doesn't let third-party apps download posts or reels; video files are only served to Instagram's own player. Your own posts can be exported with Instagram's \"Download your information\" tool (Accounts Center).",
  },
  {
    domain: 'tiktok.com',
    name: 'TikTok',
    reason:
      "TikTok doesn't offer third-party apps a download API. Use the Save video option in the TikTok app — it appears when the creator has allowed downloads. Your own videos can be exported from TikTok's Download your data tool.",
  },
  {
    domain: 'twitter.com',
    name: 'X (Twitter)',
    reason: "X doesn't let third-party apps download videos; they're only served to X's own player.",
  },
  {
    domain: 'x.com',
    name: 'X (Twitter)',
    reason: "X doesn't let third-party apps download videos; they're only served to X's own player.",
  },
  {
    domain: 'dailymotion.com',
    name: 'Dailymotion',
    reason: "Dailymotion doesn't offer third-party apps a download method. Watch it on Dailymotion.",
  },
  {
    domain: 'twitch.tv',
    name: 'Twitch',
    reason: "Twitch doesn't offer third-party apps a download method. Streamers can download their own past broadcasts from the Twitch Creator Dashboard.",
  },
  { domain: 'netflix.com', name: 'Netflix', reason: 'Netflix content is DRM-protected and can only be saved inside the Netflix app.' },
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
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'pdf', 'zip', 'rar', '7z',
  'apk', 'exe', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'mp3', 'm4a', 'wav', 'flac', 'aac', 'json', 'xml',
];



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
    // archive.org/download/<item>/<file.mp4> is a direct file link (it redirects to a storage node).
    const fileLink = u.pathname.match(/^\/download\/[^/]+\/.+\.([a-z0-9]{2,4})$/i);
    if (fileLink && VIDEO_EXTENSIONS.includes(fileLink[1].toLowerCase())) {
      return { kind: 'supported', provider: 'direct', url: u };
    }
    const m = u.pathname.match(/^\/(?:details|download|embed)\/([^/]+)/);
    if (!m) return { kind: 'unsupported', url: u, platformName: 'Internet Archive', reason: 'Open a specific item page (archive.org/details/…) and copy its link.' };
    return { kind: 'supported', provider: 'internet-archive', url: u, id: decodeURIComponent(m[1]) };
  }

  // Wikimedia Commons file pages
  if (hostMatches(u.host, 'commons.wikimedia.org')) {
    let path = u.pathname;
    try {
      path = decodeURIComponent(path); // shared links often encode ":" as %3A
    } catch {
      /* keep raw */
    }
    const fromPath = path.match(/^\/wiki\/(File:.+)$/i);
    const title = fromPath ? fromPath[1] : u.query.title?.startsWith('File:') ? u.query.title : undefined;
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
      reason: platform.reason,
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
  if (ext === 'm3u8') {
    // HLS stream: the HLS adapter checks it's complete and unencrypted before offering it.
    return { kind: 'supported', provider: 'hls', url: u };
  }
  if (ext === 'mpd') {
    return {
      kind: 'unsupported',
      url: u,
      reason:
        'This is a DASH stream (.mpd). DASH keeps video and audio in separate tracks that must be re-muxed into one file, which this app can’t do on the phone yet. If the site also offers an .m3u8 (HLS) or .mp4 link, use that instead.',
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
