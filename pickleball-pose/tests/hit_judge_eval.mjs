// Experiment: a hit-based rally judge (turns of the ball path + who stood next to the ball, from pose) against the
// current RallyJudge, on the two videos the user labelled. Data in tests/data/hit_A.json and hit_B.json comes from
// tests/tools/cands.mjs (ball candidates per frame) and tests/tools/pose.py (players at 10 samples/s).
// Run: node pickleball-pose/tests/hit_judge_eval.mjs [A|B] ['{"turn":70}']
// Result so far (10/19): neither judge is reliable on this footage; see the summary printed at the end.
import fs from 'fs';
const src = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const B = new Function(src('../ball.js') + '; return { BallTracker, RallyJudge };')();
const C = new Function(src('../court.js') + '; return { hApply, hInvert };')();
const which = process.argv[2] || 'A';
const O = { turn: 70, minSpd: 60, win: 0.4, gap: 3, reach: 1.2, nearH: 90, ...JSON.parse(process.argv[3] || '{}') };
const { m2i, frames, pose, truth } = JSON.parse(src(`data/hit_${which}.json`));
const i2m = m2i && C.hInvert(m2i), wSign = m2i ? Math.sign(C.hApply(i2m, ...C.hApply(m2i, 10, 11).slice(0, 2))[2]) : 1;
const ground = (x, y) => { if (!i2m) return null; const g = C.hApply(i2m, x / 640, y / 360); return g[2] * wSign > 0 ? g : null; };
const what = (s, e) => { let best = '·', bo = 0; for (const [a, b, w] of truth) { const o = Math.min(b, e) - Math.max(a, s); if (o > bo) { bo = o; best = w; } } return best; };

// ---- current judge
function current() {
  const tr = new B.BallTracker(1), j = new B.RallyJudge(), out = [];
  let start = 0;
  for (const [t, c] of frames) {
    tr.update(t, c.map(([x, y, a]) => ({ x, y, a })));
    for (const e of j.step(t, tr.main(), i2m ? (x, y) => ground(x, y)?.slice(0, 2) ?? null : null)) {
      if (e.type === 'start') start = e.t;
      if (e.type === 'end') out.push({ s: start, e: t, w: e.winner || 'ask' });
      if (e.type === 'cancel') out.push({ s: start, e: t, w: '-' });
    }
  }
  return out;
}

// ---- hit-based judge
function hitBased() {
  const tr = new B.BallTracker(1), pts = [];
  for (const [t, c] of frames) {
    tr.update(t, c.map(([x, y, a]) => ({ x, y, a })));
    const m = tr.main(); if (!m) continue;
    const q = m.pts[m.pts.length - 1]; if (q.t === t) pts.push({ t, x: q.x, y: q.y });
  }
  const poseAt = (t) => { const p = pose.reduce((b, p) => Math.abs(p[0] - t) < Math.abs(b[0] - t) ? p : b); return Math.abs(p[0] - t) < 0.2 ? p[1] : []; };
  // a player's team from where the feet stand (on the floor, so the court mapping holds even for a low camera);
  // without a court, near players are the big ones
  const team = (p) => { const g = ground(...p.feet); return g ? (g[1] >= 0 ? 'near' : 'far') : (p.box[3] - p.box[1] >= O.nearH ? 'near' : 'far'); };
  // events: sharp turns of the ball path (hits) and low points out in the open (bounces)
  const ev = [];
  for (const c of pts) {
    const before = pts.filter((q) => q.t < c.t && c.t - q.t <= O.win), after = pts.filter((q) => q.t > c.t && q.t - c.t <= O.win);
    if (before.length < 2 || after.length < 2) continue;
    const a = before[0], b = after[after.length - 1];
    const v1 = [(c.x - a.x) / (c.t - a.t), (c.y - a.y) / (c.t - a.t)], v2 = [(b.x - c.x) / (b.t - c.t), (b.y - c.y) / (b.t - c.t)];
    const s1 = Math.hypot(...v1), s2 = Math.hypot(...v2);
    if (s1 < O.minSpd || s2 < O.minSpd) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / s1 / s2))) * 180 / Math.PI;
    const low = v1[1] > 0 && v2[1] < 0 && before.every((q) => q.y <= c.y + 1) && after.every((q) => q.y <= c.y + 1);
    if ((ang < O.turn && !low) || (ev.length && c.t - ev[ev.length - 1].t < 0.25)) continue;
    let hitter = null, bd = 1e9;
    for (const p of poseAt(c.t)) {
      const h = p.box[3] - p.box[1], nx = Math.max(p.box[0], Math.min(p.box[2], c.x)), ny = Math.max(p.box[1], Math.min(p.box[3], c.y));
      const d = Math.hypot(nx - c.x, ny - c.y) / h;
      if (d < O.reach * 0.5 && d < bd) { bd = d; hitter = p; }
    }
    const g = ground(c.x, c.y);
    if (hitter) ev.push({ t: c.t, type: 'hit', side: team(hitter) });
    else if (low && g && Math.abs(g[1]) < 30 && g[0] > -8 && g[0] < 28) ev.push({ t: c.t, type: 'bounce', side: g[1] >= 0 ? 'near' : 'far', in: g[0] >= -0.3 && g[0] <= 20.3 && Math.abs(g[1]) <= 22.3 });
    else if (ang >= O.turn) ev.push({ t: c.t, type: 'hit', side: 'far' });     // nobody seen next to the ball: far players are mostly not detected
  }
  // rallies: hits less than `gap` apart; real when the hitting side changes at least once
  const rallies = []; let cur = null;
  for (const e of ev) {
    if (cur && e.t - cur.last > O.gap) { rallies.push(cur); cur = null; }
    if (!cur) { if (e.type !== 'hit') continue; cur = { s: e.t, last: e.t, ev: [] }; }
    cur.ev.push(e); if (e.type === 'hit') cur.last = e.t;
  }
  if (cur) rallies.push(cur);
  return rallies.map((r) => {
    const hits = r.ev.filter((e) => e.type === 'hit'), last = hits[hits.length - 1], other = last.side === 'near' ? 'far' : 'near';
    let changes = 0; for (let i = 1; i < hits.length; i++) if (hits[i].side !== hits[i - 1].side) changes++;
    const bounce = r.ev.find((e) => e.type === 'bounce' && e.t > last.t);
    let w;
    if (!changes && !(bounce && bounce.side !== last.side)) w = '-';
    else if (bounce) w = bounce.side === last.side || !bounce.in ? other : last.side;
    else w = other;   // nothing seen after the last hit: guess it went out (or into the net)
    return { s: r.s, e: r.last, w };
  });
}

function score(list) {
  let ok = 0;
  const rows = list.filter((r) => !(r.w === '-' && what(r.s - 0.5, r.e + 0.5) === '·')).map((r) => {
    const tw = what(r.s - 0.5, r.e + 0.5), good = r.w === tw || (r.w === '-' && tw === '·');
    if (good && tw !== '·') ok++;
    return `${r.s.toFixed(1).padStart(5)}–${r.e.toFixed(1).padEnd(5)} ${r.w.padEnd(4)} (truth ${tw})${good ? '' : ' ✗'}`;
  });
  return { ok, rows };
}
for (const [name, list] of [['current RallyJudge', current()], ['hit-based', hitBased()]]) {
  const { ok, rows } = score(list);
  console.log(`== ${name}: ${ok}/${truth.length} labels matched`);
  rows.forEach((r) => console.log('  ' + r));
}
console.log('truth:', truth.map(([a, b, w]) => `${a}–${b} ${w}`).join(' | '));
