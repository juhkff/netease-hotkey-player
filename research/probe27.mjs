// 第二十七轮：搞清「注入的歌曲不真的出声」。
//   A) dump store 里真实播放中的 track 对象（对照组）
//   B) 对比 /api/song/detail 与 /api/v3/song/detail(含 privilege) 的字段差异
//   C) 带 privilege 注入后，连续 10 秒观察位置是否前进
import { connect, sleep } from '../lib/ncm.mjs';

const port = Number(process.argv[2] || 9229);
const c = await connect(port);

// ---------- A ----------
console.log('== A. store 里的真实播放对象 ==');
const dump = await c.evaluate(String.raw`(() => {
  const p = window.__ncm.ensureStore().getState().playing;
  const keys = Object.keys(p);
  const out = { playingKeys: keys };
  const cur = p.curPlaying;
  if (cur) out.curPlayingKeys = Object.keys(cur);
  const cw = p.curPlayingWithUpdateTimeLimit;
  if (cw) { out.cwKeys = Object.keys(cw); if (cw.track) out.cwTrackKeys = Object.keys(cw.track); }
  out.resourcePrivilege = p.resourcePrivilege;
  out.curPlaying = cur ? JSON.parse(JSON.stringify(cur)).id || Object.keys(cur) : null;
  out.isLoadingFirst = p.isLoadingFirst;
  out.loadingSeekRatio = p.loadingSeekRatio;
  out.resourceTrackId = p.resourceTrackId;
  out.resourceFeeValue = p.resourceFeeValue;
  out.resourcePayed = p.resourcePayed;
  out.resourceCanTry = p.resourceCanTry;
  return out;
})()`);
console.log(JSON.stringify(dump, null, 1).slice(0, 2500));

// ---------- B ----------
console.log('\n== B. 两种接口的字段对比 (id=186016) ==');
const cmp = await c.evaluate(String.raw`(async () => {
  const out = {};
  const d = await (await fetch('https://music.163.com/api/song/detail?ids=%5B186016%5D', { credentials: 'include' })).json();
  out.detail_keys = d.songs && d.songs[0] ? Object.keys(d.songs[0]) : null;
  out.detail_has_privilege = !!(d.songs && d.songs[0] && d.songs[0].privilege);
  const v3 = await (await fetch('https://music.163.com/api/v3/song/detail?c=' + encodeURIComponent(JSON.stringify([{ id: 186016 }])), { credentials: 'include' })).json();
  out.v3_tops = Object.keys(v3);
  out.v3_song_keys = v3.songs && v3.songs[0] ? Object.keys(v3.songs[0]) : null;
  out.v3_priv = v3.privileges && v3.privileges[0] ? v3.privileges[0] : null;
  return out;
})()`);
console.log(JSON.stringify(cmp, null, 1).slice(0, 2500));

// ---------- C ----------
console.log('\n== C. 带 privilege 注入并观察 10 秒 ==');
const inj = await c.evaluate(String.raw`(async () => {
  const st = window.__ncm.ensureStore();
  const v3 = await (await fetch('https://music.163.com/api/v3/song/detail?c=' + encodeURIComponent(JSON.stringify([{ id: 186016 }])), { credentials: 'include' })).json();
  const track = v3.songs[0];
  const priv = v3.privileges && v3.privileges[0];
  if (priv) track.privilege = priv;
  const trackIn = { ai: '', aiRcmd: false, href: '', text: '', scene: '', track,
                    resourceType: 'track', resourceId: track.id, trackId: track.id,
                    fromInfo: '', displayOrder: -1, randomOrder: -1 };
  st.dispatch({ type: 'playing/setPlaying',
                payload: { trackIn, playingState: 2, fromType: 'search', triggerScene: 'search' } });
  return { id: track.id, name: track.name, privKeys: priv ? Object.keys(priv) : null, fee: priv && priv.fee, pl: priv && priv.pl };
})()`);
console.log('  注入: ' + JSON.stringify(inj));

for (let i = 1; i <= 10; i++) {
  await sleep(1000);
  const s = await c.readState();
  console.log(`  +${i}s  pos=${s.seconds}  pct=${s.percentStr}  playing=${s.playing}  state=${s.playingState}`);
}

c.close();
