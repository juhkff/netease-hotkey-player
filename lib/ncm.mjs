/**
 * 网易云音乐 PC 客户端控制核心库（v3，全部机制已实测）。
 *
 * 原理：客户端是 CEF/Chromium。用 --remote-debugging-port 启动后，可以用 CDP 连上它的
 * 播放器页面，驱动它自己的 UI / redux，让客户端自己去播放和跳转。
 *
 * ⚠ 必须在 **Windows 侧** 用 node.exe 运行 —— WSL 访问不到客户端的调试端口。
 *    powershell.exe -NoProfile -Command "node '\\wsl.localhost\<发行版>\...\xxx.mjs'"
 *
 * 已验证：网易云音乐 3.1.41.205529（Windows）
 *
 * ── 两条关键路径（都是实测结论，不要想当然）──────────────────────────────
 * 1) 播放指定歌曲：**必须走 UI**（搜索 → 单曲 tab → 双击目标行）。
 *    ✘ 不要用 dispatch('playing/setPlaying') 注入歌曲对象：UI 会显示在播、'playingState'
 *      也会变成 2，但**原生播放器没有真正的音频流，位置永远停在 0**，并且会把播放器
 *      卡死（进度条百分比消失）。补发 'playing/nativePlay' 也救不回来（已实测）。
 * 2) 跳到指定秒数：dispatch('playing/setPlayingPosition', {duration: 秒})。
 *    暂停状态下派发，读数精确（实测 30 → 30.05s）。播放中直接派发不可靠，所以
 *    标准流程是「暂停 → 跳转 → 继续」。
 */

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 页内助手 window.__ncm。页面每次重载都会丢，connect() 会重新安装。 */
const PAGE_INSTALL = String.raw`(() => {
  if (window.__ncm && window.__ncm.version === 5) return 'already';
  const ncm = { version: 5 };

  // store 挂在某个组件的 props.store / props.value.store 上，从 React 根节点 DFS 找。
  ncm.ensureStore = function () {
    const cached = ncm.store;
    if (cached && typeof cached.getState === 'function' && cached.getState().playing) return cached;
    const root = document.getElementById('root') || document.body;
    const key = Object.keys(root).find(k => k.startsWith('__reactContainer'));
    if (!key) throw new Error('找不到 React 根节点');
    const seen = new Set(); const stack = [root[key]]; let n = 0;
    while (stack.length && n < 300000) {
      const f = stack.pop();
      if (!f || seen.has(f)) continue;
      seen.add(f); n++;
      const mp = f.memoizedProps;
      if (mp && typeof mp === 'object') {
        const cand = mp.store || (mp.value && mp.value.store);
        if (cand && typeof cand.getState === 'function' && cand.getState().playing) { ncm.store = cand; return cand; }
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    throw new Error('没找到 redux store');
  };

  // 位置来自播放条 --track-precent 百分比 × 总时长（实测误差 < 0.1 秒）。
  ncm.read = function () {
    const p = ncm.ensureStore().getState().playing;
    const s = document.querySelector('.default-bar-wrapper .slider-default') || document.querySelector('.slider-default');
    let pct = null, pctStr = null;
    if (s) { pctStr = (s.style.getPropertyValue('--track-precent') || '').trim(); pct = parseFloat(pctStr); }
    const dur = (typeof p.resourceDuration === 'number' && p.resourceDuration > 0) ? p.resourceDuration : null;
    return {
      songId: p.onlineResourceId != null ? String(p.onlineResourceId)
            : (p.resourceTrackId != null ? String(p.resourceTrackId) : null),
      name: p.resourceName || null,
      duration: dur,
      playingState: p.playingState,
      playing: p.playingState === 2,
      quality: p.resourcePlayingQuality,
      percentStr: pctStr,
      percent: isNaN(pct) ? null : pct,
      seconds: (dur != null && !isNaN(pct)) ? +(dur * pct / 100).toFixed(2) : null
    };
  };

  // 歌曲详情（页面内 fetch 官方接口，实测 200，无需额外鉴权、不受 CORS 限制）。
  ncm.track = async function (id) {
    const r = await fetch('https://music.163.com/api/song/detail?ids=%5B' + id + '%5D', { credentials: 'include' });
    const j = await r.json();
    const t = j && j.songs && j.songs[0];
    if (!t) throw new Error('取歌曲详情失败 id=' + id);
    return t;
  };

  // 搜歌（页面内直接打官方搜索接口，比驱动 UI 搜索稳得多也快得多）。
  ncm.search = async function (kw, limit, offset) {
    const url = 'https://music.163.com/api/search/get/web?csrf_token=&type=1&s=' +
      encodeURIComponent(kw) + '&offset=' + (offset || 0) + '&limit=' + (limit || 30);
    const r = await fetch(url, { credentials: 'include' });
    const j = await r.json();
    const songs = (j && j.result && j.result.songs) || [];
    return songs.map(function (s) {
      return {
        id: String(s.id),
        name: s.name,
        artists: (s.artists || []).map(function (a) { return a.name; }).join(' / '),
        album: (s.album && s.album.name) || '',
        duration: Math.round((s.duration || 0) / 1000)
      };
    });
  };

  ncm.seek   = function (sec) { ncm.ensureStore().dispatch({ type: 'playing/setPlayingPosition', payload: { duration: sec } }); return sec; };  ncm.pause  = function () { ncm.ensureStore().dispatch({ type: 'playing/pause' }); return true; };
  ncm.resume = function () { ncm.ensureStore().dispatch({ type: 'playing/resume', payload: { triggerScene: 0 } }); return true; };

  // ---- 「打断 / 复位」用的几个原语 ----

  // 当前播放队列（待播放列表）里每首歌的 id，按顺序。
  ncm.queueIds = function () {
    const pl = ncm.ensureStore().getState().playingList.curPlayingList || [];
    return pl.map(function (x) { return String((x && x.resourceId) || (x && x.track && x.track.id) || ''); });
  };

  // 记下一个「中断点」：谁在放、放到哪、是不是在播、队列里有哪些歌。
  ncm.snapshot = function () {
    const st = ncm.ensureStore().getState();
    const p = st.playing;
    const r = ncm.read();
    const pl = st.playingList.curPlayingList || [];
    return {
      songId: r.songId,
      name: r.name,
      duration: r.duration,
      seconds: r.seconds,
      playing: r.playing,
      playingMode: p.playingMode,
      playId: p.playId,
      queue: ncm.queueIds(),
      // 整份队列数据，复位时原样灌回去，连顺序都能复原
      queueItems: pl
    };
  };

  // 队列里跳到上一首 / 下一首。实测 flag:-1 是上一首，flag:+1 是下一首。
  ncm.jump = function (flag) {
    ncm.ensureStore().dispatch({ type: 'playingList/jump2Track', payload: { flag: flag, type: 'call', triggerScene: 1 } });
    return true;
  };

  /**
   * 把整份「待播放」队列换成给的那份（复位用）。
   * 参数是 JSON 字符串 —— 队列可能有几十首歌、对象很大，走字符串最稳。
   */
  ncm.replaceQueue = function (json) {
    try {
      const list = typeof json === 'string' ? JSON.parse(json) : json;
      if (!Array.isArray(list)) return false;
      ncm.ensureStore().dispatch({
        type: 'playingList/replaceCurPlayingList',
        payload: { list: list }
      });
      return true;
    } catch (e) { return false; }
  };

  /**
   * 从播放队列里按 id 删歌（复位时把我们插进去的那首清掉）。
   * payload 收的是一整个个 item 对象、字段名是 removeIds（从 bundle 里挖出来的），
   * 不是 id 数组 —— 所以这里先按 id 把 item 捞出来。
   */
  ncm.removeFromQueue = function (ids) {
    try {
      const pl = ncm.ensureStore().getState().playingList.curPlayingList || [];
      const want = (ids || []).map(String);
      const removeIds = pl.filter(function (x) {
        const id = String((x && x.resourceId) || (x && x.track && x.track.id) || '');
        return want.indexOf(id) >= 0;
      });
      if (!removeIds.length) return false;
      ncm.ensureStore().dispatch({
        type: 'playingList/onRemoveItemFromCurPlayingListByIds',
        payload: { removeIds: removeIds }
      });
      return true;
    } catch (e) { return false; }
  };

  window.__ncm = ncm;
  return 'installed';
})()`;

