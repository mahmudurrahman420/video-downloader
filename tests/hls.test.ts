import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hlsUnsupportedReason,
  parseAttributes,
  parseMasterPlaylist,
  parseMediaPlaylist,
  variantLabel,
} from '../src/services/hls/playlist';
import { resolveUrl } from '../src/services/url/resolveUrl';
import { runHlsDownload, type HlsEngineDeps } from '../src/services/downloads/hlsEngine';
import { extractPageVideos } from '../src/services/web/extractPageVideos';

// ---- URL resolution -------------------------------------------------------------

test('resolveUrl handles relative, absolute, root and dot paths', () => {
  const base = 'https://cdn.example.com/a/b/master.m3u8?t=1';
  assert.equal(resolveUrl(base, 'low/index.m3u8'), 'https://cdn.example.com/a/b/low/index.m3u8');
  assert.equal(resolveUrl(base, '/x/y.ts'), 'https://cdn.example.com/x/y.ts');
  assert.equal(resolveUrl(base, '../c/seg.ts?k=2'), 'https://cdn.example.com/a/c/seg.ts?k=2');
  assert.equal(resolveUrl(base, '//other.net/s.ts'), 'https://other.net/s.ts');
  assert.equal(resolveUrl(base, 'https://z.com/q.ts'), 'https://z.com/q.ts');
  assert.equal(resolveUrl('https://h.com', 'seg.ts'), 'https://h.com/seg.ts');
});

// ---- Parsing --------------------------------------------------------------------------

test('attribute lists with quoted commas', () => {
  assert.deepEqual(parseAttributes('BANDWIDTH=1,CODECS="avc1.4d,mp4a.40.2",RESOLUTION=640x360'), {
    BANDWIDTH: '1',
    CODECS: 'avc1.4d,mp4a.40.2',
    RESOLUTION: '640x360',
  });
});

test('master playlist variants: sorted, deduplicated, labelled', () => {
  const v = parseMasterPlaylist(
    `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1200000,AVERAGE-BANDWIDTH=1000000,RESOLUTION=1280x720,FRAME-RATE=60
720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=480x270
270.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=480x270
270.m3u8`,
    'https://e.com/v/master.m3u8',
  );
  assert.equal(v.length, 2);
  assert.equal(v[0].height, 720);
  assert.equal(v[0].bandwidth, 1000000);
  assert.equal(variantLabel(v[0]), '720p · 60fps · 1.0 Mbps');
});

test('media playlist: init segment, byte ranges, container and duration', () => {
  const p = parseMediaPlaylist(
    `#EXTM3U
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
#EXT-X-BYTERANGE:1000@0
media.m4s
#EXTINF:4.5,
#EXT-X-BYTERANGE:800
media.m4s`,
    'https://e.com/v/1080/index.m3u8',
  );
  assert.equal(p.container, 'mp4');
  assert.equal(p.init?.uri, 'https://e.com/v/1080/init.mp4');
  assert.deepEqual(p.segments[1].byteRange, { length: 800, offset: 1000 });
  assert.equal(p.totalDuration, 10.5);
  assert.equal(p.endList, true, 'VOD playlists are complete');
  assert.equal(hlsUnsupportedReason(p), undefined);
});

test('METHOD=NONE keys are fine; AES-128 is refused', () => {
  const ok = parseMediaPlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST', 'https://e.com/');
  assert.equal(hlsUnsupportedReason(ok), undefined);
  const aes = parseMediaPlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST', 'https://e.com/');
  assert.equal(aes.encryption, 'aes-128');
  assert.match(hlsUnsupportedReason(aes)!, /encrypted/);
});

// ---- Page extraction -----------------------------------------------------------------

test('JSON-LD VideoObject and HLS candidates are extracted', () => {
  const info = extractPageVideos(
    `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"VideoObject","name":"Talk","contentUrl":"/v/talk.m3u8","thumbnailUrl":["/t.jpg"]}]}</script>`,
    'https://conf.example.org/talks/1',
  );
  assert.equal(info.title, 'Talk');
  assert.equal(info.candidates[0].url, 'https://conf.example.org/v/talk.m3u8');
  assert.equal(info.thumbnailUrl, 'https://conf.example.org/t.jpg');
});

