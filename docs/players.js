// Finding the players without a pose model: the phone does not move, so anything that differs from a slowly learned
// background is a person (or the ball, which is too small to count). The lowest point of each person is their feet,
// which are on the floor, so the court mapping places them well even when the camera is low.
// Plain functions and classes with no DOM, so the same code runs in the page and in tests.

class PlayerFinder {
  // w x h: the small gray image fed to update() (160 x 90); scale: how many processing-frame pixels one small pixel spans;
  // toCourt(x, y): processing-frame pixels -> court feet, or null; toImage(cx, cy): court feet -> pixels (to know how tall
  // a person standing there looks)
  constructor(w, h, toCourt, scale = 4, toImage = null) {
    this.w = w; this.h = h; this.toCourt = toCourt; this.s = scale; this.toImage = toImage;
    this.bg = null; this.n = 0; this.players = []; this.history = [];
    // how fast the background takes in what differs from it: someone standing still for a few seconds stays a player, the
    // empty spot left where someone stood while the background was learned (a "ghost") fades within about 10 s
    this.fgRate = 0.004;
  }
  // a background learned earlier (tests): skips the warm-up
  preset(gray) { this.bg = Float32Array.from(gray); this.n = 1e9; }
  // the processing frame's gray image (w*scale x h*scale) shrunk to w x h by averaging
  static shrink(gray, W, H, s) {
    const w = Math.floor(W / s), h = Math.floor(H / s), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let sum = 0; for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) sum += gray[(y * s + dy) * W + x * s + dx];
      out[y * w + x] = sum / (s * s);
    }
    return out;
  }
  update(t, gray) {
    const { w, h } = this, N = w * h;
    if (!this.bg) { this.bg = Float32Array.from(gray); this.n = 0; }
    this.n++;
    // the first ~10 s (300 frames) learn the picture quickly, players moving about average out; no players meanwhile
    const warm = this.n < 300, fg = new Uint8Array(N), bg = this.bg;
    let nfg = 0;
    for (let i = 0; i < N; i++) {
      const d = gray[i] - bg[i];
      fg[i] = Math.abs(d) > 22 ? 1 : 0; nfg += fg[i];
      bg[i] += d * (warm ? 0.02 : fg[i] ? this.fgRate : 0.03);
    }
    // a quarter of the picture changed at once: the light changed or the phone moved. Relearn quickly, no players meanwhile.
    if (nfg > N / 4) this.n = Math.min(this.n, 200);
    if (warm || nfg > N / 4) { this.players = []; return this.players; }
    // blobs: 8-connected, with one-pixel gaps bridged (a shirt and legs of a different shade)
    const seen = new Int32Array(N).fill(-1), blobs = [], stack = [];
    for (let i = 0; i < N; i++) {
      if (!fg[i] || seen[i] >= 0) continue;
      const b = { n: 0, x0: w, x1: 0, y0: h, y1: 0 };
      seen[i] = blobs.length; stack.push(i);
      while (stack.length) {
        const j = stack.pop(), x = j % w, y = (j / w) | 0;
        b.n++; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const k = yy * w + xx; if (fg[k] && seen[k] < 0) { seen[k] = blobs.length; stack.push(k); }
        }
      }
      blobs.push(b);
    }
    const s = this.s, people = [];
    for (const b of blobs) {
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
      if (b.n < 8 || bh < 4 || bh < 0.7 * bw) continue;             // too small, or wider than tall (a shadow, a bag)
      // feet: the middle of the blob's lowest rows
      let sx = 0, c = 0;
      for (let y = Math.max(b.y0, b.y1 - 1); y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (fg[y * w + x]) { sx += x; c++; }
      const fx = (sx / c + 0.5) * s, fy = (b.y1 + 1) * s;
      const g = this.toCourt ? this.toCourt(fx, fy) : null;
      if (!g || !(g[0] > -8 && g[0] < 28 && Math.abs(g[1]) < 34)) continue;   // someone off the court (a spectator, the next court)
      // tall enough for a person standing there (over 2.5 ft at the size a foot of floor has at their feet): not a shadow or
      // a patch of glare. Someone cut off by the bottom of the picture is taller than what shows.
      if (this.toImage && b.y1 < h - 1) {
        const a = this.toImage(g[0] - 0.5, g[1]), c2 = this.toImage(g[0] + 0.5, g[1]);
        if (a && c2 && bh * s < 2.5 * Math.hypot(c2[0] - a[0], c2[1] - a[1])) continue;
      }
      people.push({ x: fx, y: fy, box: [b.x0 * s, b.y0 * s, (b.x1 + 1) * s, (b.y1 + 1) * s], court: g, cut: b.y1 >= h - 1 });
    }
    this.players = people;
    this.history.push({ t, people });
    while (this.history.length && t - this.history[0].t > 2) this.history.shift();
    return people;
  }
  // Ball candidates in the middle of someone's body are their shirt, skin or the wall uncovered behind them as they move,
  // not the ball: the ball near a player is at the paddle or hand, out at the side. The middle 80% of the width is dropped.
  static offBodies(cands, players) {
    return cands.filter((q) => !players.some((p) => {
      const [x0, y0, x1, y1] = p.box, mx = (x1 - x0) * 0.1, my = (y1 - y0) * 0.1;
      return q.x > x0 + mx && q.x < x1 - mx && q.y > y0 + my && q.y < y1 - my;
    }));
  }
  // players standing behind a baseline, ready to serve: their feet have stayed within a couple of feet for `still` seconds
  ready(t, still = 0.8) {
    return this.players.filter((p) => {
      const [cx, cy] = p.court;
      if (!(Math.abs(cy) >= 20.5 && cx > -3 && cx < 23)) return false;
      const old = this.history.find((hh) => t - hh.t <= still + 0.1);
      if (!old || t - old.t < still - 0.2) return false;
      return old.people.some((q) => Math.hypot(q.court[0] - cx, q.court[1] - cy) < 2.5);
    });
  }
}
