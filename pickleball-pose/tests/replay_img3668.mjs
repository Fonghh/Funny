// Replays the ball candidates recorded from a real video (IMG_3668, filmed low through a fence) through BallTracker +
// RallyJudge and prints each decision next to what really happened (labelled by the user). Run: node pickleball-pose/tests/replay_img3668.mjs
import fs from 'fs';
const B = new Function(fs.readFileSync(new URL('../ball.js', import.meta.url), 'utf8') + '; return { BallTracker, RallyJudge };')();
const C = new Function(fs.readFileSync(new URL('../court.js', import.meta.url), 'utf8') + '; return { hApply, hInvert };')();
const { m2i, frames, truth } = JSON.parse(fs.readFileSync(new URL('data/img3668.json', import.meta.url)));
const i2m = C.hInvert(m2i), q = C.hApply(m2i, 10, 11), sign = Math.sign(C.hApply(i2m, q[0], q[1])[2]);
const toCourt = (x, y) => { const g = C.hApply(i2m, x / 640, y / 360); return g[2] * sign > 0 ? g.slice(0, 2) : null; };
const tr = new B.BallTracker(1), j = new B.RallyJudge();
// what really happened during the judged stretch: the labelled stretch it overlaps most
const what = (s, e) => { let best = '-', bo = 0; for (const [a, b, w] of truth) { const o = Math.min(b, e) - Math.max(a, s); if (o > bo) { bo = o; best = w; } } return best; };
let start = 0;
for (const [t, c] of frames) {
  tr.update(t, c.map(([x, y, a]) => ({ x, y, a })));
  for (const e of j.step(t, tr.main(), toCourt)) {
    if (e.type === 'start') start = e.t;
    if (e.type === 'end' || e.type === 'cancel') console.log(`${start.toFixed(1).padStart(5)}–${t.toFixed(1).padEnd(5)} judged: ${(e.type === 'cancel' ? 'not counted' : e.winner || 'ask').padEnd(11)} truth: ${what(start, t)}`);
  }
}
console.log('truth:', truth.map(([a, b, w]) => `${a}–${b} ${w}`).join(' | '));
