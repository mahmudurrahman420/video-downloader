import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFetch } from './helpers/fakeFetch';
import { resolveLink, runAdapter, ADAPTERS } from '../src/services/providers';
import { detectSource } from '../src/services/url/detect';
import { AppError } from '../src/services/errors';

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});
const routes = (r: Parameters<typeof installFetch>[0]) => {
  const f = installFetch(r);
  restore = f.restore;
  return f;
};
const meta = async (url: string) => {
  const r = await resolveLink(url);
  assert.equal(r.type, 'metadata', JSON.stringify(r));
  return r.type === 'metadata' ? r.data : (undefined as never);
};
const rejects = async (url: string, re: RegExp) => {
  await assert.rejects(resolveLink(url), (e: unknown) => e instanceof AppError && re.test(e.message));
};

// ---- YouTube ------------------------------------------------------------------

const YT_OEMBED = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

test('YouTube: metadata via oEmbed, view-only with official link and owner export', async () => {
  routes({ [YT_OEMBED]: { body: { title: 'Song', author_name: 'Channel', thumbnail_url: 'https://i.ytimg.com/x.jpg' } } });
  const m = await meta('https://youtu.be/dQw4w9WgXcQ');
  assert.equal(m.title, 'Song');
  assert.equal(m.downloadAllowed, false);
  assert.equal(m.options.length, 0);
  assert.equal(m.officialViewUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(m.ownerExport?.links.some((l) => l.url.includes('studio.youtube.com')));
});

test('YouTube: private/removed videos get a specific error', async () => {
  routes({ [YT_OEMBED]: { status: 401 } });
  await rejects('https://www.youtube.com/watch?v=dQw4w9WgXcQ', /private|age-restricted/);
});

// ---- Vimeo --------------------------------------------------------------------

test('Vimeo: oEmbed metadata, view-only', async () => {
  routes({
    ['https://vimeo.com/api/oembed.json?url=' + encodeURIComponent('https://vimeo.com/76979871')]: {
      body: { title: 'Short film', author_name: 'Studio', duration: 62 },
    },
  });
  const m = await meta('https://vimeo.com/76979871');
  assert.equal(m.title, 'Short film');
  assert.equal(m.durationSeconds, 62);
  assert.equal(m.downloadAllowed, false);
});

// ---- Facebook / Instagram / TikTok ---------------------------------------------

test('Facebook, Instagram, TikTok: explained with platform-specific alternatives, no network call', async () => {
  const f = routes({});
  for (const [url, re] of [
    ['https://www.facebook.com/watch/?v=123', /Download your information/],
    ['https://www.instagram.com/reel/Cabc/', /Download your information/],
    ['https://www.tiktok.com/@user/video/7300000000000000000', /Save video/],
  ] as const) {
    const r = await resolveLink(url);
    assert.equal(r.type, 'unsupported');
    if (r.type === 'unsupported') {
      assert.match(r.reason, re);
      assert.ok(r.platformName);
    }
  }
  assert.equal(f.calls.length, 0);
});

// ---- Internet Archive ------------------------------------------------------------

test('Internet Archive: public video files become options, MP4 first', async () => {
  routes({
    'https://archive.org/metadata/BigBuckBunny_124': {
      body: {
        metadata: { identifier: 'BigBuckBunny_124', title: 'Big Buck Bunny', licenseurl: 'http://creativecommons.org/licenses/by/3.0/' },
        files: [
          { name: 'Content/big_buck_bunny_720p_surround.ogv', format: 'Ogg Video', size: '46935223', length: '596.48', width: '533', height: '300' },
          { name: 'Content/big_buck_bunny_720p_surround.mp4', format: 'h.264', size: '61878609', length: '596.5', width: '640', height: '360' },
          { name: 'Content/secret.mp4', format: 'h.264', size: '10', private: 'true' },
          { name: 'cover.jpg', format: 'JPEG' },
        ],
      },
    },
  });
  const m = await meta('https://archive.org/details/BigBuckBunny_124');
  assert.equal(m.downloadAllowed, true);
  assert.equal(m.options.length, 2);
  assert.equal(m.options[0].mimeType, 'video/mp4');
  assert.equal(m.options[0].url, 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4');
  assert.equal(m.options[0].sizeBytes, 61878609);
  assert.ok(Math.abs(m.durationSeconds! - 596.5) < 1);
});

test('Internet Archive: access-restricted items offer no downloads', async () => {
  routes({
    'https://archive.org/metadata/lending': {
      body: { metadata: { title: 'Lent', 'access-restricted-item': 'true' }, files: [{ name: 'a.mp4', format: 'h.264', size: '5' }] },
    },
  });
  const m = await meta('https://archive.org/details/lending');
  assert.equal(m.downloadAllowed, false);
  assert.match(m.permissionNote, /access-restricted/);
});

test('Internet Archive: missing item → not found', async () => {
  routes({ 'https://archive.org/metadata/nope': { body: {} } });
  await rejects('https://archive.org/details/nope', /does not exist/);
});

// ---- Wikimedia Commons -------------------------------------------------------------

test('Wikimedia Commons: original + transcodes with license', async () => {
  routes({
    [`https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&prop=videoinfo&viprop=url|size|mime|mediatype|extmetadata|derivatives&viurlwidth=640&titles=${encodeURIComponent('File:Clip.webm')}`]: {
      body: {
        query: {
          pages: [
            {
              title: 'File:Clip.webm',
              videoinfo: [
                {
                  url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Clip.webm',
                  size: 1234567,
                  width: 1920,
                  height: 1080,
                  mime: 'video/webm',
                  mediatype: 'VIDEO',
                  duration: 30,
                  extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="#">Jane</a>' } },
                  derivatives: [
                    { src: 'https://upload.wikimedia.org/x/Clip.webm.480p.vp9.webm', transcodekey: '480p.vp9.webm' },
                    { src: 'https://upload.wikimedia.org/x/Clip.webm.240p.mp4?x', transcodekey: '240p.mp4' },
                    { src: 'https://upload.wikimedia.org/x/Clip.webm.ogg', transcodekey: 'ogg' },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  });
  const m = await meta('https://commons.wikimedia.org/wiki/File:Clip.webm');
  assert.equal(m.license, 'CC BY-SA 4.0');
  assert.equal(m.author, 'Jane');
  assert.equal(m.options.length, 3);
  assert.equal(m.options[0].id, 'original');
  assert.ok(m.options.some((o) => o.mimeType === 'video/mp4'));
});

// ---- Direct links ------------------------------------------------------------------

test('Direct: video file with redirect keeps the original link for downloading', async () => {
  routes({
    'HEAD https://example.com/get/42': {
      url: 'https://cdn.example.net/signed/clip.mp4?sig=abc',
      headers: { 'content-type': 'video/mp4', 'content-length': '5000', 'accept-ranges': 'bytes', 'content-disposition': 'attachment; filename="Clip 42.mp4"' },
    },
  });
  const m = await meta('https://example.com/get/42');
  assert.equal(m.provider, 'direct');
  assert.equal(m.options[0].url, 'https://example.com/get/42');
  assert.equal(m.options[0].fileName, 'Clip 42.mp4');
  assert.equal(m.options[0].sizeBytes, 5000);
  assert.equal(m.options[0].acceptsRanges, true);
});

test('Direct: HEAD missing size → ranged GET fills it in', async () => {
  routes({
    'HEAD https://example.com/v.mp4': { headers: { 'content-type': 'video/mp4' } },
    'GET https://example.com/v.mp4': (init) => {
      assert.equal((init?.headers as Record<string, string>).Range, 'bytes=0-0');
      return { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-0/987654' } };
    },
  });
  const m = await meta('https://example.com/v.mp4');
  assert.equal(m.options[0].sizeBytes, 987654);
  assert.equal(m.options[0].acceptsRanges, true);
});

test('Direct: HTTP errors are reported accurately', async () => {
  routes({ 'HEAD https://example.com/gone.mp4': { status: 404 } });
  await rejects('https://example.com/gone.mp4', /could not be found/);
});

// ---- HLS -----------------------------------------------------------------------------

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"
audio/index.m3u8
`;
const MEDIA = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10,
seg0.ts
#EXTINF:10,
seg1.ts
#EXTINF:5,
seg2.ts
#EXT-X-ENDLIST
`;

test('HLS: master playlist → one option per resolution, best first, audio-only excluded', async () => {
  routes({
    'https://media.example.com/movie/master.m3u8': { headers: { 'content-type': 'application/vnd.apple.mpegurl' }, body: MASTER },
    'https://media.example.com/movie/1080/index.m3u8': { body: MEDIA },
  });
  const m = await meta('https://media.example.com/movie/master.m3u8');
  assert.equal(m.provider, 'hls');
  assert.equal(m.title, 'movie');
  assert.equal(m.durationSeconds, 25);
  assert.deepEqual(m.options.map((o) => o.height), [1080, 360]);
  assert.equal(m.options[0].kind, 'hls');
  assert.equal(m.options[0].url, 'https://media.example.com/movie/1080/index.m3u8');
  assert.equal(m.options[0].sizeBytes, (5000000 * 25) / 8);
  assert.equal(m.options[0].sizeEstimated, true);
  assert.match(m.options[0].fileName, /1080p\.ts$/);
});

test('HLS: encrypted, DRM and live streams are refused with reasons', async () => {
  const media = (extra: string, end = true) => `#EXTM3U\n${extra}\n#EXTINF:4,\na.ts\n${end ? '#EXT-X-ENDLIST' : ''}`;
  routes({
    'https://s.example.com/aes.m3u8': { body: media('#EXT-X-KEY:METHOD=AES-128,URI="key.bin"') },
    'https://s.example.com/drm.m3u8': { body: media('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://abc",KEYFORMAT="com.apple.streamingkeydelivery"') },
    'https://s.example.com/live.m3u8': { body: media('', false) },
  });
  await rejects('https://s.example.com/aes.m3u8', /encrypted/);
  await rejects('https://s.example.com/drm.m3u8', /DRM/);
  await rejects('https://s.example.com/live.m3u8', /live stream/);
});

test('HLS discovered by content type on an extension-less link', async () => {
  routes({
    'HEAD https://example.com/stream/42': { headers: { 'content-type': 'application/x-mpegURL' } },
    'https://example.com/stream/42': { body: MEDIA },
  });
  const m = await meta('https://example.com/stream/42');
  assert.equal(m.provider, 'hls');
  assert.equal(m.options.length, 1);
  assert.equal(m.options[0].kind, 'hls');
});

// ---- Web pages ---------------------------------------------------------------------------

test('Web page: og:video and <source> files become quality options', async () => {
  const html = `<html><head><title>Ignored</title>
    <meta property="og:title" content="Launch event &amp; demo">
    <meta property="og:image" content="/thumb.jpg">
    <meta property="og:video:secure_url" content="https://cdn.example.org/launch-720.mp4">
    <meta property="og:video:type" content="video/mp4">
    <meta property="og:video:height" content="720">
    </head><body>
    <video controls><source src="/media/launch-1080.mp4" type="video/mp4" size="1080"></video>
    <video src="https://video.xx.fbcdn.net/v/stolen.mp4"></video>
    </body></html>`;
  routes({
    'HEAD https://news.example.org/launch': { headers: { 'content-type': 'text/html; charset=utf-8' } },
    'https://news.example.org/launch': { headers: { 'content-type': 'text/html' }, body: html },
    'HEAD https://cdn.example.org/launch-720.mp4': { headers: { 'content-type': 'video/mp4', 'content-length': '700', 'accept-ranges': 'bytes' } },
    'HEAD https://news.example.org/media/launch-1080.mp4': { headers: { 'content-type': 'video/mp4', 'content-length': '1080', 'accept-ranges': 'bytes' } },
  });
  const m = await meta('https://news.example.org/launch');
  assert.equal(m.provider, 'webpage');
  assert.equal(m.title, 'Launch event & demo');
  assert.equal(m.thumbnailUrl, 'https://news.example.org/thumb.jpg');
  assert.deepEqual(m.options.map((o) => o.height), [1080, 720]);
  assert.ok(m.options.every((o) => !o.url.includes('fbcdn')), 'platform CDN links are never offered');
});

test('Web page embedding a YouTube player hands off to the YouTube adapter', async () => {
  routes({
    'HEAD https://blog.example.com/post': { headers: { 'content-type': 'text/html' } },
    'https://blog.example.com/post': {
      headers: { 'content-type': 'text/html' },
      body: '<meta property="og:video:url" content="https://www.youtube.com/embed/dQw4w9WgXcQ">',
    },
    [YT_OEMBED]: { body: { title: 'Embedded song' } },
  });
  const m = await meta('https://blog.example.com/post');
  assert.equal(m.provider, 'youtube');
  assert.equal(m.downloadAllowed, false);
});

test('Web page with no published video explains why', async () => {
  routes({
    'HEAD https://example.com/about': { headers: { 'content-type': 'text/html' } },
    'https://example.com/about': { headers: { 'content-type': 'text/html' }, body: '<html><title>About</title></html>' },
  });
  await rejects('https://example.com/about', /No downloadable video was found/);
});

// ---- Registry isolation -------------------------------------------------------------------

test('a crashing adapter yields a provider-scoped error and does not affect others', async () => {
  const d = detectSource('https://example.com/a.mp4');
  assert.equal(d.kind, 'supported');
  if (d.kind !== 'supported') return;
  const broken = { id: 'direct' as const, name: 'Broken source', timeoutMs: 1000, resolve: async () => { throw new TypeError('boom'); } };
  await assert.rejects(runAdapter(broken, d), (e: unknown) => e instanceof AppError && /Broken source.*Other sources are unaffected/.test(e.message));

  const slow = { id: 'direct' as const, name: 'Slow source', timeoutMs: 20, resolve: () => new Promise<never>(() => {}) };
  await assert.rejects(runAdapter(slow, d), (e: unknown) => e instanceof AppError && e.kind === 'timeout');

  const empty = {
    id: 'direct' as const,
    name: 'Empty',
    timeoutMs: 1000,
    resolve: async () => ({ provider: 'direct' as const, providerName: 'x', sourceUrl: 'x', title: 't', downloadAllowed: true, permissionNote: '', options: [] }),
  };
  assert.equal((await runAdapter(empty, d)).downloadAllowed, false, 'no options → no download button');
  assert.ok(ADAPTERS.youtube && ADAPTERS.hls && ADAPTERS.direct);
});
