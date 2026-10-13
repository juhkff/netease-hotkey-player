// 第五轮：端到端验证（读时长 → 精确跳转 → 校验误差 → 播放）+ 找歌曲 ID。只读+跳转测试。
const PORT = Number(process.argv[2] || 9229);
const TARGET = Number(process.argv[3] || 42);   // 目标秒数
const FORCE_PLAY = process.argv[4] !== 'noplay';

const READ = `(() => {
  const s = document.querySelector('.slider-default');
  const g = n => s ? (s.style.getPropertyValue(n) || '').trim() : null;
  const pct = parseFloat(g('--track-precent'));
  let dur = null;
  if (s) {
    const k = Object.keys(s).find(x => x.startsWith('__reactInternalInstance$') || x.startsWith('__reactFiber$'));
    let f = k ? s[k] : null;
    for (let i = 0; f && i < 30; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p && typeof p.resourceDuration === 'number' && p.resourceDuration > 0) { dur = p.resourceDuration; break; }
    }
  }
  const r = s ? s.getBoundingClientRect() : null;
  const playIcon = document.querySelector('#btn_pc_minibar_play .cmd-icon');
  const playCls = playIcon ? String(playIcon.className) : '';
  const pb = document.querySelector('#btn_pc_minibar_play');
  const pbr = pb ? pb.getBoundingClientRect() : null;
  const title = document.querySelector('.default-bar-wrapper .main-title span');
  const author = document.querySelector('.default-bar-wrapper .author > span');
  return {
    percent: g('--track-precent'),
    pctNum: isNaN(pct) ? null : pct,
    duration: dur,
    seconds: (dur != null && !isNaN(pct)) ? +(dur * pct / 100).toFixed(2) : null,
    playing: /icon-pause/.test(playCls),
    playIconCls: playCls.slice(-30),
    sliderY: r ? Math.round(r.y + Math.max(1, Math.floor(r.height / 2))) : null,
    sliderX: r ? Math.round(r.x) : null,
    sliderW: r ? Math.round(r.width) : null,
    playBtnXY: pbr ? [Math.round(pbr.x + pbr.width / 2), Math.round(pbr.y + pbr.height / 2)] : null,
    song: title ? title.textContent.trim() : null,
    artist: author ? author.textContent.trim() : null
  };
})()`;

const SONG_IDS = `(() => {
  const out = { fromDataLog: [], fromId: [], barFiber: [] };
  for (const e of document.querySelectorAll('[data-log]')) {
    const dl = e.getAttribute('data-log') || '';
    if (/songId|resourceId/i.test(dl)) out.fromDataLog.push(dl.slice(0, 150));
    if (out.fromDataLog.length > 4) break;
  }
  for (const e of document.querySelectorAll('[id^="list_song_"], [id*="song_"]')) {
    out.fromId.push(e.id); if (out.fromId.length > 6) break;
  }
  const bar = document.querySelector('.default-bar-wrapper');
  if (bar) {
    const k = Object.keys(bar).find(x => x.startsWith('__reactInternalInstance$') || x.startsWith('__reactFiber$'));
    let f = k ? bar[k] : null;
    for (let i = 0; f && i < 40; i++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== 'object') continue;
      const hit = {};
      for (const kk of Object.keys(p)) {
        const v = p[kk];
        if (/^(songId|resourceId|resource_id|trackId|id)$/i.test(kk) && (typeof v === 'number' || typeof v === 'string')) hit[kk] = v;
        if (/song|track/i.test(kk) && v && typeof v === 'object' && !Array.isArray(v)) {
          for (const ik of ['id', 'songId', 'resourceId', 'name', 'duration']) if (v[ik] != null && typeof v[ik] !== 'object') hit[kk + '.' + ik] = v[ik];
        }
      }
      if (Object.keys(hit).length) out.barFiber.push({ lvl: i, hit });
      if (out.barFiber.length > 5) break;
    }
  }
  return out;
})()`;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { redirect: 'error' })).json();
const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
let seq = 0; const pending = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(res => {
  const id = ++seq; const timer = setTimeout(() => { pending.delete(id); res({ timedOut: true, method }); }, 10000);
  pending.set(id, m => { clearTimeout(timer); res(m); }); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(50);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};

console.log('=== 初始状态 ===');
const s0 = await ev(READ);
console.log(JSON.stringify(s0, null, 1));

if (s0.duration) {
  const ratio = TARGET / s0.duration;
  const x = Math.round(s0.sliderX + s0.sliderW * ratio);
  console.log(`\n=== 跳转到 ${TARGET}s / 总 ${s0.duration}s = ${(ratio * 100).toFixed(3)}% → x=${x}, y=${s0.sliderY} ===`);
  await clickAt(x, s0.sliderY);
  await sleep(1500);
  const s1 = await ev(READ);
  console.log(`结果: percent=${s1.percent} → ${s1.seconds}s  误差=${s1.seconds != null ? (s1.seconds - TARGET).toFixed(2) : '?'}s`);
}

if (FORCE_PLAY) {
  const cur = await ev(READ);
  if (!cur.playing && cur.playBtnXY) {
    console.log(`\n=== 当前暂停，点击播放按钮 @ ${cur.playBtnXY} ===`);
    await clickAt(cur.playBtnXY[0], cur.playBtnXY[1]);
    await sleep(2500);
    const p1 = await ev(READ);
    await sleep(2000);
    const p2 = await ev(READ);
    console.log(`播放后: playing=${p1.playing} ${p1.seconds}s → 2s 后 ${p2.seconds}s`);
    console.log(p2.seconds > p1.seconds ? '✅ 正在播放' : '❌ 未推进');
  } else {
    console.log(`\n=== 已在播放 (${cur.playing})，跳过播放点击 ===`);
  }
}

console.log('\n=== 歌曲 ID 探测 ===');
console.log(JSON.stringify(await ev(SONG_IDS), null, 1));
ws.close();
