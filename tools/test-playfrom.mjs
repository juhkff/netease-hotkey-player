// 测 playFrom：重点看 heard —— 也就是「切歌之后到暂停之间播了多少秒」，
// 这正是用户在开头听到的那一下有多长。
//
// 用法：node test-playfrom.mjs <port> <songId> <seconds>
import { connect } from '../lib/ncm.mjs';

const port = Number(process.argv[2] || 9229);
const songId = String(process.argv[3] || '35447132');
const secs = Number(process.argv[4] || 90);

const c = await connect(port);
console.log('connected: ' + c.target.url);

const before = await c.readState();
console.log('before: ' + JSON.stringify({ songId: before.songId, name: before.name, playing: before.playing, seconds: before.seconds }));

const t0 = Date.now();
try {
  const r = await c.playFrom(songId, secs);
  console.log('OK ' + JSON.stringify({
    song: r.song.name,
    artists: r.song.artists,
    target: r.target,
    seeked: r.seeked,
    error: r.error,
    attempts: r.attempts,
    heard: r.heard,
    playingAtEnd: r.state.seconds,
    costMs: Date.now() - t0
  }));
} catch (e) {
  console.log('FAIL ' + e.message + '  (' + (Date.now() - t0) + 'ms)');
}
c.close();
process.exit(0);
