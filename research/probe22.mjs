// 第二十二轮：冷启动时直接带 --webcmd，判断「编码错误」还是「实例转发不工作」。
// 用法: node probe22.mjs <port> <mode>   mode: raw|b64|url|nested-raw|nested-b64
import { connect, listTargets, sleep } from './cdp.mjs';
import { killClient, launchClient } from './legacy/relaunch.mjs';

const port = Number(process.argv[2] || 9229);
const mode = process.argv[3] || 'raw';
const SONG = 186016; // 周杰伦 - 晴天

const inner = { cmd: 'play', type: 'song', id: SONG };
let payload, enc;
switch (mode) {
  case 'raw':      payload = JSON.stringify(inner); enc = 'raw'; break;
  case 'b64':      payload = Buffer.from(JSON.stringify(inner), 'utf8').toString('base64'); enc = 'raw'; break;
  case 'url':      payload = encodeURIComponent(JSON.stringify(inner)); enc = 'raw'; break;
  case 'nested-raw': payload = JSON.stringify({ message: inner }); enc = 'raw'; break;
  case 'nested-b64': payload = Buffer.from(JSON.stringify({ message: inner }), 'utf8').toString('base64'); enc = 'raw'; break;
  default: throw new Error('bad mode');
}

console.log('mode=' + mode + '\nwebcmd=' + payload.slice(0, 160));

console.log('\n[1] 关闭客户端');
killClient();
await sleep(3500);

console.log('[2] 冷启动（带调试端口 + webcmd）');
console.log('    args=' + JSON.stringify(launchClient({ port, webcmd: payload })));

console.log('[3] 等待调试端口…');
let ok = false;
for (let i = 0; i < 30; i++) {
  await sleep(2000);
  try { const t = await listTargets(port, 3000); if (t.some(x => x.type === 'page')) { ok = true; console.log('    端口就绪（' + ((i + 1) * 2) + 's）'); break; } } catch {}
}
if (!ok) { console.log('    ❌ 端口没起来'); process.exit(1); }

console.log('[4] 再等 8 秒让 app 消化启动命令');
await sleep(8000);

const c = await connect(port);
const st = await c.readState();
console.log('\n结果: songId=' + st.songId + ' name=' + st.name + ' playing=' + st.playing);
console.log(String(st.songId) === String(SONG)
  ? '✅ webcmd 生效！目标歌曲已在播放 —— 无需调试端口也能控制'
  : '❌ webcmd 未生效（当前不是目标歌曲）');

c.close();
