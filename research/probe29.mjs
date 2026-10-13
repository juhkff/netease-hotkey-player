// 第二十九轮：确认「自然加载的歌曲」能否真正走秒。
import { connect, sleep } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));
const show = (t, s) => console.log(`  ${t} songId=${s.songId} name=${s.name} playing=${s.playing} state=${s.playingState} pos=${s.seconds} pct=${s.percentStr} dur=${s.duration}`);

let s = await c.readState(); show('基线', s);

console.log('\n--- A) dispatch playing/resume，看位置是否前进 ---');
console.log('  resume -> ' + await c.resume());
for (let i = 1; i <= 5; i++) { await sleep(1000); s = await c.readState(); show(`+${i}s`, s); }

console.log('\n--- B) 暂停 -> seek(30) -> resume ---');
await c.pause(); await sleep(600);
s = await c.readState(); show('暂停后', s);
console.log('  seek(30) -> ' + await c.seek(30)); await sleep(700);
s = await c.readState(); show('seek后', s);
await c.resume();
for (let i = 1; i <= 4; i++) { await sleep(1000); s = await c.readState(); show(`+${i}s`, s); }
c.close();
