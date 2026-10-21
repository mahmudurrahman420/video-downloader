import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSource } from '../src/services/url/detect';
import { parseUrl } from '../src/services/url/parseUrl';
import { formatBytes, formatDuration, sanitizeFileName } from '../src/utils/format';

const kindOf = (u: string) => {
  const d = detectSource(u);
  return d.kind === 'supported' ? `${d.provider}:${d.id ?? ''}` : d.kind;
};

test('rejects empty and malformed input', () => {
  assert.equal(kindOf(''), 'invalid');
  assert.equal(kindOf('hello world'), 'invalid');
  assert.equal(kindOf('ftp://example.com/a.mp4'), 'invalid');
  assert.equal(kindOf('https://localhost/a.mp4'), 'invalid');
  assert.equal(kindOf('https://exa mple.com'), 'invalid');
});

test('detects YouTube links in all common shapes', () => {
  assert.equal(kindOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube:dQw4w9WgXcQ');
  assert.equal(kindOf('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'youtube:dQw4w9WgXcQ');
  assert.equal(kindOf('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'youtube:dQw4w9WgXcQ');
  assert.equal(kindOf('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'youtube:dQw4w9WgXcQ');
  assert.equal(kindOf('Check this https://youtu.be/dQw4w9WgXcQ !'), 'youtube:dQw4w9WgXcQ');
  assert.equal(kindOf('https://www.youtube.com/@somechannel'), 'unsupported');
});

test('detects Vimeo, Internet Archive and Commons', () => {
  assert.equal(kindOf('https://vimeo.com/76979871'), 'vimeo:76979871');
  assert.equal(kindOf('https://archive.org/details/night_of_the_living_dead'), 'internet-archive:night_of_the_living_dead');
  assert.equal(kindOf('https://archive.org/search?query=x'), 'unsupported');
  assert.equal(
    kindOf('https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_4K.webm'),
    'wikimedia-commons:File:Big Buck Bunny 4K.webm',
  );
});

test('direct files allowed, platform stream CDNs refused', () => {
  assert.equal(kindOf('https://example.com/videos/clip.mp4'), 'direct:');
  assert.equal(kindOf('https://cdn.example.org/a/b/movie.webm?token=1'), 'direct:');
  assert.equal(kindOf('https://rr3---sn-abc.googlevideo.com/videoplayback.mp4'), 'unsupported');
  assert.equal(kindOf('https://scontent.xx.fbcdn.net/v/clip.mp4'), 'unsupported');
  assert.equal(kindOf('https://www.instagram.com/reel/abc/'), 'unsupported');
  assert.equal(kindOf('https://example.com/page.html'), 'unsupported');
});

test('url parser normalises hosts and queries', () => {
  const u = parseUrl('https://WWW.Example.com:8080/a/b?x=1&y=hello%20there#frag')!;
  assert.equal(u.host, 'example.com');
  assert.equal(u.pathname, '/a/b');
  assert.deepEqual(u.query, { x: '1', y: 'hello there' });
});

test('format helpers', () => {
  assert.equal(formatBytes(0), '—');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(734003200), '700 MB');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(sanitizeFileName('a/b:c?.mp4'), 'a_b_c_.mp4');
  assert.equal(sanitizeFileName('My clip'), 'My clip.mp4');
});
