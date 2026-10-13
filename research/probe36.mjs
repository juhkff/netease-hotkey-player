// 第三十六轮：找一种能把目标 id 顶到搜索结果最前面的关键词写法。
import { connect } from '../lib/ncm.mjs';

const c = await connect(Number(process.argv[2] || 9229));
const WANT = String(process.argv[3] || '186016');
const KWS = process.argv.slice(4).length ? process.argv.slice(4)
  : ['晴天 叶惠美', '叶惠美', '晴天 周杰伦 叶惠美', '晴天 周杰伦', '晴天'];

for (const kw of KWS) {
  let at = -1, total = 0;
  for (const offset of [0, 30, 60, 90, 120, 150]) {
    const r = await c.evaluate(`(async () => {
      const r = await fetch('https://music.163.com/api/search/get/web?csrf_token=&s=' + encodeURIComponent(${JSON.stringify(kw)}) + '&type=1&offset=${offset}&limit=30', { credentials: 'include' });
      const j = await r.json();
      const s = (j.result && j.result.songs) || [];
      return JSON.stringify({ n: s.length, total: j.result && j.result.songCount,
        idx: s.findIndex(x => String(x.id) === ${JSON.stringify(WANT)}) });
    })()`);
    const j = JSON.parse(r || '{}');
    total = j.total;
    if (j.idx >= 0) { at = offset + j.idx; break; }
    if (!j.n) break;
  }
  console.log(`  kw="${kw}"  →  id ${WANT} 出现在第 ${at >= 0 ? at : '—'} 条  (total=${total})`);
}
c.close();
