// 第二十轮：拿到 store 后，直接 dispatch 动作控制播放 —— 检验能否取代「按像素点进度条」。
import { connect, sleep } from './cdp.mjs';

const port = Number(process.argv[2] || 9229);
const target = Number(process.argv[3] || 60);
const c = await connect(port);
await sleep(300);

const FIND = String.raw`(() => {
  if (window.__ncmStore) return { cached: true };
  const rootEl = document.getElementById('root') || document.body;
  const ck = Object.keys(rootEl).find(k => k.startsWith('__reactContainer'));
  if (!ck) return { err: 'no container key' };
  const host = rootEl[ck];
  const start = host.current || host;
  const q = [start]; const seen = new Set(); let n = 0;
  while (q.length && n < 80000) {
    const f = q.shift(); if (!f || seen.has(f)) continue; seen.add(f); n++;
    const p = f.memoizedProps;
    const cand = (p && p.store) || (p && p.value && p.value.store);
    if (cand && typeof cand.dispatch === 'function' && typeof cand.getState === 'function') {
      window.__ncmStore = cand; window.__ncmStoreDepth = n;
      return { found: true, depth: n };
    }
    if (f.child) q.push(f.child);
    if (f.sibling) q.push(f.sibling);
  }
  return { err: 'not found', visited: n };
})()`;
console.log('找 store:', JSON.stringify(await c.evaluate(FIND)));

const INFO = String.raw`(() => {
  const S = window.__ncmStore; if (!S) return { err: 'no store' };
  const st = S.getState(); const p = st.playing || {};
  return { slices: Object.keys(st), playKeyCount: Object.keys(p).length,
           name: p.resourceName, trackId: p.resourceTrackId, onlineId: p.onlineResourceId,
           duration: p.resourceDuration, playingState: p.playingState, mode: p.playingMode };
})()`;
console.log('store 内容:', JSON.stringify(await c.evaluate(INFO)));

const posFields = () => c.evaluate(String.raw`(() => {
  const S = window.__ncmStore; if (!S) return null;
  const p = S.getState().playing || {}; const o = {};
  for (const k of Object.keys(p)) if (/position|duration|time|seek|progress/i.test(k)) o[k] = p[k];
  return o;
})()`);

const before = await c.readState();
console.log('\n--- 试验 dispatch seek 到 ' + target + 's（当前 UI 读数 ' + before.seconds + 's）');
console.log('dispatch 返回:', await c.evaluate(`(() => { const S = window.__ncmStore; if (!S) return 'no store'; S.dispatch({type:'playing/setPlayingPosition', payload:{duration:${target}}}); return 'dispatched'; })()`));
await sleep(1500);
const after = await c.readState();
console.log('UI 读数: ' + after.seconds + 's  -> ' + (Math.abs(after.seconds - target) < 4 ? '✅ dispatch seek 生效！' : '❌ 未生效'));
console.log('state 位置字段:', JSON.stringify(await posFields()));

// 对照：暂停 / 恢复
console.log('\n--- 试验 dispatch 暂停/恢复');
await c.evaluate(`(() => { window.__ncmStore.dispatch({type:'playing/pause'}); return 1; })()`);
await sleep(1200);
const p1 = await c.readState();
console.log('dispatch pause  -> playing=' + p1.playing + ' ' + (p1.playing === false ? '✅' : '❌'));
await c.evaluate(`(() => { window.__ncmStore.dispatch({type:'playing/resume', payload:{triggerScene:0}}); return 1; })()`);
await sleep(1200);
const p2 = await c.readState();
console.log('dispatch resume -> playing=' + p2.playing + ' ' + (p2.playing === true ? '✅' : '❌'));

c.close();
