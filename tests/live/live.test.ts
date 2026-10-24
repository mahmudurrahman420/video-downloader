/**
 * LIVE integration tests — real network, real services. Run in CI
 * (`npm run test:live`) before the APK is built. A provider is only listed as
 * supported if its live test passes here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLink } from '../../src/services/providers';
import { sniffMedia } from '../../src/services/downloads/mediaSniff';
import { runHlsDownload, type HlsEngineDeps } from '../../src/services/downloads/hlsEngine';
import { parseMediaPlaylist } from '../../src/services/hls/playlist';
import type { VideoMetadata } from '../../src/types';

const T = { timeout: 90_000 };

async function meta(url: string): Promise<VideoMetadata> {
  const r = await resolveLink(url);
  assert.equal(r.type, 'metadata', `expected metadata for ${url}, got ${JSON.stringify(r)}`);
  return (r as { data: VideoMetadata }).data;
}

/** Fetch the first bytes of a URL (following redirects) and confirm it's real video data. */
async function assertFirstBytesAreVideo(url: string) {
  const res = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
  assert.ok(res.status === 206 || res.status === 200, `HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer()).slice(0, 4096);
  const s = sniffMedia(buf);
  assert.equal(s.kind, 'video', `first bytes of ${url} are not video: ${JSON.stringify(s)}`);
  return res;
}

test('LIVE Internet Archive: metadata, options, and real video bytes', T, async () => {
  const m = await meta('https://archive.org/details/BigBuckBunny_124');
  assert.equal(m.downloadAllowed, true);
  assert.ok(m.options.length > 0);
  const mp4 = m.options.find((o) => o.mimeType === 'video/mp4')!;
  assert.ok(mp4, 'has an MP4 option');
  assert.ok((mp4.sizeBytes ?? 0) > 1_000_000);
  await assertFirstBytesAreVideo(mp4.url);
});

test('LIVE direct link with HTTP redirect (archive.org/download → storage node)', T, async () => {
  const url = 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4';
  const m = await meta(url);
  assert.equal(m.provider, 'direct');
  assert.equal(m.options[0].url, url, 'original link kept so redirects are re-followed');
  assert.ok((m.options[0].sizeBytes ?? 0) > 1_000_000, 'size known');
  assert.equal(m.options[0].acceptsRanges, true, 'resumable');
  const res = await assertFirstBytesAreVideo(url);
  assert.notEqual(res.url, url, 'request was redirected');
});

test('LIVE Wikimedia Commons: a real video file resolves with options and license', T, async () => {
  const search = await fetch(
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&list=search&srnamespace=6&srlimit=5&srsearch=' +
      encodeURIComponent('filetype:video "Big Buck Bunny"'),
    { headers: { 'Api-User-Agent': 'VideoDownloaderApp-CI/1.0' } },
  ).then((r) => r.json() as Promise<{ query: { search: { title: string }[] } }>);
  const title = search.query.search[0]?.title;
  assert.ok(title, 'found a Commons video');
  const m = await meta(`https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  assert.equal(m.downloadAllowed, true);
  assert.ok(m.options.length >= 1);
  await assertFirstBytesAreVideo(m.options[0].url);
});

test('LIVE HLS (Mux public test stream): variants and a real segmented download', T, async () => {
  const m = await meta('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
  assert.equal(m.provider, 'hls');
  assert.ok(m.options.length >= 2, 'several resolutions');
  assert.ok(m.options.every((o) => o.kind === 'hls'));
  const smallest = [...m.options].sort((a, b) => (a.height ?? 0) - (b.height ?? 0))[0];

  // Run the real engine against the real server, limited to the first 3 segments.
  const real = await fetch(smallest.url).then(async (r) => ({ text: await r.text(), finalUrl: r.url }));
  const parsed = parseMediaPlaylist(real.text, real.finalUrl);
  assert.ok(parsed.segments.length > 3);
  const short = ['#EXTM3U', ...parsed.segments.slice(0, 3).flatMap((s) => [`#EXTINF:${s.duration},`, s.uri]), '#EXT-X-ENDLIST'].join('\n');

  const files = new Map<string, Uint8Array>();
  const deps: HlsEngineDeps = {
    isOnline: async () => true,
    isOnWifi: async () => true,
    ensureDir: async () => {},
    fileSize: async (u) => files.get(u)?.length ?? 0,
    deleteFile: async (u) => void files.delete(u),
    readHeader: async (u) => (files.get(u) ?? new Uint8Array()).slice(0, 512),
    fetchText: async () => ({ ok: true, status: 200, text: short, finalUrl: real.finalUrl }),
    appendFile: async (src, dest) => {
      const a = files.get(dest) ?? new Uint8Array();
      const b = files.get(src)!;
      const out = new Uint8Array(a.length + b.length);
      out.set(a);
      out.set(b, a.length);
      files.set(dest, out);
    },
    delay: async () => {},
    createSegmentTask: (url, fileUri, headers) => ({
      downloadAsync: async () => {
        const r = await fetch(url, { headers });
        files.set(fileUri, new Uint8Array(await r.arrayBuffer()));
        return { status: r.status };
      },
    }),
  };
  const progress: number[] = [];
  const out = await runHlsDownload(
    { playlistUrl: smallest.url, tempUri: 'out', segmentTempUri: 'seg', wifiOnly: false },
    deps,
    { onProgress: (cp) => progress.push(cp.segmentsDone) },
  );
  assert.equal(out.type, 'downloaded', JSON.stringify(out));
  assert.deepEqual(progress, [1, 2, 3]);
  assert.ok(out.type === 'downloaded' && out.size > 100_000);
});

test('LIVE web page publishing an HTML5 video', T, async () => {
  const m = await meta('https://www.w3schools.com/html/html5_video.asp');
  assert.equal(m.provider, 'webpage');
  assert.ok(m.options.length >= 1);
  const mp4 = m.options.find((o) => o.mimeType === 'video/mp4') ?? m.options[0];
  await assertFirstBytesAreVideo(mp4.url);
});

test('LIVE YouTube: real metadata, view-only with official link', T, async () => {
  const m = await meta('https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.ok(m.title.length > 0);
  assert.equal(m.downloadAllowed, false);
  assert.ok(m.thumbnailUrl);
});

test('LIVE Vimeo: real metadata, view-only', T, async () => {
  // Individual videos can become private/embed-restricted over time; any one public video proves the adapter.
  const ids = ['76979871', '1084537', '22439234', '347119375'];
  const errors: string[] = [];
  for (const id of ids) {
    try {
      const m = await meta(`https://vimeo.com/${id}`);
      assert.ok(m.title.length > 0);
      assert.equal(m.downloadAllowed, false);
      return;
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  assert.fail(`No Vimeo video resolved: ${errors.join(' / ')}`);
});
