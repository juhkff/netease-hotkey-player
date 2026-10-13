// 常驻播放工作进程。
// 界面程序（NcmHotkey.exe）启动它一次，然后通过 stdin 一行一条 JSON 下命令，
// 结果同样以一行 JSON 从 stdout 返回。所有日志一律走 stderr，不能污染协议。
//
// 命令：
//   {"id":1,"cmd":"ping"}
//   {"id":2,"cmd":"info","songId":"1330348068"}
//   {"id":3,"cmd":"status"}
//   {"id":4,"cmd":"play","songId":"1330348068","seconds":15,"keyword":null}
import { createInterface } from 'node:readline';
import { connect, isReady } from './lib/ncm.mjs';

const portArg = Number(process.argv[2] || 9229);
let conn = null;
let chain = Promise.resolve();
// 「中断点」：播放片段之前记下的现场，按复位键时用来回到原来那首歌的那个位置。
let saved = null;

const out = obj => process.stdout.write(JSON.stringify(obj) + '\n');
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

async function getConn(port) {
  if (conn) return conn;
  if (!(await isReady(port))) {
    throw new Error(`连不上网易云的调试端口 ${port}。请先退出网易云，再用桌面上的「网易云音乐(带热键)」打开。`);
  }
  conn = await connect(port);
  return conn;
}

function dropConn() {
  if (conn) { try { conn.close(); } catch {} conn = null; }
}

async function handle(cmd) {
  const port = Number(cmd.port || portArg);
  switch (cmd.cmd) {
    case 'ping':
      return { ok: true, ready: await isReady(port) };

    case 'info': {
      const c = await getConn(port);
      const t = await c.trackInfo(String(cmd.songId));
      return { ok: true, name: t.name, artists: t.artists, album: t.album, duration: t.duration, keyword: t.keyword };
    }

    case 'status': {
      const c = await getConn(port);
      const s = await c.readState();
      return { ok: true, name: s.name, playing: s.playing, seconds: s.seconds, duration: s.duration,
               suspended: !!saved, savedName: saved ? saved.name : null, savedAt: saved ? saved.seconds : null };
    }

    case 'search': {
      const kw = String(cmd.keyword || '').trim();
      if (!kw) throw new Error('搜索关键词是空的');
      const c = await getConn(port);
      const list = await c.searchSongs(kw, Number(cmd.limit || 30), Number(cmd.offset || 0));
      return { ok: true, list };
    }

    case 'play': {
      const c = await getConn(port);
      // 播放片段之前先记下「中断点」：谁在放、放到哪、待播放队列长什么样。
      // 已经有中断点就不覆盖 —— 连按两个片段键时，要复位的是最原始那个现场。
      if (!saved) {
        try {
          const s = await c.snapshot();
          if (s && s.songId) {
            saved = s;
            log(`记下中断点：${s.name || s.songId} @ ${s.seconds}s，队列 ${s.queue.length} 首`);
          }
        } catch (e) { log('记中断点失败：' + e.message); }
      }
      const secs = cmd.seconds == null || cmd.seconds === '' ? null : Number(cmd.seconds);
      if (secs == null || isNaN(secs)) {
        const r = await c.playTrackById(String(cmd.songId), { keyword: cmd.keyword || undefined });
        if (!r.ok) throw new Error(`《${(r.info && r.info.name) || cmd.songId}》没能开始播放（可能当前账号放不了这首歌）`);
        return { ok: true, name: r.info.name, artists: r.info.artists, fromStart: true,
                 savedName: saved ? saved.name : null };
      }
      const r = await c.playFrom(String(cmd.songId), secs, { keyword: cmd.keyword || undefined });
      return {
        ok: true, name: r.song.name, artists: r.song.artists,
        seeked: r.seeked, error: r.error, attempts: r.attempts, heard: r.heard,
        savedName: saved ? saved.name : null
      };
    }

    case 'restore': {
      const c = await getConn(port);
      if (!saved) return { ok: true, nothing: true };
      const s = saved;
      const r = await c.restore(s);
      saved = null;
      log(`复位：回到 ${r.song} @ ${r.seeked}s（退 ${r.steps} 步，队列清理=${r.cleaned}）`);
      return {
        ok: true, name: r.song, target: r.target, seeked: r.seeked, error: r.error,
        steps: r.steps, cleaned: r.cleaned, wasPlaying: r.wasPlaying
      };
    }

    default:
      throw new Error('不认识的命令：' + cmd.cmd);
  }
}

createInterface({ input: process.stdin }).on('line', line => {
  const text = line.trim();
  if (!text) return;
  let cmd;
  try { cmd = JSON.parse(text); } catch { out({ ok: false, id: null, error: '命令不是合法 JSON' }); return; }
  const id = cmd.id === undefined ? null : cmd.id;
  // 串行执行：播放命令本来就得排队，避免两条命令同时抢进度条
  chain = chain.then(async () => {
    try {
      out(Object.assign({ id }, await handle(cmd)));
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/closed|timedOut|WebSocket|调试端口/.test(msg)) dropConn();
      out({ ok: false, id, error: msg });
    }
  });
});

process.stdin.on('end', () => process.exit(0));
log('worker ready, port=' + portArg);
