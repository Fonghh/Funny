// Replays the 16 rally clips the user recorded in a badminton hall on 10/26 (ball candidates and players found on the real
// frames) through BallTracker + RallyJudge, with and without the players, and compares with what really happened.
// Only calls made while the clip still had real frames count (the recordings froze part way).
// Run: node pickleball-pose/tests/replay_badminton.mjs
import fs from 'fs';
const B = new Function(fs.readFileSync(new URL('../ball.js', import.meta.url), 'utf8') + '; return { BallTracker, RallyJudge };')();
const P = new Function(fs.readFileSync(new URL('../players.js', import.meta.url), 'utf8') + '; return { PlayerFinder };')();
const C = new Function(fs.readFileSync(new URL('../court.js', import.meta.url), 'utf8') + '; return { hApply, hInvert };')();
const { court, clips } = JSON.parse(fs.readFileSync(new URL('data/badminton_1026.json', import.meta.url)));
const i2m = C.hInvert(court.m2i), q = C.hApply(court.m2i, 10, 11), sign = Math.sign(C.hApply(i2m, q[0], q[1])[2]);
const toCourt = (x, y) => { const g = C.hApply(i2m, x / 640, y / 360); return g[2] * sign > 0 ? g.slice(0, 2) : null; };
function run(clip, withPlayers) {
  const tr = new B.BallTracker(1), j = new B.RallyJudge(), calls = [];
  j.frame = [640, 360];
  const last = clip.frames[clip.frames.length - 1][0];
  // after the last real frame, nothing: a rally still going ends, but a call made then is not counted
  const tail = Array.from({ length: 120 }, (_, k) => [last + (k + 1) / 30, [], [], []]);
  for (const [t, cands, ps, ready] of [...clip.frames, ...tail]) {
    const players = ps.map(([x0, y0, x1, y1, cx, cy]) => ({ box: [x0, y0, x1, y1], court: [cx, cy] }));
    const pl = withPlayers ? { players, ready: () => ready.map((k) => players[k]) } : null;
    let cs = cands.map(([x, y, a]) => ({ x, y, a }));
    if (pl) cs = P.PlayerFinder.offBodies(cs, players);
    tr.update(t, cs);
    for (const e of j.step(t, tr.main(), toCourt, pl)) if (e.type === 'end' && t <= clip.end + 0.05) calls.push(e.winner || 'ask');
  }
  return calls;
}
const score = { old: [0, 0], new: [0, 0] };
for (const c of clips) {
  const old = run(c, false), now = run(c, true);
  const mark = (calls) => {
    if (c.truth == null) return '';
    if (c.truth === 'none') return calls.length ? '✗' : '✓';
    return calls[0] === c.truth ? '✓' : calls.length ? '✗' : '–';
  };
  for (const [k, calls] of [['old', old], ['new', now]]) { const m = mark(calls); if (m === '✓') score[k][0]++; if (m === '✗') score[k][1]++; }
  console.log(`#${c.clip} truth ${String(c.truth ?? '-').padEnd(5)} old ${(old.join(',') || '-').padEnd(10)} ${mark(old).padEnd(2)} new ${(now.join(',') || '-').padEnd(10)} ${mark(now)}  ${c.label}`);
}
console.log(`right / wrong — without players ${score.old.join(' / ')}, with players ${score.new.join(' / ')}`);
