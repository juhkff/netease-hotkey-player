// Awoo's loopback control API. Its public port 5556 is read-only; control is
// performed through the same local request endpoint used by Awoo's own tests.
const requestPath = '/api/test/request-song';
async function json(origin, path, { signal, method = 'GET', body, timeout = 1000 } = {}) {
  const response = await fetch(origin + path, {
    method, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    redirect: 'error', headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new Error(`嗷呜接口 ${path} 返回 HTTP ${response.status}`);
  return response.json();
}

export async function findAwoo(port = 5555, { signal } = {}) {
  if (Number(port) === 0) return null;
  if (!Number.isInteger(Number(port)) || Number(port) < 1024 || Number(port) > 65535) throw new Error('嗷呜内部接口端口无效');
  const origin = `http://127.0.0.1:${Number(port)}`;
  let config;
  try { config = await json(origin, '/api/config', { signal, timeout: 400 }); }
  catch (error) { if (signal?.aborted) throw error; return null; }
  if (!config || !/^\d+\.\d+\.\d+/.test(config.version || '') || !config.config || typeof config.playing !== 'boolean') return null;
  if (config.config.PlayerType !== 'NCM') return null;
  const api = await json(origin, requestPath, { signal });
  if (api.success !== true || api.localOnly !== true || !api.modes?.includes('play_now') ||
      api.endpoint !== origin + requestPath) throw new Error('嗷呜版本未提供兼容的本地播放接口，请升级或检查内部端口');
  if (config.playerConnected !== true && config.cdpConnected !== true) throw new Error('嗷呜尚未连通网易云，暂不直接切歌以免触发下一首守卫');
  return { port: Number(port), version: config.version };
}

export async function playWithAwoo(session, songId, { signal, requestedBy = '网易云热键工具插播' } = {}) {
  const id = String(songId);
  if (!/^\d+$/.test(id)) throw new Error('嗷呜插播仅支持网易云在线歌曲 ID');
  const origin = `http://127.0.0.1:${session.port}`;
  const config = await json(origin, '/api/config', { signal });
  if (config.config?.PlayerType !== 'NCM' || (config.playerConnected !== true && config.cdpConnected !== true))
    throw new Error('嗷呜当前未控制网易云；插播或复位已停止，中断点保留');
  const result = await json(origin, requestPath, { method: 'POST', signal, timeout: 18000,
    body: { keyword: 'id=' + id, mode: 'play_now', requestedBy } });
  if (result.success !== true || result.playbackConfirmed !== true || String(result.song?.Id) !== id)
    throw new Error('嗷呜未确认目标歌曲播放：' + (result.message || '返回的歌曲或播放状态不符') +
      (result.queued ? '（嗷呜已将此次请求保留在待播队列，请在其界面确认）' : ''));
  return result;
}
