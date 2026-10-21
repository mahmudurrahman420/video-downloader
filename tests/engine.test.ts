import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProgressReporter,
  progressFraction,
  runDownload,
  type EngineDeps,
  type EngineInput,
} from '../src/services/downloads/engine';
import { base64ToBytes, sniffMedia } from '../src/services/downloads/mediaSniff';

// ---- fakes -------------------------------------------------------------------

const MP4_HEADER = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // ....ftypisom
const HTML_HEADER = new TextEncoder().encode('<!DOCTYPE html><html><body>Sign in</body></html>');

interface FakeOptions {
  online?: boolean[]; // successive isOnline() answers
  wifi?: boolean;
  initialPartial?: number;
  free?: number;
  /** What the "network" does: write bytes, report progress, then resolve with a status or throw. */
  network: (ctx: {
    resumeData?: string;
    progress: (w: number, total: number) => void;
    write: (bytes: number, header?: Uint8Array) => void;
  }) => Promise<{ status: number } | null>;
}

function fakeDeps(o: FakeOptions) {
  let size = o.initialPartial ?? 0;
  let header: Uint8Array = size > 0 ? MP4_HEADER : new Uint8Array();
  const online = [...(o.online ?? [true])];
  const log: string[] = [];
  const deps: EngineDeps = {
    isOnline: async () => (online.length > 1 ? online.shift()! : online[0]),
    isOnWifi: async () => o.wifi ?? true,
    ensureDir: async () => {},
    fileSize: async () => size,
    deleteFile: async () => {
      log.push('delete');
      size = 0;
      header = new Uint8Array();
    },
    freeSpace: async () => o.free,
    readHeader: async () => header,
    createTask: (_url, _uri, onProgress, resumeData) => {
      log.push(`task resume=${resumeData ?? '-'}`);
      return {
        downloadAsync: () =>
          o.network({
            resumeData,
            progress: onProgress,
            write: (bytes, h) => {
              size += bytes;
              if (h) header = h;
            },
          }),
      };
    },
    now: (() => {
      let t = 0;
      return () => (t += 100);
    })(),
  };
  return { deps, log, size: () => size };
}

const input = (p: Partial<EngineInput> = {}): EngineInput => ({
  url: 'https://x.test/a.mp4',
  tempUri: 'file:///tmp/a.mp4',
  totalBytes: 1000,
  acceptsRanges: true,
  wifiOnly: false,
  ...p,
});

// ---- progress ----------------------------------------------------------------

test('progress reporter throttles updates but always delivers 100%', () => {
  const events: [number, number][] = [];
  let t = 0;
  const r = createProgressReporter((w, total) => events.push([w, total]), 0, () => t, 250);
  t = 1000; r.report(100, 1000); // emitted (first)
  t = 1100; r.report(200, 1000); // throttled
  t = 1200; r.report(300, 1000); // throttled
  t = 1300; r.report(400, 1000); // emitted (300ms later)
  t = 1310; r.report(1000, 1000); // final — emitted despite throttle
  assert.deepEqual(events, [[100, 1000], [400, 1000], [1000, 1000]]);
  assert.equal(r.total, 1000);
});

test('progress fraction is clamped and 0 when size unknown', () => {
  assert.equal(progressFraction(50, 100), 0.5);
  assert.equal(progressFraction(150, 100), 1);
  assert.equal(progressFraction(50, 0), 0);
  assert.equal(progressFraction(NaN, 100), 0);
});

// ---- success -----------------------------------------------------------------

test('successful download reports progress and verifies the file', async () => {
  const progress: number[] = [];
  let started = -1;
  const f = fakeDeps({
    network: async ({ progress: p, write }) => {
      write(500, MP4_HEADER);
      p(500, 1000);
      write(500);
      p(1000, 1000);
      return { status: 200 };
    },
  });
  const out = await runDownload(input(), f.deps, {
    onStarted: (_t, w) => (started = w),
    onProgress: (w) => progress.push(w),
  });
  assert.deepEqual(out, { type: 'downloaded', size: 1000, container: 'mp4' });
  assert.equal(started, 0);
  assert.equal(progress.at(-1), 1000);
});

test('resumes from the partial file with a Range offset (206)', async () => {
  const f = fakeDeps({
    initialPartial: 400,
    network: async ({ resumeData, write }) => {
      assert.equal(resumeData, '400');
      write(600);
      return { status: 206 };
    },
  });
  const out = await runDownload(input(), f.deps);
  assert.equal(out.type, 'downloaded');
  assert.deepEqual(f.log, ['task resume=400']);
});

// ---- failures ----------------------------------------------------------------

test('offline before starting fails without touching the network', async () => {
  const f = fakeDeps({ online: [false], network: async () => assert.fail('should not download') });
  const out = await runDownload(input(), f.deps);
  assert.equal(out.type, 'failed');
  assert.equal(out.type === 'failed' && out.error.kind, 'offline');
});

