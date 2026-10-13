import { connect } from '../lib/ncm.mjs';
const c = await connect(Number(process.argv[2] || 9229));
const q = await c.queueIds();
const list = await c.searchSongs(String(process.argv[3] || '起风了'), 12, 0);
for (const t of list) {
  const p = await c.privilege(t.id).catch(() => null);
  console.log([String(t.id), (p && p.st), (p && p.plLevel), (q.indexOf(String(t.id)) >= 0 ? 'IN-QUEUE' : 'new'), t.name, t.artists].join('  |  '));
}
c.close(); process.exit(0);
