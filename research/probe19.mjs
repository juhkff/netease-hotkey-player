// 第十九轮：在页面里找 redux store —— 拿到 dispatch 就能像客户端内部一样 seek/pause，
// 彻底摆脱「按像素点进度条」的脆弱性。
import { connect, sleep } from './cdp.mjs';

const port = Number(process.argv[2] || 9229);
const c = await connect(port);
await sleep(300);

const HUNT = String.raw`(() => {
  const report = { found: null, candidates: [], windowHits: [], errors: [] };

  const isStore = v => v && typeof v === 'object'
    && typeof v.dispatch === 'function'
    && typeof v.getState === 'function'
    && typeof v.subscribe === 'function';

  // 1) window 上的相关键
  try {
    for (const k of Object.keys(window)) {
      if (/store|redux|dispatch|__REACT|devtool/i.test(k)) {
        const v = window[k];
        let desc;
        if (isStore(v)) { desc = 'STORE!'; }
        else if (v && typeof v === 'object') desc = 'obj{' + Object.keys(v).slice(0, 12).join(',') + '}';
        else desc = typeof v;
        report.windowHits.push(k + ' = ' + desc);
        if (isStore(v) && !report.found) report.found = { via: 'window.' + k };
      }
    }
  } catch (e) { report.errors.push('window: ' + e.message); }

  // 2) 遍历 React fiber 树
  const rootEl = document.getElementById('root') || document.body;
  const ck = Object.keys(rootEl).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (!ck) { report.errors.push('no fiber key on #root: ' + Object.keys(rootEl).filter(k => k.startsWith('__react')).join(',')); return report; }
  report.rootKey = ck;
  const host = rootEl[ck];
  const rootFiber = host.current || host;

  const q = [rootFiber];
  let n = 0;
  const seen = new Set();
  while (q.length && n < 80000) {
    const f = q.shift();
    if (!f || seen.has(f)) continue;
    seen.add(f); n++;

    // a) props.value 是 store
    const p = f.memoizedProps;
    if (p && typeof p === 'object') {
      if (isStore(p.value) && !report.found) report.found = { via: 'memoizedProps.value', depth: n };
      if (isStore(p.store) && !report.found) report.found = { via: 'memoizedProps.store', depth: n };
      // react-redux contextValue = { store, subscription, ... }
      if (p.value && typeof p.value === 'object' && isStore(p.value.store) && !report.found) {
        report.found = { via: 'memoizedProps.value.store', depth: n };
      }
      if (report.candidates.length < 12 && p.value && typeof p.value === 'object') {
        const ks = Object.keys(p.value).slice(0, 8).join(',');
        if (/store|dispatch|subscription/i.test(ks)) report.candidates.push('props.value{' + ks + '}');
      }
    }

    // b) fiber.type._context._currentValue 是 store
    try {
      const ctx = f.type && f.type._context;
      if (ctx && isStore(ctx._currentValue) && !report.found) report.found = { via: 'type._context._currentValue' };
      if (ctx && ctx._currentValue && typeof ctx._currentValue === 'object' && isStore(ctx._currentValue.store) && !report.found) {
        report.found = { via: 'type._context._currentValue.store' };
      }
      if (ctx && ctx._currentValue && typeof ctx._currentValue === 'object' && (ctx._currentValue.store || ctx._currentValue.dispatch)) {
        if (report.candidates.length < 12) report.candidates.push('ctx.currentValue{' + Object.keys(ctx._currentValue).slice(0, 8).join(',') + '}');
      }
    } catch (e) {}

    if (f.child) q.push(f.child);
    if (f.sibling) q.push(f.sibling);
  }
  report.fibersVisited = n;
  return report;
})()`;

const r = await c.evaluate(HUNT);
console.log(JSON.stringify(r, null, 1));

c.close();