/** 列出调试端口上的所有 target。 */
export async function listTargets(port = 9229, timeoutMs = 4000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** 端口上是否有可用的播放器页面 —— 用来判断客户端是否处于「可控制」状态。 */
export async function isReady(port = 9229) {
  try {
    const targets = await listTargets(port, 1500);
    return targets.some(t => t.type === 'page' && t.webSocketDebuggerUrl);
  } catch { return false; }
}

async function findPlayerTarget(port) {
  const targets = await listTargets(port);
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
  return pages.find(t => /orpheus:\/\/orpheus\/pub\/app\.html/.test(t.url || ''))
      || pages.find(t => /网易云音乐/.test(t.title || ''))
      || pages[0] || null;
}

/**
 * 连接客户端播放器页面。
 * @param {number} port 调试端口，默认 9229
 */
export async function connect(port = 9229) {
  const target = await findPlayerTarget(port);
  if (!target) {
    throw new Error(`在 127.0.0.1:${port} 没找到网易云播放器页面。` +
      `请用 启动网易云(可控制).cmd 启动客户端（即 --remote-debugging-port=${port}）。`);
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
  ws.addEventListener('close', () => { for (const [, fn] of pending) fn({ closed: true }); pending.clear(); });

  const send = (method, params = {}, timeoutMs = 15000) => new Promise(res => {
    const id = ++seq;
    const to = setTimeout(() => { pending.delete(id); res({ timedOut: true, method }); }, timeoutMs);
    pending.set(id, m => { clearTimeout(to); res(m); });
    ws.send(JSON.stringify({ id, method, params }));
  });

  /** 在页面里求值，直接返回结果（异常时抛出）。 */
  const evaluate = async expr => {
    const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (m.closed) throw new Error('CDP 连接已断开');
    if (m.timedOut) throw new Error('页面求值超时');
    const d = m.result?.exceptionDetails;
    if (d) throw new Error('页面异常: ' + String(d.exception?.description || d.text).slice(0, 300));
    return m.result?.result?.value;
  };

  await evaluate(PAGE_INSTALL);

  const readState = () => evaluate('window.__ncm.read()');
  const seek = sec => evaluate(`window.__ncm.seek(${Number(sec)})`);
  const pause = () => evaluate('window.__ncm.pause()');
  const resume = () => evaluate('window.__ncm.resume()');

  // ---- 「打断 / 复位」 ----

  /** 记下当前的中断点（谁在放、放到哪、队列长什么样）。 */
  const snapshot = () => evaluate('window.__ncm.snapshot()');

  const queueIds = () => evaluate('window.__ncm.queueIds()');

  /**
   * 复位到某个中断点：跳回那首歌 → 跳回那个位置 → 恢复原来的播放/暂停状态。
   *
   * 原理（实测）：双击播放一首歌时，网易云只把它**插到当前歌的后面**，原有的待播放队列
   * 一首都不会丢。所以复位时从当前这首「上一首」退一步，正好就是被打断的那首。
   * 但为了稳妥，这里不假设只有一步，而是边退边核对 songId，最多退 5 步。
   */
  const restore = async (saved, { maxSteps = 5, settleMs = 900 } = {}) => {
    if (!saved || !saved.songId) throw new Error('没有可复位的中断点');
    const want = String(saved.songId);
    const sameQueue = q => JSON.stringify(q) === JSON.stringify(saved.queue || []);

    // 1) 跳回中断前那首歌。走上/下一首，不搜索、不动队列。
    let steps = 0;
    const backToIt = async () => {
      if (String((await readState()).songId) === want) return true;
      for (let i = 0; i < maxSteps; i++) {
        await evaluate('window.__ncm.jump(-1)');
        steps++;
        // 等它切过来，并立刻按住，别让开头那一下跑出来
        const t0 = Date.now();
        while (Date.now() - t0 < 6000) {
          await pause().catch(() => {});
          const s = await readState();
          if (String(s.songId) === want && s.duration != null) return true;
          await sleep(80);
        }
      }
      return String((await readState()).songId) === want;
    };

    if (!(await backToIt())) {
      const cur = await readState();
      throw new Error(`复位失败：退了 ${steps} 步也没回到《${saved.name || want}》，` +
                      `当前是《${cur.name || cur.songId}》。这首歌可能已经被移出播放队列了。`);
    }

    // 2) 把「待播放」队列还原成中断前的样子。
    //    双击播放会把我们的歌插到当前歌后面（本来就在队列里就只是挪个位置），
    //    顺序也会变，所以整份回灌最干净。实测回灌不碰播放、不换歌。
    //    注：playingList/onRemoveItemFromCurPlayingListByIds 从外部 dispatch 不生效
    //    （它只往事件管道丢一个 emitEvent），别再走那条路。
    let cleaned = true;
    if (Array.isArray(saved.queueItems) && saved.queueItems.length) {
      try {
        if (!sameQueue(await queueIds())) {
          await evaluate(`window.__ncm.replaceQueue(${JSON.stringify(JSON.stringify(saved.queueItems))})`);
          await sleep(700);
          cleaned = sameQueue(await queueIds());
        }
      } catch { cleaned = false; }
    }

    // 回灌队列理论上不碰播放，但保险起见确认一下还停在目标歌上
    if (String((await readState()).songId) !== want && !(await backToIt())) {
      throw new Error('复位失败：还原播放队列之后当前歌曲变了，而且回不去。');
    }

    // 3) 回到中断时的位置
    let seeked = null, error = null;
    if (saved.seconds != null && saved.duration != null && saved.seconds > 0.2) {
      await seek(saved.seconds);
      await sleep(500);
      const s = await readState();
      seeked = s.seconds;
      error = s.seconds == null ? null : +(s.seconds - saved.seconds).toFixed(2);
    }

    // 4) 恢复原来的播放/暂停状态
    if (saved.playing) {
      await resume();
      await sleep(350);
    } else {
      await pause();
    }

    const final = await readState();
    return {
      ok: true, song: saved.name, target: saved.seconds,
      seeked, error, steps, cleaned, wasPlaying: saved.playing,
      state: final
    };
  };

  /** 取歌曲信息（名称/时长/歌手/专辑），用来推导搜索关键词。 */
  const trackInfo = async id => {
    const t = await evaluate(`window.__ncm.track(${JSON.stringify(String(id))})`);
    if (!t || !t.id) throw new Error('取歌曲详情失败: ' + id);
    const artists = (t.artists || []).map(a => a.name);
    const album = (t.album && t.album.name) || '';
    return {
      id: String(t.id),
      name: t.name,
      duration: Math.round((t.duration || 0) / 1000),
      artists: artists.join(' / '),
      album,
      // 歌名 + 歌手 + 专辑 一起搜最准。实测周杰伦《晴天》只用「晴天」「晴天 周杰伦」
      // 都搜不到原版（前 150 条全是翻唱），加上专辑名「叶惠美」后原版直接排到第 0 位。
      keyword: [t.name, artists[0] || '', album].filter(Boolean).join(' ')
    };
  };

  /**
   * 查歌曲在当前账号下的可播性。
   * 关键：`st` 是资源状态，`st < 0` 表示这个账号放不了（版权/地区限制/已下架）。
   * 实测：周杰伦《晴天》186016 → st=-200，怎么点都不出声；《起风了》→ st=0，正常播。
   * 注意 fee（0=免费/1=VIP/8=专辑）不代表能不能放，必须以 st 为准。
   */
  const privilege = async id => {
    const r = await evaluate(`(async () => {
      const r = await fetch('https://music.163.com/api/song/enhance/privilege?ids=%5B' + ${JSON.stringify(String(id))} + '%5D', { credentials: 'include' });
      const j = await r.json();
      return JSON.stringify(((j.data || [])[0]) || null);
    })()`);
    return r ? JSON.parse(r) : null;
  };

  /**
   * 按关键词搜歌，返回 [{id, name, artists, album, duration}]。
   * 结果原样来自官方搜索接口，可用于让用户挑歌（不必知道歌曲 ID）。
   */
  const searchSongs = async (keyword, limit = 30, offset = 0) => {
    const raw = await evaluate(`(async () => {
      const r = await window.__ncm.search(${JSON.stringify(String(keyword))}, ${Number(limit)}, ${Number(offset)});
      return JSON.stringify(r);
    })()`);
    try { return JSON.parse(raw) || []; } catch { return []; }
  };

  /** 把关键词敲进常驻搜索框并回车。 */
  const submitSearch = async keyword => {
    await evaluate(String.raw`(() => {
      const inp = document.querySelector('[class*="SearchWrapper_"] input') || document.querySelector('input.cmd-input');
      if (!inp) throw new Error('找不到搜索框');
      inp.focus();
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(inp, '');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await send('Input.insertText', { text: keyword });
    await sleep(250);
    for (const type of ['keyDown', 'char', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        text: '\r', unmodifiedText: '\r'
      });
    }
    // 等结果页的关键词变成这次查询。
    // 注意：早先这里只比对了关键词的第一个词，导致「已经在结果页、且新查询的第一个词和旧的相同」
    // 时立刻误判成搜索成功，页面还停在旧结果上（表现为明明能搜到的歌却一行都没有）。
    const norm = s => String(s || '').replace(/\s+/g, '').trim();
    const wantKw = norm(keyword);
    for (let i = 0; i < 24; i++) {
      await sleep(250);
      const kw = await evaluate(`(() => { const e = document.querySelector('.keyword'); return e ? String(e.textContent).trim() : null; })()`);
      if (norm(kw) === wantKw) return true;
    }
    throw new Error('搜索没有出结果页：' + keyword);
  };

  /** 切到「单曲」tab（只有这个 tab 的行才是歌曲）。 */
  const clickSongTab = async () => {
    await evaluate(String.raw`(() => {
      const t = document.querySelector('#cmdTab1') || document.querySelector('[data-testid="tid_btn_pc_search_tab_song"]');
      if (!t) throw new Error('找不到「单曲」tab');
      t.click();
      return true;
    })()`);
  };

  /**
   * 在「单曲」结果**当前渲染出的行**里找 trackId 匹配的行并双击。
   * 返回 'clicked' | 'not-found'。查找和双击放在同一次页内求值里，避免虚拟列表滚动导致错位。
   */
  const dblclickRowById = id => evaluate(`(() => {
    const want = ${JSON.stringify(String(id))};
    const els = [...document.querySelectorAll('[data-log*="cell_pc_songlist_song"]')]
      .filter(e => e.getClientRects().length);
    for (const el of els) {
      let f = null;
      for (const k of Object.keys(el)) if (k.indexOf('__reactInternalInstance$') === 0) { f = el[k]; break; }
      let node = f, data = null;
      for (let d = 0; d < 14 && node; d++) {
        const p = node.memoizedProps;
        if (p && p.data && p.data.id) { data = p.data; break; }
        if (p && p.track && p.track.id) { data = p.track; break; }
        node = node.return;
      }
      if (data && String(data.id) === want) {
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
        return 'clicked';
      }
    }
    return 'not-found';
  })()`);

  /** 把搜索结果列表往下滚一屏（虚拟列表 + 无限加载，滚到底会自动取下一页）。 */
  const scrollResults = async () => {
    const box = await evaluate(`(() => {
      const els = [...document.querySelectorAll('[data-log*="cell_pc_songlist_song"]')]
        .filter(e => e.getClientRects().length);
      if (!els.length) return '';
      const r = els[Math.min(4, els.length - 1)].getBoundingClientRect();
      return Math.round(r.x + 300) + ',' + Math.round(r.y + r.height / 2);
    })()`);
    if (!box) return false;
    const [x, y] = String(box).split(',').map(Number);
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y, deltaX: 0, deltaY: 1400, button: 'none', buttons: 0
    });
    return true;
  };

  /** 等这首歌真正开始出声（位置在往前走）。返回最后的读数。 */
  const waitRealPlayback = async (songId, timeoutMs = 15000) => {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
      await sleep(400);
      const s = await readState();
      last = s;
      if (String(s.songId) !== String(songId)) continue;
      if (s.duration == null) continue;
      if (s.seconds != null && s.seconds > 0.15) return { ok: true, state: s };
    }
    return { ok: false, state: last };
  };

  /**
   * 等新歌**加载出来**（歌切过来了、时长有了），但**不等它出声**。
   * 用途：切歌之后立刻暂停，抢在开头那一下被听见之前。
   */
  const waitLoaded = async (songId, timeoutMs = 15000) => {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
      // 每轮都按一下暂停：新歌一加载出来就立刻停住，尽量把开头那一下压到最短。
      await pause().catch(() => {});
      const s = await readState();
      last = s;
      if (String(s.songId) === String(songId) && s.duration != null) {
        await pause().catch(() => {});
        return { ok: true, state: s, pausedAt: Date.now() };
      }
      await sleep(60);
    }
    return { ok: false, state: last, pausedAt: Date.now() };
  };

  /**
   * 这首歌是不是**真的**已经在放 —— 判据是位置在往前走。
   * 位置不走说明是坏状态（例如曾经被 dispatch('playing/setPlaying') 注入过：UI 显示在播、
   * duration 也有，但原生播放器没有音频流，位置永远停在 0），此时必须重新加载。
   */
  const isReallyPlaying = async id => {
    const a = await readState();
    if (String(a.songId) !== id || a.duration == null || a.seconds == null) return false;
    if (!a.playing) {
      await resume();
      await sleep(900);
      const b = await readState();
      return b.seconds != null && b.seconds > a.seconds + 0.2;
    }
    await sleep(900);
    const b = await readState();
    return b.seconds != null && b.seconds > a.seconds + 0.2;
  };

  /**
   * 播放指定歌曲 —— 走 UI（搜索 → 单曲 tab → 双击匹配行）。
   * @param {string|number} songId
   * @param {{keyword?: string, info?: object}} opts keyword 不传则自动用「歌名 歌手」。
   */
  /** 当前搜索结果页有几行歌（「单曲」tab 里）。0 行说明这个关键词什么都没搜到。 */
  const countRows = async () => {
    try {
      const n = await evaluate(
        `document.querySelectorAll('[data-log*="cell_pc_songlist_song"]').length`);
      return Number(n) || 0;
    } catch { return 0; }
  };

  /** 在搜索结果里边滚边找目标行并双击。返回 'clicked' | 'not-found'。 */
  const findAndClick = async id => {
    let clicked = 'not-found';
    let screens = 0;
    for (let i = 0; i < 10; i++) {
      const deadline = Date.now() + (i === 0 ? 12000 : 6000);
      while (Date.now() < deadline) {
        clicked = await dblclickRowById(id);
        if (clicked === 'clicked') return { clicked, screens, tClick: Date.now() };
        await sleep(250);
      }
      if (!(await scrollResults())) {
        await sleep(900);          // 也可能只是这一屏还没渲染完，等一下再试一次
        if (!(await scrollResults())) break;
      }
      screens++;
      await sleep(1100);
    }
    return { clicked, screens, tClick: null };
  };

  const playTrackById = async (songId, { keyword, info, pauseAsap = false } = {}) => {
    const id = String(songId);
    const meta = info || await trackInfo(id);

    // 已经在真放这首歌就跳过搜索（但必须验证位置真的在走，否则是坏状态）
    if (await isReallyPlaying(id)) {
      return { ok: true, method: 'already', info: meta, keyword: keyword || meta.keyword, state: await readState() };
    }

    // 关键词要备一梯队。实测【歌名+歌手+专辑】能把周杰伦《晴天》从第 180 名外顶到第 1 名，
    // 但专辑名有时反而把结果收敛成 0 条（比如专辑名和歌名同名时），所以搜不到就逐级放宽。
    const nm = meta.name || '';
    const ar = String(meta.artists || '').split(' / ')[0] || '';
    const al = meta.album || '';
    const cands = [];
    if (keyword) cands.push(keyword);
    if (nm && ar && al && al !== nm) cands.push([nm, ar, al].join(' '));
    if (nm && ar) cands.push([nm, ar].join(' '));
    if (nm) cands.push(nm);
    if (meta.keyword) cands.push(meta.keyword);

    let kw = null, clicked = 'not-found', screens = 0, tClick = null;
    const tried = [];
    for (const cand of cands) {
      if (!cand || tried.indexOf(cand) >= 0) continue;
      tried.push(cand);
      await submitSearch(cand);
      await clickSongTab();
      // 切到「单曲」tab 之后结果行不是立刻就有：实测客户端的搜索结果渲染很慢
      // （最多见过 16 秒才把行铺出来），所以这里给足时间；中途再点一次 tab
      // 逼它重挂载列表，能显著加快出结果。
      let rows = 0;
      const t0 = Date.now();
      let reclicked = false;
      while (Date.now() - t0 < 22000) {
        rows = await countRows();
        if (rows > 0) break;
        if (!reclicked && Date.now() - t0 > 6000) { reclicked = true; await clickSongTab().catch(() => {}); }
        await sleep(300);
      }
      if (rows === 0) continue;
      kw = cand;
      const r = await findAndClick(id);
      clicked = r.clicked; screens = r.screens; tClick = r.tClick;
      if (clicked === 'clicked') break;
    }
    if (clicked !== 'clicked') {
      throw new Error(`搜索结果里没找到 id=${id}（${meta.name}），` +
                      `试过关键词 ${JSON.stringify(tried)}，最多向下翻 ${screens} 屏。`);
    }

    // pauseAsap：切歌后立刻按暂停，抢在开头那一下出声之前。
    // 代价是拿不到「位置真的在走」这个证据，所以调用方必须在 resume 之后自己验证。
    const real = pauseAsap
      ? await waitLoaded(id, 15000)
      : await waitRealPlayback(id, 15000);
    if (!real.ok) {
      // 双击了却没动静 —— 最常见的原因是这首歌当前账号根本放不了。
      const priv = await privilege(id).catch(() => null);
      if (priv && typeof priv.st === 'number' && priv.st < 0) {
        throw new Error(`歌曲《${meta.name}》当前账号无法播放（st=${priv.st}，` +
                        `一般是版权/地区限制或已下架），换一首歌试试。`);
      }
    }
    return {
      ok: real.ok, method: 'search+dblclick', info: meta,
      keyword: kw, screens, state: real.state, tClick, pausedAt: real.pausedAt
    };
  };

  /**
   * 从指定秒数开始播放指定歌曲 —— 主流程。
   * 播放 → 等真正出声 → 暂停 → 跳转（带像素级重试）→ 继续。
   */
  const playFrom = async (songId, seconds, { keyword, tolerance = 0.6, maxTries = 4, settleMs = 600 } = {}) => {
    // 放不了就早点报清楚，别白搜一场
    const priv = await privilege(songId).catch(() => null);
    if (priv && typeof priv.st === 'number' && priv.st < 0) {
      const m = await trackInfo(songId).catch(() => null);
      throw new Error(`歌曲《${(m && m.name) || songId}》当前账号无法播放（st=${priv.st}，` +
                      `一般是版权/地区限制或已下架）。`);
    }

    const loaded = await playTrackById(songId, { keyword, pauseAsap: true });
    if (!loaded.ok) {
      throw new Error(`歌曲 ${songId} 没能加载出来（切歌后没等到时长）。当前 ${loaded.state && loaded.state.name}`);
    }
    // 「开头那一下」有多长 = 从双击切歌到暂停真正落地之间的墙钟时间。
    // （不能读 readState().seconds：刚切歌那一刻 --track-precent 还是上一首的残留值，
    //  乘上新时长会得到毫无意义的数，比如 95.88s。只有真切了歌才有这个指标。）
    const heard = loaded.method === 'search+dblclick' && loaded.tClick && loaded.pausedAt
      ? +((loaded.pausedAt - loaded.tClick) / 1000).toFixed(2)
      : null;

    await pause();
    await sleep(250);

    let last = null;
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      await seek(seconds);
      await sleep(settleMs);
      last = await readState();
      const err = last.seconds == null ? Infinity : last.seconds - seconds;
      if (Math.abs(err) <= tolerance) {
        await resume();
        await sleep(500);
        const a = await readState();
        let final = a;
        // pauseAsap 下没验证过「真的能出声」，在这里补上：位置必须在往前走。
        // 注意 resume 偶尔要过一两秒才真正生效，所以多催几次、最多给 4 秒。
        for (let k = 0; k < 5; k++) {
          await sleep(700);
          final = await readState();
          if (a.seconds != null && final.seconds != null && final.seconds > a.seconds + 0.25) break;
          await resume().catch(() => {});
        }
        if (!(a.seconds != null && final.seconds != null && final.seconds > a.seconds + 0.25)) {
          throw new Error(`跳到 ${seconds}s 后播放位置没有走动（${a.seconds}s → ${final.seconds}s），` +
                          `这首歌可能放不了，或者客户端状态异常。`);
        }
        return {
          song: loaded.info, keyword: loaded.keyword, target: seconds,
          seeked: last.seconds, error: +err.toFixed(2), attempts: attempt,
          heard, state: final
        };
      }
    }
    await resume();
    throw new Error(`跳转到 ${seconds}s 失败：${maxTries} 次尝试后停在 ${last && last.seconds}s` +
                    `（歌曲 ${loaded.info && loaded.info.name}，时长 ${last && last.duration}s）`);
  };

  const close = () => { try { ws.close(); } catch {} };

  return { send, evaluate, readState, trackInfo, privilege, searchSongs, playTrackById, playFrom, seek, pause, resume, snapshot, restore, queueIds, close, target, port };
}
