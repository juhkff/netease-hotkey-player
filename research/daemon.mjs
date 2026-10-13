// 热键守护进程：跑在 Windows 侧 node.exe 上。
//   powershell.exe -NoProfile -Command "node '\\wsl.localhost\<发行版>\home\ubuntu\projects\ncm-seek\daemon.mjs'"
// 它做两件事：
//   1. 起一个 PowerShell 子进程注册全局热键（见 tools/hotkey.ps1）；
//   2. 收到 "FIRE <编号>" 就通过 CDP 让网易云播对应歌曲并跳到指定秒。
//
// 参数：
//   --config <路径>   配置文件，默认同目录 config.json
//   --once <编号>     不用真的按键，直接触发一次该编号的动作（自测用）
//   --list            只打印配置里的热键表
//   --no-hotkey       不注册热键，只常驻（调试用）
import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { connect, isReady } from '../lib/ncm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def;
};

const configPath = String(opt('config', join(HERE, 'config.json')));
const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
const port = Number(cfg.port || 9229);
const entries = (cfg.hotkeys || []).map((e, i) => ({ ...e, index: i + 1 }));

// ---------- 日志 ----------
const logDir = join(HERE, 'logs');
try { mkdirSync(logDir, { recursive: true }); } catch {}
const logFile = join(logDir, 'daemon.log');
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  try { appendFileSync(logFile, line + '\n'); } catch {}
};

// ---------- 热键字符串 → (修饰键掩码, 虚拟键码) ----------
const MOD = { alt: 1, ctrl: 2, control: 2, shift: 4, win: 8, meta: 8, super: 8 };
function parseHotkey(str) {
  let mods = 0, vk = 0;
  for (const raw of String(str).split('+')) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    if (MOD[p] !== undefined) { mods |= MOD[p]; continue; }
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(p)) { vk = 0x70 + (Number(p.slice(1)) - 1); continue; }
    if (/^[0-9]$/.test(p)) { vk = 0x30 + Number(p); continue; }
    if (/^[a-z]$/.test(p)) { vk = p.toUpperCase().charCodeAt(0); continue; }
    const named = {
      space: 0x20, enter: 0x0d, return: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b,
      backspace: 0x08, delete: 0x2e, insert: 0x2d, home: 0x24, end: 0x23,
      pageup: 0x21, pagedown: 0x22, up: 0x26, down: 0x28, left: 0x25, right: 0x27,
      '`': 0xc0, '-': 0xbd, '=': 0xbb, '[': 0xdb, ']': 0xdd, '\\': 0xdc,
      ';': 0xba, "'": 0xde, ',': 0xbc, '.': 0xbe, '/': 0xbf
    };
    if (named[p] !== undefined) { vk = named[p]; continue; }
    throw new Error(`看不懂的热键写法：「${raw}」（在 ${str} 里）`);
  }
  if (!vk) throw new Error(`热键「${str}」里没有主键（例如 Ctrl+Alt+1）`);
  return { mods, vk };
}

if (opt('list', false) === true) {
  for (const e of entries) {
    const { mods, vk } = parseHotkey(e.hotkey);
    console.log(`  ${e.index}. ${e.hotkey}  →  歌曲 ${e.songId} 从 ${e.seconds}s 开始  (mods=${mods} vk=0x${vk.toString(16)})`);
  }
  process.exit(0);
}

// ---------- CDP 连接（复用，别每次都重连） ----------
let conn = null;
async function getConn() {
  if (conn) return conn;
  if (!(await isReady(port))) {
    throw new Error(`连不上网易云的调试端口 ${port}。请先退出网易云，再用「网易云(带热键)」快捷方式打开。`);
  }
  conn = await connect(port);
  return conn;
}

let busy = false;
async function fire(index) {
  const e = entries.find(x => x.index === Number(index));
  if (!e) { log(`收到未知热键编号 ${index}，忽略`); return; }
  if (busy) { log(`上一次还没做完，忽略这次「${e.hotkey}」`); return; }
  busy = true;
  const t0 = Date.now();
  try {
    const c = await getConn();
    const r = await c.playFrom(e.songId, Number(e.seconds), { keyword: e.keyword });
    log(`✔ ${e.hotkey} —— 已从 ${r.seeked}s 开始播放《${r.song.name}》 / ${r.song.artists}` +
        `（目标 ${r.target}s，误差 ${r.error}s，${r.attempts} 次跳转，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  } catch (err) {
    log(`✘ ${e.hotkey} —— ${err.message}`);
    // 连接坏了就丢掉，下次重连
    if (conn && /closed|timedOut|WebSocket|调试端口/.test(String(err.message))) { try { conn.close(); } catch {} conn = null; }
  } finally {
    busy = false;
  }
}

// ---------- 自测：不按键直接触发 ----------
const once = opt('once', null);
if (once !== null) {
  await fire(once);
  if (conn) conn.close();
  process.exit(0);
}

// ---------- 主流程：注册热键 + 常驻 ----------
if (opt('no-hotkey', false) !== true) {
  // 先探一下网易云在不在调试模式，方便排查（不在也不拦住注册，按的时候会再试）
  if (await isReady(port)) {
    log(`网易云调试端口 ${port} 正常。`);
  } else {
    log(`⚠ 现在连不上 127.0.0.1:${port} —— 网易云要么没开，要么不是用「网易云音乐(带热键)」快捷方式打开的。`);
  }

  const spec = entries.map(e => {
    const { mods, vk } = parseHotkey(e.hotkey);
    return `${e.index}:${mods}:${vk}`;
  }).join(';');
  log(`注册热键：${entries.map(e => e.hotkey).join('、')}`);
  const ps = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(HERE, 'tools', 'hotkey.ps1'), '-Bindings', spec],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let buf = '';
  let conflict = 0;
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '').trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      if (line.startsWith('FIRE ')) { fire(line.slice(5).trim()); continue; }
      if (line.startsWith('OK ')) { log(`  热键 ${line.slice(3)} 注册成功`); continue; }
      if (line.startsWith('FAIL ')) {
        const parts = line.split(/\s+/);
        if (parts[2] === '1409') conflict++;
        log(`  ⚠ 热键 ${parts[1]} 注册失败（错误码 ${parts[2]}${parts[2] === '1409' ? ' = 已被占用' : ''}）`);
        continue;
      }
      if (line.startsWith('READY ')) {
        const n = Number(line.slice(6));
        if (n === 0 && entries.length > 0) {
          log(conflict > 0
            ? '所有热键都被占用了 —— 说明已经有一个守护在跑（同时只能跑一个）。这次直接退出。'
            : '一个热键都没注册成功，退出。');
          try { ps.kill(); } catch {}
          process.exit(1);
        }
        log(`就绪，共 ${n} 个热键。按 Ctrl+C 退出。`);
        continue;
      }
      log('  powershell: ' + line);
    }
  });
  ps.stderr.setEncoding('utf8');
  ps.stderr.on('data', d => log('  powershell错误: ' + String(d).trim()));
  ps.on('exit', code => log(`热键子进程退出（code=${code}）`));

  process.on('SIGINT', () => { try { ps.kill(); } catch {}; if (conn) conn.close(); process.exit(0); });
}
