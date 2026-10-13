// 第二十五轮：验证「不碰 UI，直接让 app 播放指定歌曲」。
//   A) 重新找到 redux store（每次页面重载后必须重找）
//   B) 页面内 fetch /api/song/detail 拿完整 track 对象
//   C) 直接 dispatch playing/setPlaying，看 app 是否接受并真的播放
import { connect, sleep } from './cdp.mjs';

const port = Number(process.argv[2] || 9229);
const targetId = Number(process.argv[3] || 186016);
const c = await connect(port);
await sleep(400);

const FIND_STORE = `(() => {
  if (window.__ncmStore && typeof window.__ncmStore.getState === 'function' && window.__ncmStore.getState().playing) return 'cached';
  const root = document.getElementById('root') || document.body;
  const key = Object.keys(root).find(k => k.startsWith('__reactContainer'));
  if (!key) return 'no reactContainer key; keys=' + Object.keys(root).join(',');
  const seen = new Set(); const stack = [root[key]]; let n = 0;
  while (stack.length && n < 300000) {
    const f = stack.pop(); if (!f || seen.has(f)) continue; seen.add(f); n++;
    const mp = f.memoizedProps;
    if (mp && typeof mp === 'object') {
      const cand = mp.store || (mp.value && mp.value.store);
      if (cand && typeof cand.getState === 'function' && cand.getState().playing) { window.__ncmStore = cand; return 'found after ' + n + ' fibers'; }
    }
    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
  }
  return 'not found; visited ' + n;
})()`;

console.log('== A. 找 store ==');
console.log('  ' + (await c.evaluate(FIND_STORE)));

console.log('== 当前 playing 状态 ==');
console.log('  ' + JSON.stringify(await c.evaluate(String.raw`(() => {
  const s = window.__ncmStore; if (!s) return null;
  const p = s.getState().playing;
  return { playingState: p.playingState, resourceTrackId: p.resourceTrackId,
           onlineResourceId: p.onlineResourceId, resourceName: p.resourceName,
           resourceDuration: p.resourceDuration };
})()`)));

console.log('\n== B. 页面内取 track 详情 (id=' + targetId + ') ==');
const detail = await c.evaluate(`(async () => {
  try {
    const r = await fetch('https://music.163.com/api/song/detail?ids=%5B${targetId}%5D', { credentials: 'include' });
    const j = await r.json();
    const t = j.songs && j.songs[0];
    if (!t) return { err: 'no song', keys: Object.keys(j) };
    return { ok: true, name: t.name, duration: t.duration,
             artists: (t.artists || []).map(a => a.name).join('/'),
             keys: Object.keys(t) };
  } catch (e) { return { err: String((e && e.message) || e) }; }
})()`);
console.log('  ' + JSON.stringify(detail));

if (!detail || !detail.ok) { console.log('取详情失败，终止'); c.close(); process.exit(1); }

const before = await c.readState();
console.log('\n== C. dispatch playing/setPlaying ==');
console.log('  BEFORE songId=' + before.songId + ' name=' + before.name + ' playing=' + before.playing);

const disp = await c.evaluate(`(async () => {
  const s = window.__ncmStore; if (!s) return 'no store';
  const r = await fetch('https://music.163.com/api/song/detail?ids=%5B${targetId}%5D', { credentials: 'include' });
  const j = await r.json();
  const track = j.songs && j.songs[0];
  if (!track) return 'no track';
  const trackIn = { ai: '', aiRcmd: false, href: '', text: '', scene: '', track: track,
    resourceType: 'track', resourceId: track.id, trackId: track.id,
    fromInfo: '', displayOrder: -1, randomOrder: -1 };
  const results = {};
  for (const st of [2, 1, 0]) {
    try {
      s.dispatch({ type: 'playing/setPlaying', payload: { trackIn, playingState: st, fromType: 'search', triggerScene: 'search' } });
      results['setPlaying_' + st] = 'ok';
    } catch (e) { results['setPlaying_' + st] = 'THROW ' + String((e && e.message) || e); }
    await new Promise(z => setTimeout(z, 2500));
    const p = s.getState().playing;
    results['after_' + st] = p.resourceName + ' / ' + (p.onlineResourceId || p.resourceTrackId) + ' / state=' + p.playingState;
    if (String(p.onlineResourceId || p.resourceTrackId) === '${targetId}') { results.hit = 'setPlaying_' + st; break; }
  }
  return results;
})()`);
console.log('  ' + JSON.stringify(disp, null, 1));

await sleep(1000);
const after = await c.readState();
console.log('\n  AFTER  songId=' + after.songId + ' name=' + after.name + ' artist=' + after.artist +
            ' playing=' + after.playing + ' sec=' + after.seconds + ' dur=' + after.duration);
console.log('\n结果: ' + (String(after.songId) === String(targetId) ? '✅ dispatch 直接播放成功' : '❌ 没播目标'));
c.close();
