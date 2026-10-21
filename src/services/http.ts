import * as Network from 'expo-network';
import type { ErrorKind } from '../types';

export class AppError extends Error {
  kind: ErrorKind;
  status?: number;
  constructor(kind: ErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true; // Unknown — let the request itself decide.
  }
}

export async function isOnWifi(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type === Network.NetworkStateType.WIFI || state.type === Network.NetworkStateType.ETHERNET;
  } catch {
    return false;
  }
}

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

export function httpMessage(status: number): string {
  if (status === 401 || status === 403) return 'This video is private or access is restricted.';
  if (status === 404) return 'The video could not be found. It may have been removed.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status >= 500) return 'The source server is having problems. Try again later.';
  return `The server returned an error (HTTP ${status}).`;
}

export interface ProbeResult {
  ok: boolean;
  status: number;
  contentType?: string;
  contentLength?: number;
  acceptsRanges: boolean;
  finalUrl: string;
}

/**
 * Learn a file's size/type/range support without downloading it.
 * Tries HEAD first, then a 1-byte ranged GET for servers that reject HEAD.
 */
export async function probeFile(url: string): Promise<ProbeResult> {
  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD' }, 12000);
    if (head.ok) {
      const len = Number(head.headers.get('content-length'));
      return {
        ok: true,
        status: head.status,
        contentType: head.headers.get('content-type') ?? undefined,
        contentLength: Number.isFinite(len) && len > 0 ? len : undefined,
        acceptsRanges: (head.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes'),
        finalUrl: head.url || url,
      };
    }
    if (head.status !== 405 && head.status !== 501 && head.status !== 403) {
      return { ok: false, status: head.status, acceptsRanges: false, finalUrl: url };
    }
  } catch (e) {
    if (e instanceof AppError && e.kind === 'offline') throw e;
  }

  const res = await fetchWithTimeout(url, { method: 'GET', headers: { Range: 'bytes=0-0' } }, 12000);
  const range = res.headers.get('content-range'); // bytes 0-0/12345
  const total = range ? Number(range.split('/')[1]) : Number(res.headers.get('content-length'));
  // We only wanted the headers; stop the body.
  try {
    // @ts-ignore - body may be undefined in React Native
    res.body?.cancel?.();
  } catch {}
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get('content-type') ?? undefined,
    contentLength: Number.isFinite(total) && total > 1 ? total : undefined,
    acceptsRanges: res.status === 206,
    finalUrl: res.url || url,
  };
}
