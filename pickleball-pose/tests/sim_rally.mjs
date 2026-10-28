// Synthetic match through BallTracker + RallyJudge: rallies, handovers, an ace, a long ball, a return into the net,
// a deep ball bouncing twice, a low volley followed by a long ball.
// Camera behind the near baseline, 10 ft up. Run: node pickleball-pose/tests/sim_rally.mjs (each line shows what was decided and [what happened]).
import fs from 'fs';
const B = new Function(fs.readFileSync(new URL('../ball.js', import.meta.url), 'utf8') + '; return { BallTracker, RallyJudge };')();
const H = 10, CAMY = 37, F = 300, HOR = 100;
const proj = (cx, cy, z) => { const d = CAMY - cy; return [320 + F * (cx - 10) / d, HOR + F * (H - z) / d]; };
const toCourt = (x, y) => { if (y <= HOR + 1) return null; const d = F * H / (y - HOR); return [10 + (x - 320) * d / F, CAMY - d]; };
// a script: wait(s) or flights [[cx,cy,z], dur, apex] chained from a start point
const script = [], label = [];
let T = 0;
const wait = (s) => { T += s; };
function play(name, start, legs) {
  label.push([T, name]);
  let p = start;
  for (const [q, dur, apex] of legs) {
    for (let k = 0; k < dur * 30; k++) {
      const s = k / (dur * 30);
      script.push({ t: T + s * dur, c: [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s, p[2] + (q[2] - p[2]) * s + 4 * apex * s * (1 - s)] });
    }
    T += dur; p = q;
  }
}
wait(3);
play('rally, far misses -> near wins', [14, 23, 2.5], [[[5, -14, 0], 1.1, 6], [[4, -19, 2], 0.5, 2], [[12, 12, 0], 1.1, 7], [[12, 17, 2], 0.4, 2], [[8, -9, 0], 0.9, 6], [[6, -24, 0], 0.6, 2], [[5, -30, 0.3], 0.5, 0.5]]);
wait(6);
play('handover toss -> nothing', [6, -10, 3], [[[10, 15, 3], 1.4, 6]]);
wait(10);
play('ace -> near wins', [6, 23, 2.5], [[[15, -14, 0], 1.1, 6], [[17, -24, 0], 0.6, 3], [[18, -30, 0.3], 0.4, 0.5]]);
wait(4);
play('handover bounced over -> nothing', [15, -20, 1], [[[12, 8, 0], 1.2, 5], [[11, 14, 0], 0.6, 2], [[10, 17, 3], 0.4, 1]]);
wait(12);
play('return hit long -> far wins', [5, -23, 2.5], [[[15, 14, 0], 1.1, 6], [[15, 19, 2], 0.5, 2], [[10, -25, 0], 1.3, 8], [[10, -30, 0], 0.5, 2]]);
wait(12);
play('return into the net -> near wins', [6, 23, 2.5], [[[15, -14, 0], 1.1, 6], [[15, -19, 1.5], 0.5, 2], [[13, -1, 2], 0.5, 1], [[12.5, -0.5, 0], 0.4, 0.3]]);
wait(12);
play('deep ball, near misses (2nd bounce behind baseline) -> far wins', [5, -23, 2.5], [[[12, 16, 0], 1.2, 7], [[13, 24, 0], 0.6, 2.5], [[13, 27, 0.3], 0.4, 0.5]]);
wait(12);
play('volley low over the net, then long -> far wins', [6, 23, 2.5], [[[15, -14, 0], 1.1, 6], [[15, -19, 1.5], 0.5, 2], [[11, 8, 0], 1.0, 4], [[11, 3, 1], 0.4, 1.5], [[10, -26, 0], 1.2, 9], [[10, -30, 0], 0.4, 1.5]]);
wait(12);
play('return hit wide, flies out of the picture -> near wins', [6, 23, 2.5], [[[15, -14, 0], 1.1, 6], [[15, -19, 1.5], 0.5, 2], [[40, 10, 1.5], 1.2, 4]]);
wait(6);
const end = T;
const tr = new B.BallTracker(1), j = new B.RallyJudge();
j.frame = [640, 360];
let i = 0;
for (let t = 0; t < end; t += 1 / 30) {
  const cands = [];
  while (i < script.length && script[i].t <= t + 1e-6) { const [x, y] = proj(...script[i].c); if (Math.abs(script[i].t - t) < 0.02 && x >= 0 && x < 640 && y >= 0 && y < 360) cands.push({ x, y, a: 10 }); i++; }
  tr.update(t, cands);
  for (const e of j.step(t, tr.main(), toCourt)) {
    if (e.type === 'bounce') continue;
    const lab = label.filter(([lt]) => lt <= (e.t ?? t) + 0.5).pop();
    console.log(t.toFixed(1).padStart(6), e.type.padEnd(6), e.winner ? `winner ${e.winner}` : '', e.reason || e.why || '', '   [' + (lab ? lab[1] : '') + ']', e.type === 'end' ? `crossings ${j.crossings.length}` : '');
  }
}
