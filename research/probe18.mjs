// 第十八轮：实测 --webcmd 的编码格式到底哪种能被客户端接受。
// 用 seek 命令做探针（位置会跳，观测最直接）。
import { connect, sleep } from './cdp.mjs';
import { sendWebcmd, encode } from './legacy/sendcmd.mjs';

const port = Number(process.argv[2] || 9229);
const target = Number(process.argv[3] || 70);
const c = await connect(port);

const modes = ['raw', 'b64', 'url', 'b64url'];
const payload = { cmd: 'seek', value: target };

console.log('目标位置: ' + target + 's  payload=' + JSON.stringify(payload));

for (const mode of modes) {
  const before = await c.readState();
  console.log('\n===== mode=' + mode + ' =====');
  console.log('发送前: sec=' + before.seconds + ' song=' + before.name + ' playing=' + before.playing);

  await sendWebcmd(payload, mode, { quiet: true });
  await sleep(1800);

  const after = await c.readState();
  const jumped = Math.abs(after.seconds - target) < 6;
  console.log('发送后: sec=' + after.seconds + ' playing=' + after.playing + '  -> ' + (jumped ? '✅ 跳转成功！' : '❌ 无反应'));
  if (jumped) {
    console.log('\n>>> 正确编码是: ' + mode);
    console.log('>>> seek 的 webcmd 值示例: ' + encode({ cmd: 'seek', value: 42 }, mode));
    break;
  }
}

c.close();
