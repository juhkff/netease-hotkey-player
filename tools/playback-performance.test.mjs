import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../lib/ncm.mjs';

// Exercise the real playback control flow against a deterministic CDP endpoint.
// No client, input injection, network access or audio playback is used.
async function withClient(options, run) {
  const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
  const calls = { metadata: 0, searches: 0, queries: [], privilege: 0, clicks: 0, pauses: 0, resumes: 0, tabClicks: 0, jumps: 0, queueWrites: 0, seeks: 0 };
  let songTab = false, resetTab = !!options.resetTabWhileLoading;
  let visible = options.visible ?? true, query = options.query || '', failed = false;
  let state = options.initialState || { songId: 'other', duration: 200, seconds: 10, playing: true };
  let clockAt = Date.now(), pendingSeek = null, pendingPauseAt = null;
  let queue = options.queue || ['316100', 'other'];
  const track = { id: 316100, name: '雨爱', artists: [{ name: '杨丞琳' }], album: { name: '雨爱' }, duration: 260000 };
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(text) {
      const request = JSON.parse(text);
      queueMicrotask(() => {
        let value = true, exception;
        const expression = request.params.expression || '';
        if (request.method === 'Input.insertText') { query = request.params.text; calls.searches++; calls.queries.push(query); }
        if (request.method === 'Input.dispatchKeyEvent' && request.params.type === 'keyUp') visible = true;
        if (request.method === 'Runtime.evaluate') {
          if (expression.startsWith('window.__ncm.track(')) {
            calls.metadata++;
            if (options.failMetadataOnce && !failed) { failed = true; exception = { text: 'temporary metadata failure' }; }
            value = track;
          } else if (expression === 'window.__ncm.read()') {
            const now = Date.now();
            if (options.advancePlayback && state.playing) state.seconds += (now - clockAt) / 1000;
            clockAt = now;
            if (pendingSeek && now >= pendingSeek.at) { state.seconds = pendingSeek.seconds; pendingSeek = null; }
            if (pendingPauseAt && now >= pendingPauseAt) { state.playing = false; pendingPauseAt = null; }
            value = { ...state };
          }
          else if (/^\(\(\) => \{\s+const want = /.test(expression)) {
            value = visible ? 'clicked' : 'not-found';
            if (visible) { calls.clicks++; state = { songId: '316100', duration: 260, seconds: 0.3, playing: true }; }
          } else if (expression.includes('const e = document.querySelector')) value = query;
          else if (expression.includes('ncm:song-tab')) {
            if (songTab) value = true;
            else { calls.tabClicks++; songTab = true; value = false; }
          }
          else if (expression.includes('querySelectorAll') && expression.includes('.length')) {
            if (resetTab) { resetTab = false; songTab = false; value = 0; }
            else value = visible && songTab ? 1 : 0;
          }
          else if (expression === 'window.__ncm.pause()') { calls.pauses++; state.playing = false; }
          else if (expression === 'window.__ncm.resume()') {
            calls.resumes++;
            if (calls.resumes > (options.ignoreResumeCount || 0)) { state.playing = true; clockAt = Date.now(); }
            if (calls.resumes === 1 && options.pauseAfterFirstResumeMs) pendingPauseAt = Date.now() + options.pauseAfterFirstResumeMs;
          }
          else if (expression.includes('/api/song/enhance/privilege')) { calls.privilege++; value = 'null'; }
          else if (expression === 'window.__ncm.queueIds()') value = queue;
          else if (expression === 'window.__ncm.jump(-1)') {
            calls.jumps++;
            if (!options.jumpStuck) state = { songId: '316100', duration: 260, seconds: 0, playing: true };
          }
          else if (expression.startsWith('window.__ncm.seek(')) {
            calls.seeks++;
            const seconds = Number(expression.slice(18,-1));
            if (!options.ignoreSeeks) {
              if (options.seekDelayMs) pendingSeek = { seconds, at: Date.now() + options.seekDelayMs };
              else state.seconds = seconds;
            }
            if (options.changeTrackOnSeek) state.songId = options.changeTrackOnSeek;
            options.onSeek?.();
          }
          else if (expression.startsWith('window.__ncm.replaceQueue(')) {
            calls.queueWrites++;
            queue = JSON.parse(JSON.parse(expression.slice(26,-1))).map(x => String(x.resourceId || x.id));
          }
        }
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: request.id,
          result: exception ? { exceptionDetails: exception } : { result: { value } } }) }));
      });
    }
    close() { this.dispatchEvent(new Event('close')); }
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => [{ type: 'page',
    url: 'orpheus://orpheus/pub/app.html', webSocketDebuggerUrl: 'ws://mock' }] });
  globalThis.WebSocket = Socket;
  let client;
  try { client = await connect(); await run(client, calls); }
  finally { client?.close(); globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; }
}

