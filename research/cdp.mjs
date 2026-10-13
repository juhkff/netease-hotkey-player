/**
 * 网易云音乐 PC 客户端 CDP 控制库。
 *
 * 必须在 **Windows 侧** 用 node.exe 运行（WSL 访问不到客户端的调试端口）。
 * 前置条件：客户端以 --remote-debugging-port=<port> 启动。
 *
 * 已在本机验证的客户端版本：网易云音乐 3.1.41.205529
 *
 * 读状态靠 React fiber 上的 props（resourceDuration / onlineResourceId / resourceName …），
 * 跳转靠 CDP Input.dispatchMouseEvent 点击进度条真实坐标 —— 实测误差 < 0.1 秒。
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 页内读取播放状态的表达式。用 String.raw 保留正则/转义原样。 */
const PAGE_READ = String.raw`(() => {
  const bar = document.querySelector('.default-bar-wrapper');
  const s = document.querySelector('.slider-default');
  const R = e => { if (!e) return null; const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const out = { ok: false };
  if (!bar || !s) { out.reason = 'no-player-bar'; return out; }

  const pctStr = (s.style.getPropertyValue('--track-precent') || '').trim();
  const pct = parseFloat(pctStr);

  // 沿 fiber 往上逐层合并关心的 props（duration 和 name 在不同层级上）
  const info = {};
  const FIELDS = ['resourceDuration','resourceName','onlineResourceId','resourceTrackId',
                  'resourceType','resourcePlayingQuality','resourceCommentThreadId'];
  const fkey = Object.keys(s).find(x => x.startsWith('__reactInternalInstance$') || x.startsWith('__reactFiber$'));
  let f = fkey ? s[fkey] : null;
  for (let i = 0; f && i < 32; i++, f = f.return) {
    const p = f.memoizedProps;
    if (!p || typeof p !== 'object') continue;
    for (const k of FIELDS) {
      if (info[k] === undefined && p[k] !== undefined && typeof p[k] !== 'object') info[k] = p[k];
    }
  }

  const pb = bar.querySelector('#btn_pc_minibar_play');
  const icon = pb ? pb.querySelector('.cmd-icon') : null;
  const nameEl = bar.querySelector('.main-title');
  const authorEl = bar.querySelector('.author');

  out.ok = true;
  out.songId = info.onlineResourceId != null ? String(info.onlineResourceId)
            : (info.resourceTrackId != null ? String(info.resourceTrackId) : null);
  out.name = info.resourceName != null ? String(info.resourceName)
           : (nameEl ? nameEl.textContent.trim() : null);
  out.artist = authorEl ? authorEl.textContent.trim() : null;
  out.duration = typeof info.resourceDuration === 'number' ? info.resourceDuration : null;
  out.type = info.resourceType != null ? String(info.resourceType) : null;
  out.quality = info.resourcePlayingQuality != null ? info.resourcePlayingQuality : null;
  out.percentStr = pctStr;
  out.percent = isNaN(pct) ? null : pct;
  out.seconds = (out.duration != null && !isNaN(pct)) ? +(out.duration * pct / 100).toFixed(2) : null;
  out.playing = icon ? /icon-pause/.test(String(icon.className)) : null;
  out.slider = R(s);
  out.playBtn = R(pb);
  return out;
})()`;

