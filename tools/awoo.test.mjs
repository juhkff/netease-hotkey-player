import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { findAwoo, playWithAwoo } from '../lib/awoo.mjs';

async function fixture(options, run) {
  const requests = [], queue = ['777777', '888888'];
  let port;
  const config = { version: '1.2.3', config: { PlayerType: 'NCM' }, playing: true, playerConnected: true, ...options.config };
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/config') { res.end(JSON.stringify(config)); return; }
    if (req.url === '/api/test/request-song' && req.method === 'GET') {
      res.end(JSON.stringify({ success: true, localOnly: true, modes: ['normal','play_now'],
        endpoint: `http://127.0.0.1:${port}/api/test/request-song`, ...options.api })); return;
    }
    if (req.method === 'POST') {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text); requests.push(body);
      res.end(JSON.stringify({ success: true, playbackConfirmed: true,
        song: { Id: body.keyword.slice(3) }, queue, ...options.result })); return;
    }
    res.writeHead(404); res.end('{}');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); port = server.address().port;
  try { await run({ port, requests, queue, config }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('a native Awoo play uses an exact ID and leaves pending requests unchanged', async () => {
  await fixture({}, async f => {
    const session = await findAwoo(f.port);
    assert.equal(session.version, '1.2.3');
    await playWithAwoo(session, '3362244118');
    assert.equal(f.requests[0].keyword, 'id=3362244118'); assert.equal(f.requests[0].mode, 'play_now');
    assert.deepEqual(f.queue, ['777777','888888']);
  });
});

test('disabled detection, unrelated services and other players are ignored', async () => {
  assert.equal(await findAwoo(0), null);
  await fixture({ config: { version: 'unknown' } }, async f => assert.equal(await findAwoo(f.port), null));
  await fixture({ config: { config: { PlayerType: 'QQMusic' } } }, async f => assert.equal(await findAwoo(f.port), null));
});

test('an incompatible endpoint or disconnected player fails without issuing playback', async () => {
  await fixture({ api: { localOnly: false } }, async f => {
    await assert.rejects(findAwoo(f.port), /兼容/); assert.equal(f.requests.length, 0);
  });
  await fixture({ config: { playerConnected: false } }, async f => {
    await assert.rejects(findAwoo(f.port), /尚未连通/); assert.equal(f.requests.length, 0);
  });
});

test('a changed player or aborted operation does not submit a native play', async () => {
  await fixture({}, async f => {
    const session = await findAwoo(f.port); f.config.config = { PlayerType: 'QQMusic' };
    await assert.rejects(playWithAwoo(session, '3362244118'), /未控制网易云/);
    await assert.rejects(playWithAwoo(session, '3362244118', { signal: AbortSignal.abort() }));
    assert.equal(f.requests.length, 0);
  });
});

test('an unconfirmed play or a different returned ID is rejected rather than falling back to a competing click', async () => {
  for (const result of [{ playbackConfirmed: false, message: 'unconfirmed' }, { song: { Id: '999999' } }]) {
    await fixture({ result }, async f => {
      await assert.rejects(playWithAwoo(await findAwoo(f.port), '3362244118'), /未确认/);
      assert.equal(f.requests.length, 1);
    });
  }
});

test('real worker retains jukebox ownership for both insertion and restore', { timeout: 10000 }, async () => {
  await fixture({}, async f => {
    await mkdir(resolve('out'), { recursive: true });
    const root = await mkdtemp(resolve('out', 'awoo-worker-')); await mkdir(join(root, 'lib'));
    await copyFile(new URL('../worker.mjs', import.meta.url), join(root, 'worker.mjs'));
    await copyFile(new URL('../lib/awoo.mjs', import.meta.url), join(root, 'lib', 'awoo.mjs'));
    await writeFile(join(root, 'lib', 'ncm.mjs'), `
      export const isReady=async()=>true;
      export const connect=async()=>({
        snapshot:async()=>({songId:'123456',name:'original',seconds:22,queue:[]}),
        playTrackById:async(id,opts)=>{if(!opts.startTrack)throw Error('direct play forbidden');await opts.startTrack(id);return {ok:true,info:{name:'clip'}}},
        restore:async(s,opts)=>{if(!opts.startTrack)throw Error('direct restore forbidden');await opts.startTrack(s.songId);return {song:s.name,seeked:s.seconds}},
        close(){}
      });`);
    const child = spawn(process.execPath, [join(root, 'worker.mjs')], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    child.stderr.resume(); const lines = createInterface({ input: child.stdout });
    const pending = new Map(); let id = 0;
    lines.on('line', text => { const r = JSON.parse(text); pending.get(r.id)?.(r); pending.delete(r.id); });
    const send = cmd => new Promise(resolve => { const key = ++id; pending.set(key, resolve); child.stdin.write(JSON.stringify({ ...cmd, id: key, awooPort: f.port }) + '\n'); });
    try {
      assert.equal((await send({ cmd: 'play', songId: '3362244118' })).ok, true);
      assert.equal((await send({ cmd: 'restore' })).ok, true);
      assert.deepEqual(f.requests.map(r => r.keyword), ['id=3362244118','id=123456']);
      assert.deepEqual(f.queue, ['777777','888888']);
    } finally { child.stdin.end(); child.kill(); lines.close(); }
  });
});
