// Read-only connection probe: never starts or changes music playback.
import { connect, isReady } from '../lib/ncm.mjs';
const port = Number(process.argv[2] || 9229);
const deadline = setTimeout(() => { console.error('Client probe timed out'); process.exit(1); }, 20000);
let connection;
try {
  if (!(await isReady(port))) throw new Error(`Client debug port ${port} is not ready`);
  connection = await connect(port);
  const state = await connection.readState();
  console.log(JSON.stringify({ ok: true, port, name: state.name, playing: state.playing,
    seconds: state.seconds, duration: state.duration }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (connection) connection.close();
  clearTimeout(deadline);
}
