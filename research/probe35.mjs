// 第三十五轮：翻页确认目标 id 在搜索结果里到底存不存在（用官方搜索接口，快且准）。
import { connect } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));
const WANT = String(process.argv[3] || '186016');

for (const kw of ['晴天 周杰伦', '晴天', '周杰伦 晴天', '晴天 专辑 叶惠美']) {
  let found = false;
  for (const offset of [0, 30, 60, 90, 120, 150, 180, 210]) {
    const r = await c.evaluate(`(async () => {
      const r = await fetch('https://music.163.com/api/search/get/web?csrf_token=&s=' + encodeURIComponent(${JSON.stringify(kw)}) + '&type=1&offset=${offset}&limit=30', { credentials: 'include' });
      const j = await r.json();
      const s = (j.result && j.result.songs) || [];
      return JSON.stringify({ n: s.length, hit: s.some(x => String(x.id) === ${JSON.stringify(WANT)}),
        jay: s.filter(x => (x.artists || []).some(a => a.name === '周杰伦')).map(x => x.id + '|' + x.name) });
    })()`);
    const j = JSON.parse(r || '{}');
    console.log(`  kw="${kw}" offset=${offset} n=${j.n} 命中=${j.hit ? '★ 是' : '否'} 周杰伦的=${JSON.stringify(j.jay)}`);
    if (j.hit) { found = true; break; }
    if (!j.n) break;
  }
  if (found) break;
}
c.close();