test('an already visible target is played without starting another search', async () => {
  await withClient({}, async (client, calls) => {
    const result = await client.playTrackById('316100');
    assert.equal(result.ok, true);
    assert.equal(result.method, 'visible-row+dblclick');
    assert.equal(calls.searches, 0);
    assert.equal(calls.clicks, 1);
    assert.ok(result.tClick);
  });
});

test('a jukebox-owned play bypasses direct double-clicks even when the track is visible', async () => {
  await withClient({ initialState: { songId: '316100', duration: 260, seconds: .3, playing: true } }, async (client, calls) => {
    const requested = [];
    const result = await client.playTrackById('316100', { startTrack: async id => { requested.push(id); } });
    assert.equal(result.ok, true); assert.equal(result.method, 'awoo-native');
    assert.deepEqual(requested, ['316100']);
    assert.equal(calls.clicks, 0); assert.equal(calls.searches, 0);
  });
});

test('restore announces the original track to its jukebox before native seek', async () => {
  await withClient({ initialState: { songId: '316100', duration: 260, seconds: .3, playing: true } }, async (client, calls) => {
    const requested = [];
    const result = await client.restore({ songId: '316100', seconds: 22, playing: false, queue: [] },
      { startTrack: async id => { requested.push(id); }, settleMs: 1 });
    assert.deepEqual(requested, ['316100']); assert.equal(result.seeked, 22);
    assert.equal(result.state.playing, false); assert.equal(calls.jumps, 0); assert.equal(calls.clicks, 0);
  });
});

test('a missing row still uses search and matches the target ID', async () => {
  await withClient({ visible: false }, async (client, calls) => {
    const result = await client.playTrackById('316100');
    assert.equal(result.ok, true);
    assert.equal(result.method, 'search+dblclick');
    assert.equal(result.keyword, '雨爱 杨丞琳');
    assert.equal(calls.searches, 1);
    assert.equal(calls.clicks, 1);
  });
});

test('a stale keyword header is bypassed with another valid query', async () => {
  await withClient({ visible: false, query: '雨爱 杨丞琳' }, async (client, calls) => {
    const result = await client.playTrackById('316100');
    assert.equal(result.ok, true);
    assert.equal(calls.queries[0], '雨爱');
    assert.equal(calls.clicks, 1);
  });
});

test('offset playback waits for native seek confirmation and verifies real progress', async () => {
  await withClient({ advancePlayback: true, seekDelayMs: 220 }, async (client, calls) => {
    const steps = [];
    const result = await client.playFrom('316100', 2, { onProgress: step => steps.push(step) });
    assert.equal(result.seeked, 2);
    assert.equal(result.attempts, 1);
    assert.ok(result.state.seconds > 2.25);
    assert.equal(result.state.playing, true);
    assert.equal(calls.privilege, 0);
    assert.equal(calls.searches, 0);
    assert.equal(calls.seeks, 1);
    assert.ok(steps.some(step => step.includes('已从指定起点恢复播放')));
  });
});

test('concurrent and repeated metadata requests share one successful fetch', async () => {
  await withClient({}, async (client, calls) => {
    const [a, b] = await Promise.all([client.trackInfo('316100'), client.trackInfo(316100)]);
    assert.deepEqual(a, b);
    await client.trackInfo('316100');
    assert.equal(calls.metadata, 1);
  });
});

test('search completion resetting the tab is recovered without waiting on overview results', async () => {
  await withClient({ visible: false, resetTabWhileLoading: true }, async (client, calls) => {
    const result = await client.playTrackById('316100');
    assert.equal(result.ok, true);
    assert.equal(calls.searches, 1);
    assert.equal(calls.tabClicks, 2);
    assert.equal(calls.clicks, 1);
  });
});

test('failed metadata fetches can be retried', async () => {
  await withClient({ failMetadataOnce: true }, async (client, calls) => {
    await assert.rejects(client.trackInfo('316100'), /temporary metadata failure/);
    assert.equal((await client.trackInfo('316100')).name, '雨爱');
    assert.equal(calls.metadata, 2);
  });
});

test('the visible-row shortcut preserves immediate pause for seek requests', async () => {
  await withClient({}, async (client, calls) => {
    const result = await client.playTrackById('316100', { pauseAsap: true });
    assert.equal(result.ok, true);
    assert.equal(result.state.playing, false);
    assert.ok(result.pausedAt >= result.tClick);
    assert.ok(calls.pauses > 0);
    assert.equal(calls.searches, 0);
  });
});

