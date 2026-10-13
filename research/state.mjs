// CLI: 打印当前播放状态。用法: node state.mjs [port]
import { connect } from './cdp.mjs';

const port = Number(process.argv[2] || 9229);
try {
  const c = await connect(port);
  const st = await c.readState();
  console.log(JSON.stringify(st, null, 1));
  c.close();
} catch (e) {
  console.error('错误:', e.message);
  process.exit(1);
}
