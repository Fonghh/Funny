// Replays ball candidates recorded from two YouTube broadcast clips (high camera behind the baseline, court found
// automatically) and compares the judged winner with what really happened. Run: node pickleball-pose/tests/replay_broadcast.mjs
import fs from 'fs';
const B = new Function(fs.readFileSync(new URL('../ball.js', import.meta.url), 'utf8') + '; return { BallTracker, RallyJudge };')();
const C = new Function(fs.readFileSync(new URL('../court.js', import.meta.url), 'utf8') + '; return { hApply, hInvert };')();
for (const key of ['a', 'b']) {
  const { video, height, m2i, frames, truth } = JSON.parse(fs.readFileSync(new URL(`data/broadcast_${key}.json`, import.meta.url)));
  const i2m = C.hInvert(m2i), q = C.hApply(m2i, 10, 11), sign = Math.sign(C.hApply(i2m, q[0], q[1])[2]);
  const toCourt = (x, y) => { const g = C.hApply(i2m, x / 640, y / height); return g[2] * sign > 0 ? g.slice(0, 2) : null; };
  const tr = new B.BallTracker(1), j = new B.RallyJudge(), judged = [];
  // the clips stop right after the point: a few seconds of no ball let the rally end
  const tail = Array.from({ length: 120 }, (_, k) => [frames[frames.length - 1][0] + (k + 1) / 30, []]);
  for (const [t, c] of [...frames, ...tail]) {
    tr.update(t, c.map(([x, y, a]) => ({ x, y, a })));
    for (const e of j.step(t, tr.main(), toCourt)) if (e.type === 'end') judged.push(`${e.winner || 'ask'}（${e.reason}）`);
  }
  console.log(`${video}\n  judged: ${judged.join(' / ') || 'nothing'}   truth: ${truth}`);
}