test('Wi-Fi only setting blocks mobile data', async () => {
  const f = fakeDeps({ wifi: false, network: async () => assert.fail('should not download') });
  const out = await runDownload(input({ wifiOnly: true }), f.deps);
  assert.equal(out.type === 'failed' && out.error.kind, 'wifi-required');
});

test('insufficient storage is reported before downloading', async () => {
  const f = fakeDeps({ free: 10, network: async () => assert.fail('should not download') });
  const out = await runDownload(input(), f.deps);
  assert.equal(out.type === 'failed' && out.error.kind, 'storage-space');
});

test('HTTP error status deletes the error body and maps the message', async () => {
  const f = fakeDeps({
    network: async ({ write }) => {
      write(120, HTML_HEADER);
      return { status: 403 };
    },
  });
  const out = await runDownload(input(), f.deps);
  assert.equal(out.type, 'failed');
  if (out.type === 'failed') {
    assert.equal(out.error.kind, 'http');
    assert.equal(out.error.status, 403);
    assert.equal(out.bytesWritten, 0);
  }
  assert.equal(f.size(), 0);
});

test('network drop mid-download keeps the partial for resuming', async () => {
  const f = fakeDeps({
    online: [true, true],
    network: async ({ write }) => {
      write(300, MP4_HEADER);
      throw new Error('socket closed');
    },
  });
  const out = await runDownload(input(), f.deps);
  assert.equal(out.type, 'failed');
  if (out.type === 'failed') {
    assert.equal(out.error.kind, 'interrupted');
    assert.equal(out.bytesWritten, 300);
  }
});

test('connection loss is reported as offline; non-resumable partial is discarded', async () => {
  const f = fakeDeps({
    online: [true, false],
    network: async ({ write }) => {
      write(300);
      throw new Error('network');
    },
  });
  const out = await runDownload(input({ acceptsRanges: false }), f.deps);
  assert.equal(out.type === 'failed' && out.error.kind, 'offline');
  assert.equal(f.size(), 0);
});

test('server ignoring Range (200 on resume) triggers a clean restart', async () => {
  const f = fakeDeps({
    initialPartial: 400,
    network: async ({ write }) => {
      write(1000);
      return { status: 200 };
    },
  });
  const out = await runDownload(input(), f.deps);
  assert.equal(out.type, 'restart');
  assert.equal(f.size(), 0);
});

test('416 on resume triggers a clean restart', async () => {
  const f = fakeDeps({ initialPartial: 400, network: async () => ({ status: 416 }) });
  assert.equal((await runDownload(input({ totalBytes: 0 }), f.deps)).type, 'restart');
});

test('short file is reported incomplete, not completed', async () => {
  const f = fakeDeps({
    network: async ({ write }) => {
      write(700, MP4_HEADER);
      return { status: 200 };
    },
  });
  const out = await runDownload(input(), f.deps);
  assert.equal(out.type, 'failed');
  assert.match(out.type === 'failed' ? out.error.message : '', /700 of 1000/);
});

test('empty file is never reported as success', async () => {
  const f = fakeDeps({ network: async () => ({ status: 200 }) });
  const out = await runDownload(input({ totalBytes: 0 }), f.deps);
  assert.equal(out.type === 'failed' && out.error.kind, 'corrupt');
});

test('HTML page served with 200 is rejected and deleted', async () => {
  const f = fakeDeps({
    network: async ({ write }) => {
      write(1000, HTML_HEADER);
      return { status: 200 };
    },
  });
  const out = await runDownload(input(), f.deps);
  assert.equal(out.type, 'failed');
  assert.match(out.type === 'failed' ? out.error.message : '', /web page/);
  assert.equal(f.size(), 0);
});

test('pause/cancel (null result) is reported as stopped with partial size', async () => {
  const f = fakeDeps({
    network: async ({ write }) => {
      write(250, MP4_HEADER);
      return null;
    },
  });
  assert.deepEqual(await runDownload(input(), f.deps), { type: 'stopped', bytesWritten: 250 });
});

// ---- media sniffing ----------------------------------------------------------

test('media sniffing recognises containers and impostors', () => {
  assert.deepEqual(sniffMedia(MP4_HEADER), { kind: 'video', container: 'mp4' });
  assert.equal(sniffMedia(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0])).kind, 'video');
  assert.equal(sniffMedia(new TextEncoder().encode('OggS\0\0\0\0')).kind, 'video');
  assert.equal(sniffMedia(HTML_HEADER).kind, 'not-video');
  assert.equal(sniffMedia(new TextEncoder().encode('{"error":"denied"}')).kind, 'not-video');
  assert.equal(sniffMedia(new TextEncoder().encode('#EXTM3U\n')).kind, 'not-video');
  assert.equal(sniffMedia(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])).kind, 'unknown');
  assert.deepEqual(Array.from(base64ToBytes('AAAAIGZ0eXA=')), [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);
});
