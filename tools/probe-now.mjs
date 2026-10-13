import { connect } from '../lib/ncm.mjs';
const c = await connect(Number(process.argv[2] || 9229));
const id = process.argv[3];
if (id) console.log('privilege: ' + JSON.stringify(await c.privilege(id).catch(e => ({ err: e.message }))));
for (let i = 0; i < 4; i++) {
  const s = await c.readState();
  console.log(`t+${i}s  ${s.songId}  ${s.name}  state=${s.playingState}  ${s.seconds}s / ${s.duration}s  pct=${s.percentStr}`);
  await new Promise(r => setTimeout(r, 1000));
}
c.close(); process.exit(0);