/** 列出调试端口上的所有 target。 */
export async function listTargets(port = 9229, timeoutMs = 4000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** 找到主播放器页面 target。 */
async function findPlayerTarget(port) {
  const targets = await listTargets(port);
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
  return pages.find(t => /orpheus:\/\/orpheus\/pub\/app\.html/.test(t.url || ''))
      || pages.find(t => /网易云音乐/.test(t.title || ''))
      || pages[0] || null;
}

/**
 * 连接客户端播放器页面，返回控制对象。
 * @param {number} port 调试端口
 */
export async function connect(port = 9229) {
  const target = await findPlayerTarget(port);
  if (!target) {
    throw new Error(
      `在 127.0.0.1:${port} 没找到网易云播放器页面。\n` +
      `请用带调试端口的方式启动客户端（见 launch.ps1）。`);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('连接 CDP WebSocket 超时')), 8000);
    ws.addEventListener('open', () => { clearTimeout(to); res(); }, { once: true });
    ws.addEventListener('error', e => { clearTimeout(to); rej(new Error('CDP WebSocket 错误: ' + (e.message || e.type))); }, { once: true });
  });

  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  ws.addEventListener('close', () => {
    for (const [, fn] of pending) fn({ closed: true });
    pending.clear();
  });

  const send = (method, params = {}, timeoutMs = 10000) => new Promise(res => {
    const id = ++seq;
    const to = setTimeout(() => { pending.delete(id); res({ timedOut: true, method }); }, timeoutMs);
    pending.set(id, m => { clearTimeout(to); res(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });

  /** 在页面里求值，返回值本身（异常时抛）。 */
  const evaluate = async expr => {
    const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (m.closed) throw new Error('CDP 连接已断开');
    if (m.timedOut) throw new Error('页面求值超时');
    const d = m.result?.exceptionDetails;
    if (d) throw new Error('页面异常: ' + String(d.exception?.description || d.text).slice(0, 300));
    return m.result?.result?.value;
  };

  /** 在视口坐标 (x,y) 派发一次真实的鼠标左键点击。 */
  const clickAt = async (x, y) => {
    const xi = Math.round(x), yi = Math.round(y);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: xi, y: yi, button: 'none', buttons: 0 });
    await sleep(70);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xi, y: yi, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(50);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xi, y: yi, button: 'left', buttons: 0, clickCount: 1 });
  };

  /** 读取当前播放状态。 */
  const readState = () => evaluate(PAGE_READ);

  /**
   * 跳到指定秒数。内部最多校正 3 次（进度条像素级取整会带来 ~0.2s 偏差）。
   * 播放中跳转会有读数误差，调用方通常应先暂停。
   */
  const seekTo = async (seconds, { tolerance = 0.3, maxTries = 3, settleMs = 700 } = {}) => {
    let st = await readState();
    if (!st.ok) throw new Error('播放条不可用: ' + st.reason);
    if (st.duration == null) throw new Error('拿不到歌曲总时长');

    const target = Math.max(0, Math.min(st.duration - 0.5, seconds));
    let offsetPx = 0;
    let last = null;

    for (let attempt = 1; attempt <= maxTries; attempt++) {
      st = await readState();
      const ratio = target / st.duration;
      const x = Math.round(st.slider.x + st.slider.w * ratio) + offsetPx;
      const y = st.slider.y + Math.max(1, Math.floor(st.slider.h / 2));
      await clickAt(x, y);
      await sleep(settleMs);
      const after = await readState();
      last = after;
      const err = after.seconds == null ? Infinity : after.seconds - target;
      if (Math.abs(err) <= tolerance) {
        return { ...after, target: +target.toFixed(2), error: +err.toFixed(2), attempts: attempt };
      }
      // 落在目标之后 → 往左挪一个像素；落在之前 → 往右挪一个像素
      offsetPx += err > 0 ? -1 : 1;
    }
    return { ...last, target: +target.toFixed(2), error: +(last.seconds - target).toFixed(2), attempts: maxTries, inexact: true };
  };

  /**
   * 设置播放/暂停状态。
   * @param {boolean} want true=播放 false=暂停
   */
  const setPlaying = async (want, { settleMs = 900 } = {}) => {
    const st = await readState();
    if (!st.ok) throw new Error('播放条不可用: ' + st.reason);
    if (st.playing === want) return st;
    if (!st.playBtn || !st.playBtn.w) throw new Error('找不到可见的播放按钮');
    await clickAt(st.playBtn.x + st.playBtn.w / 2, st.playBtn.y + st.playBtn.h / 2);
    await sleep(settleMs);
    return await readState();
  };

  /**
   * 从指定秒数开始播放：先暂停（让跳转读数稳定）→ 精确跳转 → 播放。
   */
  const playFrom = async (seconds, opts = {}) => {
    await setPlaying(false);
    const seeked = await seekTo(seconds, opts);
    const playing = await setPlaying(true);
    return { seeked, state: playing };
  };

  const close = () => { try { ws.close(); } catch {} };

  return { send, evaluate, clickAt, readState, seekTo, setPlaying, playFrom, close, target };
}

export { sleep };
