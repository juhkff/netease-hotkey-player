// 第二十一轮：验证 webcmd 是否要用 {"message":{...}} 包封。
// 若成立 -> 热键只需 spawn 一次 cloudmusic.exe 带参数，无需调试端口、无需 UI 自动化。
import { connect, sleep } from './cdp.mjs';
import { sendWebcmd } from './legacy/sendcmd.mjs';

const port = Number(process.argv[2] || 9229);
const c = await connect(port);

const inner = { cmd: 'pause' };
const variants = [
  { name: 'nested-raw ', mode: 'raw', payload: { message: inner } },
  { name: 'nested-b64 ', mode: 'b64', payload: { message: inner } },
  { name: 'nested-url ', mode: 'url', payload: { message: inner } },
  { name: 'flat+channel', mode: 'raw', payload: { cmd: 'pause', channel: 'webset' } },
  { name: 'nested+channel', mode: 'raw', payload: { message: { cmd: 'pause', channel: 'webset' } } },
];

for (const v of variants) {
  await c.setPlaying(true);
  await sleep(600);
  const before = await c.readState();
  console.log('\n===== ' + v.name + '  payload=' + JSON.stringify(v.payload));
  if (before.playing !== true) { console.log('  跳过：当前不是播放态 (' + before.playing + ')'); continue; }
  await sendWebcmd(v.payload, v.mode, { quiet: true });
  await sleep(1800);
  const after = await c.readState();
  const hit = after.playing === false;
  console.log('  playing: ' + before.playing + ' -> ' + after.playing + '   ' + (hit ? '✅ 命令收到！' : '❌ 无反应'));
  if (hit) {
    console.log('  >>> 有效: mode=' + v.mode + ' payload=' + JSON.stringify(v.payload));
    break;
  }
}
c.close();