// ---- Engine ------------------------------------------------------------------------------

const TS_SEG = (n: number) => {
  const b = new Uint8Array(n);
  b[0] = 0x47;
  if (n > 188) b[188] = 0x47;
  return b;
};

function fakeHls(opts: {
  playlist: string;
  segment: (url: string, attempt: number, headers: Record<string, string>) => { status: number; bytes?: Uint8Array } | 'throw' | null;
  online?: () => boolean;
}) {
  const files = new Map<string, Uint8Array>();
  const attempts = new Map<string, number>();
  const delays: number[] = [];
  const deps: HlsEngineDeps = {
    isOnline: async () => (opts.online ? opts.online() : true),
    isOnWifi: async () => true,
    ensureDir: async () => {},
    fileSize: async (u) => files.get(u)?.length ?? 0,
    deleteFile: async (u) => void files.delete(u),
    readHeader: async (u) => (files.get(u) ?? new Uint8Array()).slice(0, 512),
    fetchText: async () => ({ ok: true, status: 200, text: opts.playlist, finalUrl: 'https://s.example.com/v/index.m3u8' }),
    appendFile: async (src, dest) => {
      const a = files.get(dest) ?? new Uint8Array();
      const b = files.get(src) ?? new Uint8Array();
      const out = new Uint8Array(a.length + b.length);
      out.set(a);
      out.set(b, a.length);
      files.set(dest, out);
    },
    delay: async (ms) => void delays.push(ms),
    createSegmentTask: (url, fileUri, headers) => ({
      downloadAsync: async () => {
        const n = (attempts.get(url) ?? 0) + 1;
        attempts.set(url, n);
        const r = opts.segment(url, n, headers);
        if (r === 'throw') throw new Error('socket');
        if (r === null) return null;
        if (r.bytes) files.set(fileUri, r.bytes);
        return { status: r.status };
      },
    }),
  };
  return { deps, files, attempts, delays };
}

const PL = `#EXTM3U
#EXTINF:4,
s0.ts
#EXTINF:4,
s1.ts
#EXTINF:4,
s2.ts
#EXT-X-ENDLIST`;
const input = { playlistUrl: 'https://s.example.com/v/index.m3u8', tempUri: 'out.ts', segmentTempUri: 'seg.tmp', wifiOnly: false };

test('engine joins all segments in order and verifies MPEG-TS output', async () => {
  const progress: number[] = [];
  const f = fakeHls({ playlist: PL, segment: () => ({ status: 200, bytes: TS_SEG(376) }) });
  const out = await runHlsDownload(input, f.deps, { onProgress: (cp) => progress.push(cp.segmentsDone) });
  assert.deepEqual(out, { type: 'downloaded', size: 1128, container: 'mpeg-ts' });
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(f.files.has('seg.tmp'), false, 'temporary segment cleaned up');
});

test('engine resumes from a matching checkpoint and skips finished segments', async () => {
  const f = fakeHls({ playlist: PL, segment: () => ({ status: 200, bytes: TS_SEG(376) }) });
  f.files.set('out.ts', TS_SEG(752));
  const out = await runHlsDownload({ ...input, checkpoint: { segmentsDone: 2, segmentCount: 3, bytesCommitted: 752 } }, f.deps);
  assert.equal(out.type, 'downloaded');
  assert.equal(f.attempts.get('https://s.example.com/v/s0.ts'), undefined);
  assert.equal(f.attempts.get('https://s.example.com/v/s2.ts'), 1);
});

test('engine restarts when the file on disk does not match the checkpoint', async () => {
  const f = fakeHls({ playlist: PL, segment: () => ({ status: 200, bytes: TS_SEG(376) }) });
  f.files.set('out.ts', TS_SEG(500));
  const out = await runHlsDownload({ ...input, checkpoint: { segmentsDone: 2, segmentCount: 3, bytesCommitted: 752 } }, f.deps);
  assert.equal(out.type === 'downloaded' && out.size, 1128);
  assert.equal(f.attempts.get('https://s.example.com/v/s0.ts'), 1);
});

