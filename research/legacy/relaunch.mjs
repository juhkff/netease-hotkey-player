// 启动/重启网易云客户端（Windows 侧 node 运行，参数传递不会有 PowerShell 的引号问题）。
import { execFileSync, spawn } from 'node:child_process';

export const EXE = 'D:\\CloudMusic\\cloudmusic.exe';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function killClient() {
  try { execFileSync('taskkill', ['/F', '/IM', 'cloudmusic.exe'], { stdio: 'ignore' }); return true; }
  catch { try { execFileSync('taskkill', ['/F', '/IM', 'cloudmusic.exe'], { stdio: 'ignore' }); } catch {} return false; }
}

export function launchClient({ port = 9229, webcmd = null, extra = [] } = {}) {
  const args = [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', ...extra];
  if (webcmd != null) args.push('--webcmd=' + webcmd);
  const p = spawn(EXE, args, { detached: true, stdio: 'ignore', windowsHide: true });
  p.unref();
  return args;
}
