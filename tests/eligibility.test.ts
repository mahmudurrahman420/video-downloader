import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDirectProbe,
  headIsSufficient,
  mergeProbes,
  parseContentDisposition,
  probeFromHead,
  probeFromRangeGet,
  totalFromContentRange,
  type ProbeResult,
} from '../src/services/providers/directEligibility';
import { sourcePermitsDownload } from '../src/services/providers/policy';
import { downloadHttpError, httpMessage } from '../src/services/errors';

const headers = (h: Record<string, string>) => (n: string) => h[n.toLowerCase()] ?? null;
const probe = (p: Partial<ProbeResult>): ProbeResult => ({ ok: true, status: 200, acceptsRanges: true, finalUrl: 'https://x.test/a', ...p });

test('source policy: YouTube and Vimeo are never downloadable in-app', () => {
  assert.equal(sourcePermitsDownload('youtube'), false);
  assert.equal(sourcePermitsDownload('vimeo'), false);
  assert.equal(sourcePermitsDownload('unsupported'), false);
  assert.equal(sourcePermitsDownload('internet-archive'), true);
  assert.equal(sourcePermitsDownload('wikimedia-commons'), true);
  assert.equal(sourcePermitsDownload('direct'), true);
});

test('video content types are eligible', () => {
  const r = evaluateDirectProbe(probe({ contentType: 'video/mp4', contentLength: 1000 }), '/clip.mp4');
  assert.equal(r.eligible, true);
  if (r.eligible) {
    assert.equal(r.fileName, 'clip.mp4');
    assert.equal(r.mimeType, 'video/mp4');
  }
});

test('extension-less video gets a proper file name from the content type', () => {
  const r = evaluateDirectProbe(probe({ contentType: 'video/webm' }), '/get/abc');
  assert.equal(r.eligible && r.fileName, 'abc.webm');
});

test('Content-Disposition file name wins', () => {
  const r = evaluateDirectProbe(probe({ contentType: 'video/mp4', fileName: 'Holiday 2026.mp4' }), '/dl');
  assert.equal(r.eligible && r.fileName, 'Holiday 2026.mp4');
});

test('web pages, images, audio and playlists are rejected with clear reasons', () => {
  const html = evaluateDirectProbe(probe({ contentType: 'text/html; charset=utf-8' }), '/watch');
  assert.equal(html.eligible, false);
  assert.match(!html.eligible ? html.error.message : '', /web page/);
  assert.equal(!html.eligible && html.error.kind, 'unsupported');

  for (const t of ['image/jpeg', 'audio/mpeg', 'application/json', 'application/pdf']) {
    const r = evaluateDirectProbe(probe({ contentType: t }), '/x');
    assert.equal(r.eligible, false, t);
  }
  const hls = evaluateDirectProbe(probe({ contentType: 'application/vnd.apple.mpegurl' }), '/a.m3u8');
  assert.match(!hls.eligible ? hls.error.message : '', /streaming playlist/);
});

test('generic binary is only accepted when the name says it is a video', () => {
  assert.equal(evaluateDirectProbe(probe({ contentType: 'application/octet-stream' }), '/movie.mkv').eligible, true);
  assert.equal(evaluateDirectProbe(probe({ contentType: 'application/octet-stream' }), '/download').eligible, false);
  assert.equal(evaluateDirectProbe(probe({ contentType: undefined, fileName: 'a.mov' }), '/x').eligible, true);
});

test('HTTP failures map to accurate messages', () => {
  for (const [status, re] of [
    [401, /signing in/],
    [403, /forbidden/],
    [404, /could not be found/],
    [410, /permanently removed/],
    [429, /rate-limiting/],
    [503, /having problems/],
  ] as const) {
    const r = evaluateDirectProbe(probe({ ok: false, status }), '/a.mp4');
    assert.equal(r.eligible, false);
    if (!r.eligible) {
      assert.match(r.error.message, re);
      assert.equal(r.error.status, status);
    }
  }
  assert.match(httpMessage(500), /HTTP 500/);
  assert.match(downloadHttpError(403).message, /expired or require signing in/);
  assert.match(downloadHttpError(404).message, /no longer available/);
});

test('probe header parsing', () => {
  assert.equal(parseContentDisposition('attachment; filename="My Clip.mp4"'), 'My Clip.mp4');
  assert.equal(parseContentDisposition("attachment; filename*=UTF-8''%E0%A6%AD%E0%A6%BF.mp4"), 'ভি.mp4');
  assert.equal(parseContentDisposition('inline'), undefined);
  assert.equal(totalFromContentRange('bytes 0-0/52428800'), 52428800);
  assert.equal(totalFromContentRange('bytes 0-0/*'), undefined);

  const head = probeFromHead(200, true, headers({ 'content-type': 'video/mp4' }), 'u');
  assert.equal(head.contentLength, undefined);
  assert.equal(headIsSufficient(head), false);

  const range = probeFromRangeGet(206, true, headers({ 'content-range': 'bytes 0-0/1000', 'content-type': 'video/mp4' }), 'u2');
  assert.equal(range.contentLength, 1000);
  assert.equal(range.acceptsRanges, true);

  const ignored = probeFromRangeGet(200, true, headers({ 'content-length': '777' }), 'u');
  assert.equal(ignored.acceptsRanges, false);
  assert.equal(ignored.contentLength, 777);

  const merged = mergeProbes(head, range);
  assert.equal(merged.contentLength, 1000);
  assert.equal(merged.acceptsRanges, true);
  assert.equal(merged.contentType, 'video/mp4');
  assert.equal(merged.finalUrl, 'u2');
});
