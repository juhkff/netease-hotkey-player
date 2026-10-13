// 端到端测「界面程序会走的那条路」：直接跟 worker.mjs 说话，
// 依次发 status → play(片段) → status → restore → status，看中断点有没有被正确记下和复位。
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const clipId = String(process.argv[2] || '35447132');
const clipSec = Number(process.argv[3] || 42);

let nodeExe = process.execPath;
try {
  const t = readFileSync(resolve(root, 'node.txt'), 'utf8').trim();
  if (t && t.length > 3) nodeExe = t;
} catch {}

const proc = spawn(nodeExe, [resolve(root, 'worker.mjs'), '9229'], { stdio: ['pipe', 'pipe', 'pipe'] });
const rl = createInterface({ input: proc.stdout });
const pending = new Map();
let nextId = 1;
rl.on('line', line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const cb = pending.get(msg.id);
  if (cb) { pending.delete(msg.id); cb(msg); }
});
proc.stderr.on('data', d => process.stderr.write('[worker] ' + d));

function send(obj) {
  const id = nextId++;
  return new Promise(res => {
    pending.set(id, res);
    proc.stdin.write(JSON.stringify(Object.assign({ id }, obj)) + '\n');
  });
}

const show = (tag, r) => console.log(tag.padEnd(9) + JSON.stringify(r));

show('STATUS', await send({ cmd: 'status', port: 9229 }));
show('PLAY', await send({ cmd: 'play', songId: clipId, seconds: clipSec, port: 9229 }));
show('STATUS', await send({ cmd: 'status', port: 9229 }));
show('RESTORE', await send({ cmd: 'restore', port: 9229 }));
show('STATUS', await send({ cmd: 'status', port: 9229 }));

proc.stdin.end();
setTimeout(() => process.exit(0), 300);
