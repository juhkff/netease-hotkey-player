// 第二十六轮：找出「跳转后位置不会被重置」的正确时序。
//   A) 播放中直接跳转（不暂停）
//   B) 暂停 → 跳转 → resume
//   C) 暂停 → 跳转 → playing/play
import { connect, sleep } from '../lib/ncm.mjs';

const port = Number(process.argv[2] || 9229);
const c = await connect(port);

const show = (tag, s) => console.log(`  ${tag}: playing=${s.playing} state=${s.playingState} pos=${s.seconds} pct=${s.percentStr} name=${s.name}`);

async function waitLoaded(id, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await c.readState();
    if (String(s.songId) === String(id) && s.duration != null) return s;
    await sleep(200);
  }
  return await c.readState();
}

// ---------- A ----------
console.log('== A. 播放中直接跳转（不暂停）==');
await c.playById(186016);
let s = await waitLoaded(186016);
show('刚加载', s);
await sleep(1200);
show('等 1.2s', await c.readState());
await c.seek(42);
await sleep(800);
show('seek(42) 后 0.8s', await c.readState());
await sleep(2000);
show('再等 2s', await c.readState());

// ---------- B ----------
console.log('\n== B. 暂停 -> seek(100) -> resume ==');
await c.pause();
await sleep(400);
show('暂停后', await c.readState());
await c.seek(100);
await sleep(700);
show('seek(100) 后', await c.readState());
await c.resume();
await sleep(1500);
show('resume 后 1.5s', await c.readState());

// ---------- C ----------
console.log('\n== C. 暂停 -> seek(150) -> playing/play ==');
await c.pause();
await sleep(400);
await c.seek(150);
await sleep(700);
show('seek(150) 后', await c.readState());
const r = await c.evaluate(String.raw`(() => {
  const st = window.__ncm.ensureStore();
  const out = {};
  for (const p of [undefined, { triggerScene: 0 }, {}]) {
    try {
      if (p === undefined) st.dispatch({ type: 'playing/play' });
      else st.dispatch({ type: 'playing/play', payload: p });
      out[String(p && JSON.stringify(p))] = 'ok';
    } catch (e) { out[String(p && JSON.stringify(p))] = 'THROW ' + String((e && e.message) || e); }
    break; // 只试第一种，避免多次触发
  }
  return out;
})()`);
console.log('  dispatch playing/play -> ' + JSON.stringify(r));
await sleep(1500);
show('playing/play 后 1.5s', await c.readState());

c.close();
