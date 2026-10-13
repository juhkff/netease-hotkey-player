// 第二十三轮辅助：只打印当前播放状态，用于快速验收 webcmd/orpheus 命令是否生效。
import { connect } from './cdp.mjs';

const c = await connect(Number(process.argv[2] || 9229));
const s = await c.readState();
console.log('  songId=' + s.songId + '  name=' + s.name + '  artist=' + s.artist +
            '  playing=' + s.playing + '  sec=' + s.seconds + '  dur=' + s.duration);
c.close();
