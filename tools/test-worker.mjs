// 直接驱动部署好的 worker.mjs，验证「界面程序 → 播放服务」这条协议是通的。
// 用法（Windows 侧 node）：node test-worker.mjs
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

const APP = path.join(process.env.LOCALAPPDATA, 'ncm-hotkey');
const p = spawn('node', ['worker.mjs'], { cwd: APP, stdio: ['pipe', 'pipe', 'pipe'] });

createInterface({ input: p.stdout }).on('line', l => console.log('  OUT ' + l));
createInterface({ input: p.stderr }).on('line', l => console.log('  ERR ' + l));

const send = o => p.stdin.write(JSON.stringify(o) + '\n');

setTimeout(() => { console.log('-> ping'); send({ id: 1, cmd: 'ping' }); }, 300);
setTimeout(() => { console.log('-> info 1330348068'); send({ id: 2, cmd: 'info', songId: '1330348068' }); }, 1500);
setTimeout(() => { console.log('-> play 35447132 @90s'); send({ id: 3, cmd: 'play', songId: '35447132', seconds: 90 }); }, 3500);
setTimeout(() => { console.log('-> status'); send({ id: 4, cmd: 'status' }); }, 12000);
setTimeout(() => { console.log('-> 结束'); p.kill(); process.exit(0); }, 16000);
