/**
 * Find the video files a public web page openly publishes in its own markup:
 * Open Graph / Twitter player-stream tags, schema.org VideoObject (JSON-LD)
 * and HTML5 <video>/<source> elements. This is the same information a
 * browser's "save video" or a link-preview bot reads. Pure function, no I/O.
 */
import { resolveUrl } from '../url/resolveUrl';

export interface PageVideoCandidate {
  url: string;
  type?: string;
  width?: number;
  height?: number;
  source: 'og' | 'twitter' | 'json-ld' | 'video-tag';
}

export interface PageVideoInfo {
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  author?: string;
  candidates: PageVideoCandidate[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!m) return undefined;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim();
}

/** All <meta> tags as property/name → content values (in document order). */
function metaTags(html: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const key = (attr(m[0], 'property') ?? attr(m[0], 'name') ?? attr(m[0], 'itemprop'))?.toLowerCase();
    const value = attr(m[0], 'content');
    if (key && value) out.push({ key, value });
  }
  return out;
}

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

function walkJsonLd(node: unknown, found: Record<string, unknown>[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => walkJsonLd(n, found));
    return;
  }
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === 'string' && /VideoObject/i.test(t))) found.push(obj);
  for (const v of Object.values(obj)) if (v && typeof v === 'object') walkJsonLd(v, found);
}

export function extractPageVideos(html: string, pageUrl: string): PageVideoInfo {
  const metas = metaTags(html);
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const hit = metas.find((m) => m.key === k);
      if (hit) return hit.value;
    }
    return undefined;
  };
  const candidates: PageVideoCandidate[] = [];
  const push = (url: string | undefined, c: Omit<PageVideoCandidate, 'url'>) => {
    if (!url) return;
    const abs = resolveUrl(pageUrl, url);
    if (!isHttpUrl(abs)) return;
    if (candidates.some((x) => x.url === abs)) return;
    candidates.push({ url: abs, ...c });
  };

  // Open Graph: og:video[:secure_url|:url] with following :type/:width/:height.
  let current: PageVideoCandidate | undefined;
  for (const { key, value } of metas) {
    if (key === 'og:video' || key === 'og:video:url' || key === 'og:video:secure_url') {
      const abs = resolveUrl(pageUrl, value);
      if (current && (key !== 'og:video' && current.url.replace(/^http:/, 'https:') === abs.replace(/^http:/, 'https:'))) continue;
      push(value, { source: 'og' });
      current = candidates.find((c) => c.url === abs);
    } else if (current && key === 'og:video:type') current.type = value.toLowerCase();
    else if (current && key === 'og:video:width') current.width = Number(value) || undefined;
    else if (current && key === 'og:video:height') current.height = Number(value) || undefined;
  }
  push(get('twitter:player:stream'), { source: 'twitter', type: get('twitter:player:stream:content_type')?.toLowerCase() });

  // schema.org VideoObject
  const ldRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld: RegExpExecArray | null;
  const videoObjects: Record<string, unknown>[] = [];
  while ((ld = ldRe.exec(html))) {
    try {
      walkJsonLd(JSON.parse(ld[1].trim()), videoObjects);
    } catch {
      /* malformed JSON-LD is common; ignore */
    }
  }
  for (const vo of videoObjects) {
    const url = typeof vo.contentUrl === 'string' ? vo.contentUrl : undefined;
    push(url, {
      source: 'json-ld',
      type: typeof vo.encodingFormat === 'string' ? vo.encodingFormat.toLowerCase() : undefined,
      width: Number(vo.width) || undefined,
      height: Number(vo.height) || undefined,
    });
  }

  // HTML5 <video src> and <source src type>
  const videoRe = /<video\b[^>]*>([\s\S]*?)<\/video>|<video\b[^>]*\/?>/gi;
  let v: RegExpExecArray | null;
  while ((v = videoRe.exec(html))) {
    const openTag = v[0].match(/<video\b[^>]*>/i)?.[0] ?? '';
    push(attr(openTag, 'src'), { source: 'video-tag', type: attr(openTag, 'type')?.toLowerCase() });
    const inner = v[1] ?? '';
    const srcRe = /<source\b[^>]*>/gi;
    let s: RegExpExecArray | null;
    while ((s = srcRe.exec(inner))) {
      const sizeAttr = attr(s[0], 'size') ?? attr(s[0], 'res') ?? attr(s[0], 'data-res');
      push(attr(s[0], 'src'), {
        source: 'video-tag',
        type: attr(s[0], 'type')?.toLowerCase(),
        height: sizeAttr && /^\d+$/.test(sizeAttr) ? Number(sizeAttr) : undefined,
      });
    }
  }

  const ldFirst = videoObjects[0];
  const ldThumb = ldFirst?.thumbnailUrl;
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    title: get('og:title', 'twitter:title') ?? (typeof ldFirst?.name === 'string' ? ldFirst.name : undefined) ?? (titleTag ? decodeEntities(titleTag).trim() : undefined),
    description: get('og:description', 'description'),
    thumbnailUrl: (() => {
      const t = get('og:image:secure_url', 'og:image', 'twitter:image') ?? (typeof ldThumb === 'string' ? ldThumb : Array.isArray(ldThumb) && typeof ldThumb[0] === 'string' ? ldThumb[0] : undefined);
      return t ? resolveUrl(pageUrl, t) : undefined;
    })(),
    author: get('author', 'article:author'),
    candidates: candidates.filter((c) => !/^text\/html/.test(c.type ?? '') && !/shockwave|flash/.test(c.type ?? '')),
  };
}

export function isHlsCandidate(c: PageVideoCandidate): boolean {
  return /mpegurl/i.test(c.type ?? '') || /\.m3u8(\?|#|$)/i.test(c.url);
}
