// Read-only diagnostic for external jukebox interference. Never changes playback.
import { mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect, sleep } from '../lib/ncm.mjs';

const seconds = Number(process.argv[2] || 90);
const port = Number(process.argv[3] || 9229);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600 || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Usage: node tools/trace-playback.mjs [seconds:1..600] [port:1..65535]');
}
await mkdir(resolve('out'), { recursive: true });
const output = resolve('out', `playback-trace-${Date.now()}.jsonl`);
const client = await connect(port);
let stopped = false, previous = '', lastWritten = 0;
process.once('SIGINT', () => { stopped = true; });
console.log(`Read-only trace started (${seconds}s): ${output}`);
try {
  const until = Date.now() + seconds * 1000;
  while (!stopped && Date.now() < until) {
    const state = await client.evaluate(`(() => {
      const st = window.__ncm.ensureStore().getState(), p = st.playing;
      const current = window.__ncm.read(), queue = st.playingList.curPlayingList || [];
      const ids = queue.map(x => String(x.resourceId || (x.track && x.track.id) || ''));
      const index = ids.indexOf(current.songId);
      const handoff = st['async:playingListHandoff'];
      return { ...current, playId: p.playId, mode: p.playingMode,
        queueLength: ids.length, queueIndex: index,
        nextIds: index >= 0 ? ids.slice(index + 1, index + 6) : [],
        handoffCommands: handoff && Array.isArray(handoff.playingCommands) ?
          handoff.playingCommands.slice(-3).map(x => typeof x.command === 'string' ? x.command : x.command && x.command.type || 'unknown') : [] };
    })()`);
    const key = JSON.stringify([state.songId, state.playId, state.playingState, state.mode,
      state.queueLength, state.queueIndex, state.nextIds, state.handoffCommands]);
    if (key !== previous || Date.now() - lastWritten >= 5000) {
      const entry = { at: new Date().toISOString(), ...state };
      await appendFile(output, JSON.stringify(entry) + '\n', 'utf8');
      console.log(JSON.stringify({ at: entry.at, name: entry.name, songId: entry.songId,
        seconds: entry.seconds, playing: entry.playing, queueIndex: entry.queueIndex, queueLength: entry.queueLength }));
      previous = key; lastWritten = Date.now();
    }
    await sleep(150);
  }
} finally { client.close(); }
console.log(`Trace complete: ${output}`);
