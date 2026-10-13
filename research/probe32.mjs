// 第三十二轮：注入歌曲后补发 playing/nativePlay，看能否让原生播放器真正出声。
import { connect, sleep } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));
const show = (t, s) => console.log(`  ${t} songId=${s.songId} name=${s.name} playing=${s.playing} state=${s.playingState} pos=${s.seconds} pct=${s.percentStr} dur=${s.duration}`);
let s = await c.readState(); show('基线', s);

const ID = 186016;
console.log('\n--- A) playById(setPlaying) → 再补发 playing/nativePlay ---');
console.log('  playById: ' + JSON.stringify(await c.playById(ID)));
await sleep(1500);
s = await c.readState(); show('注入后', s);

const variants = [
  { resourceId: ID, triggerScene: 0 },
  { resourceId: ID, triggerScene: 'search' },
  { trackId: ID, resourceId: ID, triggerScene: 0 },
];
for (let i = 0; i < variants.length; i++) {
  const p = JSON.stringify(variants[i]);
  console.log(`  变体${i + 1} nativePlay ${p}`);
  console.log('    dispatch -> ' + await c.evaluate(`(()=>{const st=window.__ncm.ensureStore();try{st.dispatch({type:'playing/nativePlay',payload:${p}});return 'sent';}catch(e){return 'err:'+e.message;}})()`));
  for (let k = 1; k <= 4; k++) { await sleep(1000); s = await c.readState(); show(`    +${k}s`, s); }
  if (s.playing && s.seconds > 0.5) { console.log('  ✅ 变体' + (i + 1) + ' 让位置前进了'); break; }
}
c.close();
