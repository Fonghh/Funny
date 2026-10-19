// Ball finding, tracking, bounce and rally-end detection for live scoring.
// Plain functions and classes with no DOM, so the same code runs in the page and in tests.
// Coordinates are pixels of the processing frame (about 640 px wide); court coordinates come from court.js.

// Yellow / yellow-green, saturated and bright: the colours pickleballs come in.
function isBallColour(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx < 110 || mx - mn < 0.3 * mx) return false;
  let hue;
  if (mx === r) hue = 60 * (((g - b) / (mx - mn)) % 6);
  else if (mx === g) hue = 60 * ((b - r) / (mx - mn) + 2);
  else return false;
  return hue >= 48 && hue <= 95;
}

// Ball candidates: small ball-coloured blobs that moved since the previous frame.
// prevGray (Uint8Array or null) is the previous frame's gray image. roi = [x0, y0, x1, y1] or null.
// stay (Uint8Array of w*h, kept by the caller) counts how long each pixel has been ball-coloured: yellow letters on the floor
// or a sign never move, but a net or fence in front of the camera makes them shimmer as if they did.
function ballCandidates(rgba, w, h, prevGray, roi, stay = null) {
  const N = w * h, gray = new Uint8Array(N), col = new Uint8Array(N), vivid = new Uint8Array(N);
  const [rx0, ry0, rx1, ry1] = roi || [0, 0, w, h];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    gray[i] = (r * 77 + g * 150 + b * 29) >> 8;
    if (x >= rx0 && x < rx1 && y >= ry0 && y < ry1 && isBallColour(r, g, b)) {
      col[i] = 1;
      const mx = Math.max(r, g, b);
      if (mx - Math.min(r, g, b) >= 0.5 * mx) vivid[i] = 1;
    }
    // about 250 for a pixel that is always yellow, 40 for one yellow a sixth of the time; a passing ball leaves 8-16
    if (stay) stay[i] = stay[i] - (stay[i] >> 5) + (col[i] ? 8 : 0);
  }
  const out = [];
  if (prevGray) {
    const seen = new Uint8Array(N), stack = [];
    for (let i = 0; i < N; i++) {
      if (!col[i] || seen[i]) continue;
      let n = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, moved = false, bright = false, still = 0;
      stack.push(i); seen[i] = 1;
      while (stack.length) {
        const j = stack.pop(), x = j % w, y = (j / w) | 0;
        n++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        if (Math.abs(gray[j] - prevGray[j]) > 18) moved = true;
        if (vivid[j]) bright = true;
        if (stay) still += stay[j];
        if (n > 400) continue;
        for (const k of [j - 1, j + 1, j - w, j + w]) if (k >= 0 && k < N && col[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // a ball has at least one strongly coloured pixel even when blurred; a light-green court seen through a net does not
      if (moved && bright && n >= 2 && n <= 180 && Math.max(bw, bh) <= 6 * Math.min(bw, bh) && !(stay && still / n > 40)) out.push({ x: sx / n, y: sy / n, a: n });
    }
  }
  return { cands: out, gray };
}

// Links candidates over time into tracks with a constant-velocity guess.
class BallTracker {
  constructor(scale = 1) { this.tracks = []; this.s = scale; this.nextId = 1; }
  update(t, cands) {
    const used = new Set();
    for (const tr of this.tracks) {
      if (tr.dead) continue;
      const last = tr.pts[tr.pts.length - 1], gap = t - last.t;
      if (gap > 0.25) { tr.dead = true; continue; }
      let vx = 0, vy = 0;
      if (tr.pts.length >= 2) {
        const p = tr.pts[tr.pts.length - 2], dt = last.t - p.t;
        if (dt > 1e-4) { vx = (last.x - p.x) / dt; vy = (last.y - p.y) / dt; }
      }
      const ex = last.x + vx * gap, ey = last.y + vy * gap;
      let best = -1, bd = 1e9;
      cands.forEach((c, k) => { if (used.has(k)) return; const d = Math.hypot(c.x - ex, c.y - ey); if (d < bd) { bd = d; best = k; } });
      if (best >= 0 && bd < this.s * (17 + 500 * gap)) { used.add(best); tr.pts.push({ t, ...cands[best] }); }
    }
    cands.forEach((c, k) => { if (!used.has(k)) this.tracks.push({ id: this.nextId++, pts: [{ t, ...c }], dead: false }); });
    this.tracks = this.tracks.filter((tr) => !tr.dead || tr.pts.length >= 8);
    if (this.tracks.length > 60) this.tracks.splice(0, this.tracks.length - 60);
  }
  // the ball: the live track that moved the most over its last few points (something yellow that only shimmers in place,
  // like letters on the floor seen through a net, can last much longer but goes nowhere)
  main() {
    let best = null, bs = 0;
    for (const tr of this.tracks) {
      if (tr.dead || tr.pts.length < 4) continue;
      const p = tr.pts, a = p[Math.max(0, p.length - 10)], b = p[p.length - 1], s = Math.hypot(b.x - a.x, b.y - a.y) + Math.min(p.length, 10);
      if (s > bs) { bs = s; best = tr; }
    }
    return best;
  }
}

// Follows rallies. Without a court: a rally starts when a ball track is clearly moving and ends when the ball has been gone a while;
// the last bounce decides. With a court the judge goes by the rhythm of play:
//  - a rally starts when the ball crosses the net, and is over when the ball has not come back across within a few seconds
//    (players picking the ball up or walking with it no longer keep it going)
//  - in a real rally the ball keeps crossing the net every second or two. A ball that crosses only once is a serve that was not
//    returned only if it came a good while after the previous rally (players get the ball back and get ready first) and was
//    struck from deep in the court; otherwise the ball was just handed over to the other side, and nothing is reported.
//  - the first bounce after the last crossing decides. In on side X: X failed to return it, so the other side wins.
//    Out on side X's end: the other side hit it out, so X wins. A net ball drops on the hitter's side and counts as in there.
class RallyJudge {
  constructor({ endAfter = 2, cooldown = 1.5, minRally = 1.5, minSpeed = 40, maxRally = 90, returnWindow = 4, serveQuiet = 8, serveDepth = 10 } = {}) {
    this.minRally = minRally; this.minSpeed = minSpeed; this.maxRally = maxRally;
    this.endAfter = endAfter; this.cooldown = cooldown;
    this.returnWindow = returnWindow; this.serveQuiet = serveQuiet; this.serveDepth = serveDepth;
    this.names = { near: "近端", far: "遠端" };      // shown in reasons; a side-on camera calls them 左邊／右邊
    this.state = "idle"; this.bounces = []; this.lastSeen = 0; this.endedAt = -1e9; this.trackId = null; this.path = [];
    this.lastRally = -1e9; this.crossings = []; this.side = 0;
  }
  // t: seconds; ball: main track or null; toCourt(x, y) -> [cx, cy] in feet or null when there is no court
  step(t, ball, toCourt) {
    const events = [];
    // only a track that is moving like a ball keeps a rally alive (a yellow shirt drifting across does not)
    const fresh = ball && ball.pts[ball.pts.length - 1].t === t && this.speed(ball) >= this.minSpeed;
    if (this.state === "idle") {
      if (ball && fresh && t - this.endedAt > this.cooldown) {
        const a = ball.pts[0], b = ball.pts[ball.pts.length - 1];
        // with a court, only a ball that crosses the net starts a rally: bouncing the ball before serving or picking it up does not
        if (ball.pts.length >= 10 && Math.hypot(b.x - a.x, b.y - a.y) > 40 && (!toCourt || this.crossesNet(ball, toCourt))) {
          this.state = "rally"; this.bounces = []; this.startedAt = a.t; this.lastSeen = t; this.path = ball.pts.slice(); this.trackId = ball.id;
          // time since the previous rally was over: the ball is handed over soon after, a serve comes once everyone is ready
          this.quiet = a.t - this.lastRally;
          const g = toCourt ? toCourt(a.x, a.y) : null;
          this.origin = g && Math.abs(g[1]) < 60 ? g : null;
          this.crossings = []; this.side = 0;
          for (const q of this.path) this.noteSide(q, toCourt);
          events.push({ type: "start", t: a.t });
        }
      }
      return events;
    }
    if (fresh) {
      this.lastSeen = t;
      const q = ball.pts[ball.pts.length - 1];
      if (ball.id !== this.trackId) this.trackId = ball.id;
      this.path.push(q);
      this.noteSide(q, toCourt);
      const bounce = this.findBounce(toCourt);
      if (bounce) { this.bounces.push(bounce); events.push({ type: "bounce", ...bounce }); }
    }
    const noReturn = toCourt && this.crossings.length && t - this.crossings[this.crossings.length - 1] > this.returnWindow;
    if (noReturn || t - this.lastSeen > this.endAfter || t - this.startedAt > this.maxRally) {
      this.state = "idle"; this.endedAt = t;
      if (toCourt) {
        if (this.crossings.length >= 2 || this.servedOnce()) { events.push({ type: "end", t, ...this.outcome() }); this.lastRally = this.crossings[this.crossings.length - 1]; }
        else events.push({ type: "cancel", t, why: "handover" });
      }
      // a "rally" shorter than a serve plus its bounce was something else moving (a ball being picked up, a toss)
      else if (this.lastSeen - this.startedAt >= this.minRally || this.bounces.length) events.push({ type: "end", t, ...this.outcome() });
      else events.push({ type: "cancel", t });
    }
    return events;
  }
  // one crossing only: a serve nobody returned (ball still beforehand, struck from deep), or the ball handed over
  servedOnce() { return this.quiet >= this.serveQuiet && !!this.origin && Math.abs(this.origin[1]) >= this.serveDepth; }
  // which half the ball's ground position is in; a change of half is a net crossing
  noteSide(q, toCourt) {
    if (!toCourt) return;
    const g = toCourt(q.x, q.y); if (!g || !(Math.abs(g[1]) < 60) || Math.abs(g[1]) < 1.5) return;
    const sd = Math.sign(g[1]);
    if (this.side && sd !== this.side) this.crossings.push(q.t);
    this.side = sd;
  }
  // the point was decided outside the judge (tapped by hand, or the next score call was heard): stop following this rally
  stop(t) { if (this.state === "rally") { this.state = "idle"; this.endedAt = t; this.lastRally = this.crossings.length ? this.crossings[this.crossings.length - 1] : t; } }
  // the track's ground positions are on both sides of the net. Airborne points project farther from the camera than they are,
  // but a ball flying from one half to the other still changes sides in the projection.
  crossesNet(tr, toCourt) {
    let first = 0;
    for (const q of tr.pts) {
      const g = toCourt(q.x, q.y); if (!g || !(Math.abs(g[1]) < 60)) continue;
      const cy = g[1]; if (Math.abs(cy) < 1.5) continue;
      if (!first) first = Math.sign(cy); else if (Math.sign(cy) !== first) return true;
    }
    return false;
  }
  // recent speed of a track in pixels per second, along its path (at a bounce the ball goes down and back up, so the
  // straight-line distance over these frames is small even though the ball is flying)
  speed(tr) {
    const p = tr.pts, i0 = Math.max(0, p.length - 6), dt = p[p.length - 1].t - p[i0].t;
    let len = 0; for (let i = i0 + 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    return dt > 1e-3 ? len / dt : 0;
  }
  // a low point (largest image y) four samples back, standing out from both sides
  findBounce(toCourt) {
    const p = this.path, n = p.length, k = 4;
    if (n < 2 * k + 1) return null;
    const i = n - 1 - k, c = p[i];
    for (let j = i - k; j <= i + k; j++) if (j !== i && p[j].y > c.y) return null;
    const rise = (a, b) => Math.max(...p.slice(a, b).map((q) => c.y - q.y));
    if (rise(i - k, i) < 3 || rise(i + 1, i + k + 1) < 3) return null;
    if (this.bounces.length && c.t - this.bounces[this.bounces.length - 1].t < 0.15) return null;
    const g = toCourt ? toCourt(c.x, c.y) : null;
    if (!g) return { t: c.t, x: c.x, y: c.y, court: null };
    const [cx, cy] = g;
    if (!(cx > -6 && cx < 26 && Math.abs(cy) < 28)) return null;      // in the air (a hit), not on the floor
    const margin = 0.3, inside = cx >= -margin && cx <= 20 + margin && Math.abs(cy) <= 22 + margin;
    return { t: c.t, x: c.x, y: c.y, court: [cx, cy], side: cy >= 0 ? "near" : "far", in: inside };
  }
  outcome() {
    const lastCross = this.crossings.length ? this.crossings[this.crossings.length - 1] : -1e9;
    const b = this.bounces.find((q) => q.court && q.t >= lastCross) || [...this.bounces].reverse().find((q) => q.court);
    if (!b) return { winner: null, reason: "沒看清楚球的落點" };
    const other = b.side === "near" ? "far" : "near", where = this.names[b.side];
    return b.in
      ? { winner: other, reason: `球最後落在${where}界內，沒被接回`, bounce: b }
      : { winner: b.side, reason: `球落在${where}界外（對方打出界）`, bounce: b };
  }

}

// Traditional (side-out) doubles scoring. Teams are "A" and "B"; the game starts 0-0-2.
class SideOutGame {
  constructor({ firstServer = "A", target = 11 } = {}) {
    this.target = target; this.score = { A: 0, B: 0 }; this.serving = firstServer; this.server = 2; this.history = []; this.winner = null;
  }
  other(team) { return team === "A" ? "B" : "A"; }
  rally(winnerTeam) {
    if (this.winner) return;
    this.history.push(JSON.stringify({ score: this.score, serving: this.serving, server: this.server, winner: this.winner }));
    if (winnerTeam === this.serving) this.score[winnerTeam]++;
    else if (this.server === 1) this.server = 2;
    else { this.serving = this.other(this.serving); this.server = 1; }
    const s = this.score, lead = Math.abs(s.A - s.B), top = Math.max(s.A, s.B);
    if (top >= this.target && lead >= 2) this.winner = s.A > s.B ? "A" : "B";
  }
  // set the call by hand, e.g. after hearing "1-0-2" called on court
  set(serving, servingScore, receivingScore, server) {
    this.history.push(JSON.stringify({ score: this.score, serving: this.serving, server: this.server, winner: this.winner }));
    this.serving = serving; this.server = server;
    this.score = { [serving]: servingScore, [this.other(serving)]: receivingScore };
    const s = this.score, lead = Math.abs(s.A - s.B), top = Math.max(s.A, s.B);
    this.winner = top >= this.target && lead >= 2 ? (s.A > s.B ? "A" : "B") : null;
  }
  undo() { const h = this.history.pop(); if (h) Object.assign(this, JSON.parse(h)); }
  call() { return `${this.score[this.serving]}-${this.score[this.other(this.serving)]}-${this.server}`; }
}
