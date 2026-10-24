import { isOnline } from './networkStatus';
import { AppError, httpMessage } from './errors';
import {
  headIsSufficient,
  mergeProbes,
  probeFromHead,
  probeFromRangeGet,
  type ProbeResult,
} from './providers/directEligibility';

export { AppError, httpMessage } from './errors';

export { isOnline, isOnWifi } from './networkStatus';

/** fetch() with a timeout and errors mapped to user-friendly kinds. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  if (!(await isOnline())) {
    throw new AppError('offline', 'You appear to be offline. Check your connection and try again.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: unknown) {
    if (controller.signal.aborted) {
      throw new AppError('timeout', 'The server took too long to respond. Please try again.');
    }
    throw new AppError('offline', 'Network request failed. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJSON<T>(url: string, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, timeoutMs);
  if (!res.ok) {
    throw new AppError('http', httpMessage(res.status), res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new AppError('unknown', 'The server sent an unexpected response.');
  }
}

export type { ProbeResult } from './providers/directEligibility';

/**
 * Learn a file's size, type, filename and range support without downloading it.
 * HEAD first; if HEAD is rejected or incomplete (no size / no range info), a
 * 1-byte ranged GET fills the gaps.
 */
export async function probeFile(url: string): Promise<ProbeResult> {
  let head: ProbeResult | undefined;
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD' }, 12000);
    head = probeFromHead(res.status, res.ok, (n) => res.headers.get(n), res.url || url);
    if (headIsSufficient(head)) return head;
    // Definitive answers from the server — no point retrying with GET.
    if (!res.ok && [401, 404, 410].includes(res.status)) return head;
  } catch (e) {
    if (e instanceof AppError && e.kind === 'offline') throw e;
  }

  try {
    const res = await fetchWithTimeout(url, { method: 'GET', headers: { Range: 'bytes=0-0' } }, 15000);
    const range = probeFromRangeGet(res.status, res.ok, (n) => res.headers.get(n), res.url || url);
    return mergeProbes(head, range);
  } catch (e) {
    if (head?.ok) return head; // HEAD already told us enough to proceed.
    if (head) return head; // report the HEAD status code
    throw e;
  }
}

export interface TextResponse {
  status: number;
  ok: boolean;
  contentType: string;
  finalUrl: string;
  text: string;
}

/**
 * GET a text resource (playlist, web page). Large bodies are truncated to
 * `maxChars` so a mistaken link to a huge file can't exhaust memory.
 */
export async function fetchText(url: string, maxChars = 2_000_000, timeoutMs = 15000): Promise<TextResponse> {
  const res = await fetchWithTimeout(
    url,
    { headers: { Accept: 'text/html,application/xhtml+xml,application/vnd.apple.mpegurl,*/*;q=0.8' } },
    timeoutMs,
  );
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  let text = '';
  const isPlaylistType = contentType.includes('mpegurl');
  if (res.ok && (isPlaylistType || (!contentType.startsWith('video/') && !contentType.startsWith('audio/') && !contentType.startsWith('image/')))) {
    text = await res.text();
    if (text.length > maxChars) text = text.slice(0, maxChars);
  }
  return { status: res.status, ok: res.ok, contentType, finalUrl: res.url || url, text };
}
