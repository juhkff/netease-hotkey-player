import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../lib/ncm.mjs';

// Exercise the real playback control flow against a deterministic CDP endpoint.
// No client, input injection, network access or audio playback is used.
async function withClient(options, run) {
  const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
  const calls = { metadata: 0, searches: 0, queries: [], privilege: 0, clicks: 0, pauses: 0, tabClicks: 0, jumps: 0, queueWrites: 0, seeks: 0 };
  let songTab = false, resetTab = !!options.resetTabWhileLoading;
  let visible = options.visible ?? true, query = options.query || '', failed = false;
  let state = options.initialState || { songId: 'other', duration: 200, seconds: 10, playing: true };
  let clockAt = Date.now(), pendingSeek = null;
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
          else if (expression === 'window.__ncm.resume()') { state.playing = true; clockAt = Date.now(); }
          else if (expression.includes('/api/song/enhance/privilege')) { calls.privilege++; value = 'null'; }
          else if (expression === 'window.__ncm.queueIds()') value = queue;
          else if (expression === 'window.__ncm.jump(-1)') {
            calls.jumps++;
            if (!options.jumpStuck) state = { songId: '316100', duration: 260, seconds: 0, playing: true };
          }
          else if (expression.startsWith('window.__ncm.seek(')) {
            calls.seeks++;
            const seconds = Number(expression.slice(18,-1));
            if (options.seekDelayMs) pendingSeek = { seconds, at: Date.now() + options.seekDelayMs };
            else state.seconds = seconds;
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