test('restore reloads a song missing from the queue instead of stepping through unrelated tracks', async () => {
  await withClient({ queue: ['other'] }, async (client, calls) => {
    const result = await client.restore({ songId: '316100', name: '雨爱', seconds: 15, duration: 260,
      playing: false, queue: ['other'], queueItems: [{ resourceId: 'other' }] }, { settleMs: 1 });
    assert.equal(result.reloaded, true); assert.equal(calls.jumps, 0);
    assert.equal(result.seeked, 15); assert.equal(result.state.playing, false);
  });
});

test('restore of the current song pauses before seeking and restores position zero', async () => {
  await withClient({ initialState: { songId: '316100', duration: 260, seconds: 35, playing: true } }, async (client, calls) => {
    const result = await client.restore({ songId: '316100', name: '雨爱', seconds: 0, duration: 260, playing: false, queue: [] }, { settleMs: 1 });
    assert.equal(result.seeked, 0); assert.ok(calls.pauses > 0); assert.equal(calls.jumps, 0);
    assert.equal(result.state.playing, false);
  });
});

test('unresponsive previous-track commands fall back to loading rather than retrying indefinitely', async () => {
  await withClient({ jumpStuck: true }, async (client, calls) => {
    const result = await client.restore({ songId: '316100', name: '雨爱', seconds: 3, duration: 260, playing: false, queue: [] },
      { settleMs: 1, stepWaitMs: 1 });
    assert.equal(calls.jumps, 2); assert.equal(result.reloaded, true); assert.equal(result.seeked, 3);
  });
});

const originalPlaying = { songId: '316100', name: '雨爱', seconds: 22, duration: 260, playing: true, queue: [] };
const selectedOriginal = { songId: '316100', duration: 260, seconds: 35, playing: true };

test('restore waits for a slow native seek rather than repeatedly restarting it', async () => {
  await withClient({ initialState: { ...selectedOriginal }, seekDelayMs: 500, advancePlayback: true }, async (client, calls) => {
    const r = await client.restore(originalPlaying, { settleMs: 1 });
    assert.equal(calls.seeks, 1); assert.equal(r.seeked, 22);
    assert.equal(r.state.playing, true); assert.ok(r.state.seconds > 22.2);
  });
});

test('restore recovers when the first resume is ignored or a late pause arrives', async () => {
  for (const fault of [{ ignoreResumeCount: 1 }, { pauseAfterFirstResumeMs: 250 }]) {
    await withClient({ initialState: { ...selectedOriginal }, advancePlayback: true, ...fault }, async (client, calls) => {
      const r = await client.restore(originalPlaying, { settleMs: 1 });
      assert.equal(r.state.playing, true); assert.ok(r.state.seconds > 22.2);
      assert.ok(calls.resumes >= 2);
    });
  }
});

test('a failed restore seek releases its temporary pause but still reports failure', async () => {
  await withClient({ initialState: { ...selectedOriginal }, ignoreSeeks: true }, async (client, calls) => {
    await assert.rejects(client.restore(originalPlaying, { settleMs: 1, seekWaitMs: 120 }), /播放位置未恢复/);
    assert.equal((await client.readState()).playing, true);
    assert.ok(calls.resumes > 0);
  });
});

test('a failed seek keeps an originally paused song paused', async () => {
  await withClient({ initialState: { ...selectedOriginal }, ignoreSeeks: true }, async (client, calls) => {
    await assert.rejects(client.restore({ ...originalPlaying, playing: false }, { settleMs: 1, seekWaitMs: 120 }), /播放位置未恢复/);
    assert.equal((await client.readState()).playing, false); assert.equal(calls.resumes, 0);
  });
});

test('a playing flag without advancing native progress is not a successful restore', async () => {
  await withClient({ initialState: { ...selectedOriginal } }, async client => {
    await assert.rejects(client.restore(originalPlaying, { settleMs: 1, playbackWaitMs: 600 }), /未确认继续播放/);
  });
});

test('cancelled restore and a different selected track never receive a late resume', async () => {
  await withClient({ initialState: { ...selectedOriginal } }, async (client, calls) => {
    await assert.rejects(client.restore(originalPlaying, { signal: AbortSignal.abort() }), /取消/);
    assert.equal(calls.pauses, 0); assert.equal(calls.resumes, 0);
  });
  const controller = new AbortController();
  await withClient({ initialState: { ...selectedOriginal }, onSeek: () => controller.abort() }, async (client, calls) => {
    await assert.rejects(client.restore(originalPlaying, { settleMs: 1, signal: controller.signal }), /取消/);
    assert.equal(calls.resumes, 0);
  });
  await withClient({ initialState: { ...selectedOriginal }, changeTrackOnSeek: 'foreign' }, async (client, calls) => {
    await assert.rejects(client.restore(originalPlaying, { settleMs: 1 }), /其他操作切换/);
    assert.equal(calls.resumes, 0); assert.equal((await client.readState()).songId, 'foreign');
  });
});
