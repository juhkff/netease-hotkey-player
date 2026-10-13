#!/usr/bin/env node
/**
 * 命令行入口：播放指定歌曲 + 从指定秒数开始。
 *
 * 用法一（直接给参数）：
 *   node play.mjs <songId> [开始秒数] [--keyword "歌名 歌手"] [--port 9229]
 *
 * 用法二（按配置文件里的某个热键绑定执行）：
 *   node play.mjs --config config.json --key Ctrl+Alt+1
 *
 * 用法三（只看状态，不做任何操作）：
 *   node play.mjs --status
 */
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, isReady, sleep } from '../lib/ncm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(HERE, 'logs');
const LOG_FILE = join(LOG_DIR, 'play.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { mkdirSync(LOG_DIR, { recursive: true }); appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ── 解析参数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--keyword') opt.keyword = argv[++i];
  else if (a === '--port') opt.port = Number(argv[++i]);
  else if (a === '--config') opt.config = argv[++i];
  else if (a === '--key') opt.key = argv[++i];
  else if (a === '--list') opt.list = true;
  else if (a === '--status') opt.status = true;
  else pos.push(a);
}

// ── 列出配置里的绑定 ────────────────────────────────────────────────────────
if (opt.list) {
  if (!opt.config) { console.error('--list 需要配合 --config'); process.exit(2); }
  const cfg = JSON.parse(readFileSync(opt.config, 'utf8'));
  for (const h of cfg.hotkeys || []) {
    const sec = Number(h.start || 0);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0'), ss = String(sec % 60).padStart(2, '0');
    console.log(`${String(h.key).padEnd(14)} → ${h.label || h.songId}  (id=${h.songId} 从 ${mm}:${ss} 开始)`);
  }
  process.exit(0);
}

// ── 组装任务 ────────────────────────────────────────────────────────────────
let task = null;
if (opt.config) {
  const cfg = JSON.parse(readFileSync(opt.config, 'utf8'));
  const list = cfg.hotkeys || [];
  const entry = opt.key != null ? list.find(h => String(h.key) === String(opt.key)) : list[0];
  if (!entry) { console.error(`config 里找不到绑定的热键 ${opt.key}`); process.exit(2); }
  task = { songId: entry.songId, start: Number(entry.start || 0), keyword: entry.keyword, label: entry.label };
  if (!opt.port) opt.port = Number(cfg.port || 9229);
} else if (pos.length) {
  task = { songId: pos[0], start: Number(pos[1] || 0), keyword: opt.keyword, label: null };
}

const port = opt.port || 9229;

// ── 只看状态 ────────────────────────────────────────────────────────────────
if (opt.status || !task) {
  if (!(await isReady(port))) {
    console.error(`网易云没有以可控制方式运行（127.0.0.1:${port} 无响应）。`);
    console.error('请用「启动网易云(可控制).cmd」启动客户端。');
    process.exit(3);
  }
  const c = await connect(port);
  const s = await c.readState();
  console.log(JSON.stringify(s, null, 2));
  c.close();
  process.exit(0);
}

// ── 执行 ────────────────────────────────────────────────────────────────────
const mmss = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const title = task.label || `${task.songId} @ ${mmss(task.start)}`;

if (!(await isReady(port))) {
  log(`✘ ${title} —— 网易云没有以可控制方式运行（127.0.0.1:${port} 无响应）`);
  console.error('请用「启动网易云(可控制).cmd」启动客户端。');
  process.exit(3);
}

try {
  const c = await connect(port);
  const t0 = Date.now();
  const r = await c.playFrom(task.songId, task.start, { keyword: task.keyword });
  c.close();
  log(`✔ ${title} —— 已从 ${r.seeked}s 开始播放《${r.song.name}》` +
      `${r.song.artists ? ' / ' + r.song.artists : ''}` +
      `（目标 ${r.target}s，误差 ${r.error}s，${r.attempts} 次跳转，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  process.exit(0);
} catch (e) {
  log(`✘ ${title} —— ${e.message}`);
  process.exit(1);
}
