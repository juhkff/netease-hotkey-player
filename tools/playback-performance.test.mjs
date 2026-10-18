import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../lib/ncm.mjs';

// Exercise the real playback control flow against a deterministic CDP endpoint.
// No client, input injection, network access or audio playback is used.
async function withClient(options, run) {
  const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
  const calls = { metadata: 0, searches: 0, clicks: 0, pauses: 0 };
  let visible = options.visible ?? true, query = '', failed = false;
  let state = { songId: 'other', duration: 200, seconds: 10, playing: true };
  const track = { id: 316100, name: '雨爱', artists: [{ name: '杨丞琳' }], album: { name: '雨爱' }, duration: 260000 };
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(text) {
      const request = JSON.parse(text);
      queueMicrotask(() => {
        let value = true, exception;
        const expression = request.params.expression || '';
        if (request.method === 'Input.insertText') { query = request.params.text; calls.searches++; }
        if (request.method === 'Input.dispatchKeyEvent' && request.params.type === 'keyUp') visible = true;
        if (request.method === 'Runtime.evaluate') {
          if (expression.startsWith('window.__ncm.track(')) {
            calls.metadata++;
            if (options.failMetadataOnce && !failed) { failed = true; exception = { text: 'temporary metadata failure' }; }
            value = track;
          } else if (expression === 'window.__ncm.read()') value = { ...state };
          else if (/^\(\(\) => \{\s+const want = /.test(expression)) {
            value = visible ? 'clicked' : 'not-found';
            if (visible) { calls.clicks++; state = { songId: '316100', duration: 260, seconds: 0.3, playing: true }; }
          } else if (expression.includes('const e = document.querySelector')) value = query;
          else if (expression.includes('querySelectorAll') && expression.includes('.length')) value = visible ? 1 : 0;
          else if (expression === 'window.__ncm.pause()') { calls.pauses++; state.playing = false; }
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

test('concurrent and repeated metadata requests share one successful fetch', async () => {
  await withClient({}, async (client, calls) => {
    const [a, b] = await Promise.all([client.trackInfo('316100'), client.trackInfo(316100)]);
    assert.deepEqual(a, b);
    await client.trackInfo('316100');
    assert.equal(calls.metadata, 1);
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
