// 第二十四轮：测试两条「直接播放指定 ID」的捷径，替代脆弱的 UI 搜索流程。
//   A) 页面上下文里能否直接请求网易云 HTTP API（拿到完整 track 对象）
//   B) 用一个最小 track 对象直接 dispatch playing/setPlaying，看 app 自己会不会补齐并播放
import { connect } from './cdp.mjs';

const c = await connect(Number(process.argv[2] || 9229));

// ---------- A ----------
const apiTest = await c.evaluate(String.raw`(async () => {
  const out = {};
  const tryUrl = async (name, url) => {
    try {
      const r = await fetch(url, { credentials: 'include' });
      const t = await r.text();
      out[name] = 'status=' + r.status + ' len=' + t.length + ' head=' + t.slice(0, 200).replace(/\s+/g, ' ');
    } catch (e) { out[name] = 'ERR ' + String((e && e.message) || e); }
  };
  await tryUrl('song_detail', 'https://music.163.com/api/song/detail?ids=%5B186016%5D');
  await tryUrl('v3_song_detail', 'https://music.163.com/api/v3/song/detail?c=' + encodeURIComponent(JSON.stringify([{ id: 186016 }])));
  await tryUrl('ifacepc', 'https://interfacepc.music.163.com/api/song/detail?ids=%5B186016%5D');
  return out;
})()`);
console.log('== A. 页面内 HTTP 请求 ==');
console.log(JSON.stringify(apiTest, null, 1));

// ---------- B ----------
const before = await c.readState();
console.log('\n== B. 直接 dispatch playing/setPlaying ==');
console.log('BEFORE  songId=' + before.songId + ' name=' + before.name + ' playing=' + before.playing);

const disp = await c.evaluate(String.raw`(() => {
  const s = window.__ncmStore;
  if (!s) return 'no store';
  const track = { id: 186016, name: '晴天', duration: 269000,
    artists: [{ id: 6452, name: '周杰伦' }], album: { id: 18876, name: '叶惠美' } };
  try {
    s.dispatch({ type: 'playing/setPlaying', payload: {
      trackIn: { ai: '', aiRcmd: false, href: '', text: '', scene: '', track,
                 resourceType: 'track', resourceId: '186016', trackId: '186016',
                 fromInfo: '', displayOrder: -1, randomOrder: -1 },
      playingState: 2, fromType: 'search', triggerScene: 'search' } });
    return 'ok';
  } catch (e) { return 'THROW ' + String((e && e.message) || e); }
})()`);
console.log('DISPATCH -> ' + disp);

await new Promise((r) => setTimeout(r, 3000));
const after = await c.readState();
console.log('AFTER   songId=' + after.songId + ' name=' + after.name + ' artist=' + after.artist +
            ' playing=' + after.playing + ' sec=' + after.seconds + ' dur=' + after.duration);

c.close();
