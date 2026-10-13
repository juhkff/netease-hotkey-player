// 端到端测「打断 → 复位」：记中断点 → 播片段 → 复位 → 核对歌、位置、队列。
import { connect } from '../lib/ncm.mjs';
const c = await connect(Number(process.argv[2] || 9229));
const clipId = String(process.argv[3] || '1330348068');
const clipSec = Number(process.argv[4] || 20);
const pauseFirst = process.argv.includes('--paused');

if (pauseFirst) { await c.pause(); await new Promise(r => setTimeout(r, 900)); }

const snap = await c.snapshot();
console.log('SNAPSHOT  ' + JSON.stringify({ song: snap.name, id: snap.songId, at: snap.seconds,
  playing: snap.playing, queue: snap.queue.length }));

const r = await c.playFrom(clipId, clipSec);
console.log('CLIP      ' + r.song.name + ' @' + r.seeked + 's   (队列 ' + (await c.queueIds()).length + ' 首)');

const b = await c.readState();
console.log('AFTER-CLIP cur=' + b.name + ' @' + b.seconds + 's');

const back = await c.restore(snap);
console.log('RESTORE   ' + JSON.stringify(back));

const now = await c.readState();
const q = await c.queueIds();
const lost = snap.queue.filter(x => q.indexOf(x) < 0);
const extra = q.filter(x => snap.queue.indexOf(x) < 0);
console.log('VERIFY    cur=' + now.name + ' @' + now.seconds + 's playing=' + now.playing);
console.log('          位置误差=' + (now.seconds - snap.seconds).toFixed(2) + 's  队列 ' + snap.queue.length + '→' + q.length +
            '  lost=[' + lost + '] extra=[' + extra + ']');
c.close(); process.exit(0);
