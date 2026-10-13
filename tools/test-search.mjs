// 验证 worker 的 search 命令（界面里「搜歌」按钮走的就是它）。
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

const APP = path.join(process.env.LOCALAPPDATA, 'ncm-hotkey');
const p = spawn('node', ['worker.mjs'], { cwd: APP, stdio: ['pipe', 'pipe', 'pipe'] });
createInterface({ input: p.stdout }).on('line', l => console.log('  OUT ' + l));
createInterface({ input: p.stderr }).on('line', l => console.log('  ERR ' + l));
const send = o => p.stdin.write(JSON.stringify(o) + '\n');

setTimeout(() => { console.log('-> search "晴天 周杰伦 叶惠美"'); send({ id: 1, cmd: 'search', keyword: '晴天 周杰伦 叶惠美', limit: 5 }); }, 400);
setTimeout(() => { console.log('-> search "起风了"'); send({ id: 2, cmd: 'search', keyword: '起风了', limit: 5 }); }, 3000);
setTimeout(() => { p.kill(); process.exit(0); }, 7000);
