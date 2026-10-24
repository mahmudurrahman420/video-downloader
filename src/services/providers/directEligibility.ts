/**
 * Pure rules for deciding whether a direct link is a downloadable video file.
 * No React Native / Expo imports, so this is unit-tested in Node.
 */
import { AppError, httpMessage } from '../errors';
import { VIDEO_EXTENSIONS } from '../url/detect';
import { sanitizeFileName } from '../../utils/format';

export interface ProbeResult {
  ok: boolean;
  status: number;
  contentType?: string;
  contentLength?: number;
  acceptsRanges: boolean;
  finalUrl: string;
  /** File name suggested by the server's Content-Disposition header. */
  fileName?: string;
}

type HeaderGetter = (name: string) => string | null | undefined;

/** Extract the filename from a Content-Disposition header (RFC 6266, incl. filename*=UTF-8''). */
export function parseContentDisposition(header?: string | null): string | undefined {
  if (!header) return undefined;
  const star = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = header.match(/filename\s*=\s*("([^"]*)"|[^;]+)/i);
  const name = plain ? (plain[2] ?? plain[1]).trim() : undefined;
  return name || undefined;
}

/** "bytes 0-0/12345" → 12345 */
export function totalFromContentRange(header?: string | null): number | undefined {
  if (!header) return undefined;
  const m = header.match(/\/(\d+)\s*$/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function positiveInt(v?: string | null): number | undefined {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Interpret a HEAD response. */
export function probeFromHead(status: number, ok: boolean, get: HeaderGetter, finalUrl: string): ProbeResult {
  return {
    ok,
    status,
    contentType: get('content-type') ?? undefined,
    contentLength: positiveInt(get('content-length')),
    acceptsRanges: (get('accept-ranges') ?? '').toLowerCase().includes('bytes'),
    finalUrl,
    fileName: parseContentDisposition(get('content-disposition')),
  };
}

/** Interpret a `Range: bytes=0-0` GET response. */
export function probeFromRangeGet(status: number, ok: boolean, get: HeaderGetter, finalUrl: string): ProbeResult {
  const partial = status === 206;
  return {
    ok,
    status,
    contentType: get('content-type') ?? undefined,
    // 206 → total is in Content-Range; 200 → server ignored Range and Content-Length is the full size.
    contentLength: partial ? totalFromContentRange(get('content-range')) : positiveInt(get('content-length')),
    acceptsRanges: partial,
    finalUrl,
    fileName: parseContentDisposition(get('content-disposition')),
  };
}

/** Combine a HEAD result with a range-GET result, preferring whichever knows more. */
export function mergeProbes(head: ProbeResult | undefined, range: ProbeResult): ProbeResult {
  if (!head || !head.ok) return range;
  if (!range.ok) return head;
  return {
    ok: true,
    status: head.status,
    contentType: head.contentType ?? range.contentType,
    contentLength: head.contentLength ?? range.contentLength,
    acceptsRanges: head.acceptsRanges || range.acceptsRanges,
    finalUrl: range.finalUrl || head.finalUrl,
    fileName: head.fileName ?? range.fileName,
  };
}

/** HEAD alone is enough when it gave us a size and range support. */
export function headIsSufficient(head: ProbeResult): boolean {
  return head.ok && !!head.contentLength && head.acceptsRanges;
}

export function extensionOf(name?: string): string | undefined {
  const m = name?.match(/\.([a-z0-9]{2,4})$/i);
  return m ? m[1].toLowerCase() : undefined;
}

const EXT_FOR_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'video/3gpp': '3gp',
  'video/ogg': 'ogv',
  'application/ogg': 'ogv',
  'video/x-msvideo': 'avi',
  'video/x-m4v': 'm4v',
};

export type DirectEligibility =
  | { eligible: true; mimeType?: string; fileName: string; label: string }
  | { eligible: false; error: AppError };

/**
 * Decide whether a probed direct link is a video file we may offer for download.
 * Rejects web pages, sign-in pages, non-video files and HTTP errors with specific messages.
 */
export function evaluateDirectProbe(probe: ProbeResult, urlPathname: string): DirectEligibility {
  if (!probe.ok) {
    return { eligible: false, error: new AppError('http', httpMessage(probe.status), probe.status) };
  }
  const type = (probe.contentType ?? '').split(';')[0].trim().toLowerCase();
  let pathName = '';
  try {
    pathName = decodeURIComponent(urlPathname.split('/').pop() ?? '');
  } catch {
    pathName = urlPathname.split('/').pop() ?? '';
  }
  const candidateName = probe.fileName || pathName;
  const ext = extensionOf(candidateName);
  const hasVideoExt = !!ext && VIDEO_EXTENSIONS.includes(ext);

  if (type === 'text/html' || type === 'application/xhtml+xml') {
    return {
      eligible: false,
      error: new AppError(
        'unsupported',
        'This link opens a web page, not a video file. Copy the direct link to the file itself (it usually ends in .mp4), or, if it is your own video on a platform, use that platform’s official download/export option.',
      ),
    };
  }
  if (type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('text/') || type.includes('json') || type.includes('xml') || type === 'application/pdf' || type === 'application/zip') {
    return {
      eligible: false,
      error: new AppError('unsupported', `This link points to a "${type}" file, not a video.`),
    };
  }

  if (type === 'application/x-mpegurl' || type === 'application/vnd.apple.mpegurl' || type === 'application/dash+xml' || ext === 'm3u8' || ext === 'mpd') {
    return {
      eligible: false,
      error: new AppError(
        'unsupported',
        type === 'application/dash+xml' || ext === 'mpd'
          ? 'This is a DASH stream (.mpd), which keeps video and audio in separate tracks; it can’t be joined into one file on the phone. Use an .m3u8 or .mp4 link if the site offers one.'
          : 'This is a streaming playlist, not a single file — it is handled by the HLS downloader instead.',
      ),
    };
  }

  const isVideoType = type.startsWith('video/') || type === 'application/ogg';
  const genericBinary = type === '' || type === 'application/octet-stream' || type === 'binary/octet-stream' || type === 'application/binary';
  if (!isVideoType && !(genericBinary && hasVideoExt)) {
    return {
      eligible: false,
      error: new AppError(
        'unsupported',
        genericBinary
          ? 'The server did not identify this file as a video, so it was not offered for download.'
          : `This link points to a "${type}" file, not a video.`,
      ),
    };
  }

  const finalExt = hasVideoExt ? ext! : EXT_FOR_MIME[type] ?? 'mp4';
  const baseName = candidateName && candidateName.trim() ? candidateName : 'video';
  const fileName = sanitizeFileName(hasVideoExt ? baseName : `${baseName.replace(/\.[a-z0-9]{1,5}$/i, '')}.${finalExt}`, finalExt);
  return {
    eligible: true,
    mimeType: isVideoType ? type : undefined,
    fileName,
    label: `${finalExt.toUpperCase()} file${type ? ` · ${type}` : ''}`,
  };
}
