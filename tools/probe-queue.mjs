import { connect } from '../lib/ncm.mjs';
const c = await connect(Number(process.argv[2] || 9229));
const out = await c.evaluate(String.raw`(() => {
  const S = window.__ncm.ensureStore();
  const st = S.getState();
  const pl = st.playingList.curPlayingList || [];
  const f = pl[0] || {};
  return JSON.stringify({
    len: pl.length,
    itemKeys: Object.keys(f),
    trackKeys: f.track ? Object.keys(f.track).slice(0, 45) : null,
    sample: { resourceId: f.resourceId, resourceType: f.resourceType, trackId: f.track && f.track.id,
              name: f.track && f.track.name, artist: f.track && f.track.artists && f.track.artists[0] && f.track.artists[0].name },
    ids: pl.map(x => String((x && x.resourceId) || (x && x.track && x.track.id))),
    cur: { playId: st.playing.playId, playingMode: st.playing.playingMode,
           playingState: st.playing.playingState, resourceTrackId: st.playing.resourceTrackId,
           onlineResourceId: st.playing.onlineResourceId, resourceDuration: st.playing.resourceDuration,
           isPurePlayingList: st.playingList.isPurePlayingList }
  });
})()`);
console.log(out);
c.close(); process.exit(0);
