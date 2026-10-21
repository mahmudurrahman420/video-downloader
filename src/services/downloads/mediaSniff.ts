/**
 * Identify a video container from its first bytes ("magic numbers").
 * Used after a download finishes so an HTML error page or login page served
 * with a 200 status is never saved and reported as a completed video.
 */
export type SniffResult =
  | { kind: 'video'; container: string }
  | { kind: 'not-video'; detected: string }
  | { kind: 'unknown' };

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function sniffMedia(bytes: Uint8Array): SniffResult {
  if (bytes.length < 4) return { kind: 'unknown' };

  // ISO-BMFF: MP4, MOV, M4V, 3GP — "ftyp" (or other top-level boxes) at offset 4.
  const box = ascii(bytes, 4, 4);
  if (box === 'ftyp') {
    const brand = ascii(bytes, 8, 4).trim();
    const container = /^3g/.test(brand) ? '3gp' : brand === 'qt' ? 'mov' : 'mp4';
    return { kind: 'video', container };
  }
  if (['moov', 'mdat', 'free', 'wide', 'skip'].includes(box)) return { kind: 'video', container: 'mp4' };

  // Matroska / WebM — EBML header.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { kind: 'video', container: 'webm/mkv' };
  }
  // Ogg
  if (ascii(bytes, 0, 4) === 'OggS') return { kind: 'video', container: 'ogg' };
  // AVI — RIFF....AVI
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 3) === 'AVI') return { kind: 'video', container: 'avi' };
  // FLV
  if (ascii(bytes, 0, 3) === 'FLV') return { kind: 'video', container: 'flv' };
  // MPEG program / transport stream
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0xba) return { kind: 'video', container: 'mpeg' };
  if (bytes[0] === 0x47 && (bytes.length < 189 || bytes[188] === 0x47)) return { kind: 'video', container: 'mpeg-ts' };

  // Common things servers send instead of a video.
  const head = ascii(bytes, 0, Math.min(bytes.length, 64)).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<body')) {
    return { kind: 'not-video', detected: 'a web page (HTML)' };
  }
  if (head.startsWith('<?xml') || head.startsWith('<error')) return { kind: 'not-video', detected: 'an XML error message' };
  if (head.startsWith('{') || head.startsWith('[')) return { kind: 'not-video', detected: 'a JSON error message' };
  if (head.startsWith('#extm3u')) return { kind: 'not-video', detected: 'a streaming playlist' };
  if (ascii(bytes, 0, 4) === '%PDF') return { kind: 'not-video', detected: 'a PDF document' };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { kind: 'not-video', detected: 'a ZIP archive' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { kind: 'not-video', detected: 'a JPEG image' };
  if (ascii(bytes, 1, 3) === 'PNG') return { kind: 'not-video', detected: 'a PNG image' };

  return { kind: 'unknown' };
}

/** Decode base64 without relying on atob/Buffer (works in Hermes and Node). */
export function base64ToBytes(b64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    buffer = (buffer << 6) | alphabet.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
