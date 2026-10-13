// 端到端验收：播放指定歌曲 → 跳到指定秒数 → 确认正在播放且位置正确。
// 用法: node verify.mjs <port> <songId> <startSeconds>
import { connect, sleep } from '../lib/ncm.mjs';

const port = Number(process.argv[2] || 9229);
const songId = Number(process.argv[3] || 186016);
const startSec = Number(process.argv[4] || 42);

const t0 = Date.now();
const c = await connect(port);
console.log('已连上播放器页面: ' + c.target.url);

const before = await c.readState();
console.log('当前: ' + before.name + ' / ' + before.songId + ' / playing=' + before.playing + ' / ' + before.seconds + 's');

console.log(`\n>>> playFrom(songId=${songId}, seconds=${startSec})`);
const r = await c.playFrom(songId, startSec, { tolerance: 0.6 });

console.log('\n=== 结果 ===');
console.log('歌曲     : ' + r.song.name + '  (id=' + r.song.id + ', 时长 ' + (r.song.duration / 1000) + 's)');
console.log('目标位置 : ' + r.target + 's');
console.log('实际位置 : ' + r.seeked + 's   误差 ' + r.error + 's   尝试 ' + r.attempts + ' 次');
console.log('最终状态 : playing=' + r.state.playing + '  songId=' + r.state.songId +
            '  name=' + r.state.name + '  seconds=' + r.state.seconds);
console.log('耗时     : ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

// 再等 3 秒，确认确实在往前走（即真的在播放）
await sleep(3000);
const later = await c.readState();
console.log('3 秒后   : seconds=' + later.seconds + '  playing=' + later.playing +
            '  (前进 ' + (later.seconds - r.state.seconds).toFixed(2) + 's)');

const pass = String(r.state.songId) === String(songId) && r.state.playing && Math.abs(r.error) <= 0.6;
console.log('\n' + (pass ? '✅ 通过' : '❌ 不通过'));
c.close();
process.exit(pass ? 0 : 1);
