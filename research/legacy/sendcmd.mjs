// 向已运行的网易云客户端投递 --webcmd 消息。
// 必须用 Windows 侧 node 运行（WSL 到 Windows 的 127.0.0.1 不通）。
// CLI: node sendcmd.mjs <json> [raw|b64|url|b64url]
import { spawn } from 'node:child_process';

export const EXE = 'D:\\CloudMusic\\cloudmusic.exe';

// 把 payload 编码成 --webcmd 的值
export function encode(payload, mode) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  switch (mode) {
    case 'raw': return json;
    case 'b64': return Buffer.from(json, 'utf8').toString('base64');
    case 'url': return encodeURIComponent(json);
    case 'b64url': return encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'));
    default: throw new Error('unknown mode: ' + mode);
  }
}

export function sendWebcmd(payload, mode = 'raw', { exe = EXE, quiet = false } = {}) {
  const value = encode(payload, mode);
  const arg = '--webcmd=' + value;
  const p = spawn(exe, [arg], { detached: true, stdio: 'ignore', windowsHide: true });
  p.unref();
  if (!quiet) console.log('[sendWebcmd] mode=' + mode + ' argLen=' + arg.length + ' value=' + value.slice(0, 120));
  return new Promise(res => {
    p.on('error', e => res({ ok: false, error: String(e) }));
    setTimeout(() => res({ ok: true, value }), 700);
  });
}

if (process.argv[1] && process.argv[1].endsWith('sendcmd.mjs')) {
  const json = process.argv[2] || '{"cmd":"seek","value":60}';
  const mode = process.argv[3] || 'raw';
  const r = await sendWebcmd(json, mode);
  console.log(JSON.stringify(r));
}
