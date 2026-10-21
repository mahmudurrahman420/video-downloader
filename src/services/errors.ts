import type { ErrorKind } from '../types';

/** Error with a user-facing message and a machine-readable kind. No native imports, so it's testable. */
export class AppError extends Error {
  kind: ErrorKind;
  status?: number;
  constructor(kind: ErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/** Messages for HTTP failures while looking a link up. */
export function httpMessage(status: number): string {
  if (status === 401) return 'This file requires signing in. Only publicly accessible files can be downloaded.';
  if (status === 403) return 'Access to this file is forbidden. It may be private or restricted by its owner.';
  if (status === 404) return 'The file could not be found (HTTP 404). It may have been moved or removed.';
  if (status === 410) return 'This file has been permanently removed (HTTP 410).';
  if (status === 429) return 'The server is rate-limiting requests (HTTP 429). Wait a moment and try again.';
  if (status >= 500) return `The source server is having problems (HTTP ${status}). Try again later.`;
  return `The server returned an error (HTTP ${status}).`;
}

/** Messages for HTTP failures that happen during the actual download. */
export function downloadHttpError(status: number): AppError {
  if (status === 401 || status === 403) {
    return new AppError(
      'http',
      `The server denied access to the file (HTTP ${status}). The link may have expired or require signing in — fetch the link again.`,
      status,
    );
  }
  if (status === 404 || status === 410) {
    return new AppError('http', `The file is no longer available on the server (HTTP ${status}).`, status);
  }
  if (status === 429) {
    return new AppError('http', 'The server is rate-limiting downloads (HTTP 429). Wait a minute, then tap Retry.', status);
  }
  if (status >= 500) {
    return new AppError('http', `The server failed while sending the file (HTTP ${status}). Tap Retry later.`, status);
  }
  return new AppError('http', `The server refused the download (HTTP ${status}).`, status);
}