test('transient segment failures are retried with backoff', async () => {
  const f = fakeHls({
    playlist: PL,
    segment: (url, n) => (url.endsWith('s1.ts') && n < 3 ? (n === 1 ? 'throw' : { status: 503 }) : { status: 200, bytes: TS_SEG(376) }),
  });
  const out = await runHlsDownload(input, f.deps);
  assert.equal(out.type, 'downloaded');
  assert.deepEqual(f.delays, [1000, 2000]);
});

test('a missing segment (404) fails with committed progress kept', async () => {
  const f = fakeHls({ playlist: PL, segment: (url) => (url.endsWith('s2.ts') ? { status: 404 } : { status: 200, bytes: TS_SEG(376) }) });
  const out = await runHlsDownload(input, f.deps);
  assert.equal(out.type, 'failed');
  if (out.type === 'failed') {
    assert.equal(out.error.status, 404);
    assert.equal(out.bytesWritten, 752);
  }
});

test('connection loss mid-stream reports offline and keeps finished segments', async () => {
  let online = true;
  const f = fakeHls({
    playlist: PL,
    online: () => online,
    segment: (url) => {
      if (url.endsWith('s1.ts')) {
        online = false;
        return 'throw';
      }
      return { status: 200, bytes: TS_SEG(376) };
    },
  });
  const out = await runHlsDownload(input, f.deps);
  assert.equal(out.type === 'failed' && out.error.kind, 'offline');
  assert.equal(out.type === 'failed' && out.bytesWritten, 376);
});

test('pause between or during segments returns stopped', async () => {
  let stop = false;
  const f = fakeHls({ playlist: PL, segment: (url) => (url.endsWith('s1.ts') ? null : { status: 200, bytes: TS_SEG(376) }) });
  assert.deepEqual(await runHlsDownload(input, f.deps), { type: 'stopped', bytesWritten: 376 });
  const g = fakeHls({
    playlist: PL,
    segment: () => {
      stop = true;
      return { status: 200, bytes: TS_SEG(376) };
    },
  });
  g.deps.shouldStop = () => stop;
  assert.deepEqual(await runHlsDownload(input, g.deps), { type: 'stopped', bytesWritten: 376 });
});

test('byte-range segments send Range headers and require 206', async () => {
  const ranged = `#EXTM3U\n#EXTINF:4,\n#EXT-X-BYTERANGE:376@0\nall.ts\n#EXTINF:4,\n#EXT-X-BYTERANGE:376\nall.ts\n#EXT-X-ENDLIST`;
  const seen: string[] = [];
  const f = fakeHls({
    playlist: ranged,
    segment: (_u, _n, h) => {
      seen.push(h.Range);
      return { status: 206, bytes: TS_SEG(376) };
    },
  });
  assert.equal((await runHlsDownload(input, f.deps)).type, 'downloaded');
  assert.deepEqual(seen, ['bytes=0-375', 'bytes=376-751']);

  const g = fakeHls({ playlist: ranged, segment: () => ({ status: 200, bytes: TS_SEG(376) }) });
  const out = await runHlsDownload(input, g.deps);
  assert.match(out.type === 'failed' ? out.error.message : '', /byte-range/);
});

test('a playlist that became encrypted, or HTML segments, never produce a "completed" file', async () => {
  const enc = fakeHls({ playlist: PL.replace('#EXTM3U', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"'), segment: () => ({ status: 200, bytes: TS_SEG(10) }) });
  assert.equal((await runHlsDownload(input, enc.deps)).type, 'failed');

  const html = new TextEncoder().encode('<!DOCTYPE html><html>denied</html>');
  const h = fakeHls({ playlist: PL, segment: () => ({ status: 200, bytes: html }) });
  const out = await runHlsDownload(input, h.deps);
  assert.match(out.type === 'failed' ? out.error.message : '', /web page/);
  assert.equal(h.files.has('out.ts'), false);
});
