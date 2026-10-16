// ---- court detection: find the white court lines and fit a pickleball/badminton court to them ----
// Court coordinates are feet: x 0..20 across, y = distance from the net (negative = far side).
const COURT_TEMPLATES = {
  pickleball: {
    cross: [-22, -7, 7, 22], sides: [0, 10, 20],
    lines: [[0, -22, 0, 22], [20, -22, 20, 22], [0, -22, 20, -22], [0, 22, 20, 22], [0, -7, 20, -7], [0, 7, 20, 7], [10, -22, 10, -7], [10, 7, 10, 22]],
  },
  badminton: {   // same 20 x 44 ft footprint; many indoor pickleball games use these lines
    cross: [-22, -19.5, -6.5, 6.5, 19.5, 22], sides: [0, 1.5, 10, 18.5, 20],
    lines: [[0, -22, 0, 22], [20, -22, 20, 22], [1.5, -22, 1.5, 22], [18.5, -22, 18.5, 22], [0, -22, 20, -22], [0, 22, 20, 22],
      [0, -19.5, 20, -19.5], [0, 19.5, 20, 19.5], [0, -6.5, 20, -6.5], [0, 6.5, 20, 6.5], [10, -22, 10, -6.5], [10, 6.5, 10, 22]],
  },
};
const KITCHEN = { pickleball: 7, badminton: 6.5 };

function homography(s, d) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = s[i], [u, v] = d[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  return [...M.map((r, i) => r[n] / r[i]), 1];
}
function hApply(h, x, y) { const w = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w, w]; }
function hInvert(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C; if (Math.abs(det) < 1e-12) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

// Bright, unsaturated pixels that stand out from their surroundings and sit on the court floor.
// feet (pixels, optional) tells us where the floor is, so walls, posters and banners are ignored.
function courtMask(rgba, w, h, feet) {
  const N = w * h, lum = new Float32Array(N), sat = new Float32Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[i] = (mx - mn) / (mx || 1);
  }
  // floor colour: the most common colour in the lower middle of the frame (lines are only a small share of it)
  const hist = new Map();
  for (let y = Math.floor(h * 0.4); y < Math.floor(h * 0.85); y += 2) for (let x = Math.floor(w * 0.1); x < w * 0.9; x += 2) {
    const i = y * w + x, k = (rgba[i * 4] >> 5) << 6 | (rgba[i * 4 + 1] >> 5) << 3 | rgba[i * 4 + 2] >> 5;
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  let mode = 0, mc = -1; for (const [k, c] of hist) if (c > mc) { mc = c; mode = k; }
  const F = [((mode >> 6) & 7) * 32 + 16, ((mode >> 3) & 7) * 32 + 16, (mode & 7) * 32 + 16];
  const floorLum = 0.299 * F[0] + 0.587 * F[1] + 0.114 * F[2];
  const ok = new Uint8Array(N);
  for (let i = 0; i < N; i++) ok[i] = lum[i] > floorLum + 30 && sat[i] < 0.4 ? 1 : 0;
  // floor region: per row, the span between the outermost floor-coloured pixels, kept only for rows that are mostly floor
  const Fs = F[0] + F[1] + F[2] + 1, Fc = [F[0] / Fs, F[1] / Fs];
  const inFloor = new Uint8Array(N);
  for (let y = Math.floor(h * 0.2); y < h; y++) {
    let x0 = -1, x1 = -1, n = 0;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2], sum = r + g + b + 1, L = lum[y * w + x];
      // same hue as the floor, ignoring how brightly it is lit
      if (Math.abs(r / sum - Fc[0]) + Math.abs(g / sum - Fc[1]) < 0.08 && L > floorLum * 0.45 && L < floorLum * 1.7) { n++; if (x0 < 0) x0 = x; x1 = x; }
    }
    if (n < w * 0.25) continue;
    for (let x = x0; x <= x1; x++) inFloor[y * w + x] = 1;
  }
  const IL = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += lum[y * w + x]; IL[(y + 1) * (w + 1) + x + 1] = IL[y * (w + 1) + x + 1] + s; } }
  const box = (I, x0, y0, x1, y1) => I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
  const R = Math.max(3, Math.round(w / 70)), mask = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!ok[i] || !inFloor[i]) continue;
    const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1), n = (x1 - x0) * (y1 - y0);
    if (lum[i] - box(IL, x0, y0, x1, y1) / n > 16) mask[i] = 1;
  }
  // local line direction from the structure tensor of the luminance gradient; only clearly line-like pixels keep a vote
  const gx = new Float32Array(N), gy = new Float32Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    gx[i] = lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1];
    gy[i] = lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1];
  }
  const theta = new Float32Array(N).fill(-1), r = 2;
  for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    let xx = 0, yy = 0, xy = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const j = i + dy * w + dx; xx += gx[j] * gx[j]; yy += gy[j] * gy[j]; xy += gx[j] * gy[j]; }
    const tr = xx + yy; if (tr < 1) { mask[i] = 0; continue; }
    const coh = Math.hypot(xx - yy, 2 * xy) / tr;
    if (coh < 0.35) { mask[i] = 0; continue; }
    let t = 0.5 * Math.atan2(2 * xy, xx - yy); if (t < 0) t += Math.PI;   // gradient direction = line normal
    theta[i] = t;
  }
  mask.theta = theta;
  return mask;
}
function dilate(mask, w, h, r) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) out[yy * w + xx] = 1; } }
  }
  return out;
}
function houghLines(mask, w, h, max = 24) {
  const NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = diag * 2 + 1, acc = new Uint32Array(NT * NR);
  const cs = [], sn = []; for (let t = 0; t < NT; t++) { cs.push(Math.cos(t * Math.PI / NT)); sn.push(Math.sin(t * Math.PI / NT)); }
  // each pixel votes only near its own line direction, so lines crossing several court lines do not pile up votes
  const th = mask.theta, span = 6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    const t0 = th ? Math.round(th[i] / Math.PI * NT) : null;
    for (let k = th ? -span : 0; k <= (th ? span : NT - 1); k++) {
      let t = th ? t0 + k : k, flip = 1;
      if (t < 0) { t += NT; flip = -1; } else if (t >= NT) { t -= NT; flip = -1; }
      acc[t * NR + Math.round(flip * (x * cs[t] + y * sn[t])) + diag]++;
    }
  }
  const minVotes = Math.max(20, w * 0.08), peaks = [];
  for (let t = 0; t < NT; t++) for (let r = 0; r < NR; r++) {
    const v = acc[t * NR + r]; if (v < minVotes) continue;
    let best = true;
    for (let dt = -3; dt <= 3 && best; dt++) for (let dr = -5; dr <= 5; dr++) {
      const tt = t + dt, rr = r + dr;
      if (tt < 0 || tt >= NT || rr < 0 || rr >= NR || (dt === 0 && dr === 0)) continue;
      if (acc[tt * NR + rr] > v) { best = false; break; }
    }
    if (best) peaks.push({ t: t * Math.PI / NT, rho: r - diag, votes: v });
  }
  peaks.sort((a, b) => b.votes - a.votes);
  const out = [];
  for (const p of peaks) {
    if (out.some((q) => Math.abs(q.t - p.t) < 0.05 && Math.abs(q.rho - p.rho) < 6)) continue;
    out.push(p); if (out.length >= max) break;
  }
  return out.map((p) => ({ ...p, l: [Math.cos(p.t), Math.sin(p.t), -p.rho] }));
}
function quadArea(p) { let a = 0; for (let i = 0; i < 4; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % 4]; a += x0 * y1 - x1 * y0; } return Math.abs(a) / 2; }
// Lines running down the court meet at one vanishing point. Find it, then look for lines as rays out of it.
function alongRays(mask, w, h, along) {
  if (along.length < 2) return [];
  let vp = null, bestW = 0;
  for (let i = 0; i < along.length; i++) for (let j = i + 1; j < along.length; j++) {
    const p = meet(along[i].l, along[j].l); if (!p || p[1] > h * 0.75 || p[1] < -h * 2) continue;
    let wsum = 0;
    for (const L of along) if (Math.abs(L.l[0] * p[0] + L.l[1] * p[1] + L.l[2]) < w * 0.012) wsum += L.votes;
    if (wsum > bestW) { bestW = wsum; vp = p; }
  }
  if (!vp) return [];
  const th = mask.theta, NB = 720, acc = new Float32Array(NB);   // quarter-degree bins of the ray angle
  for (let y = Math.ceil(Math.max(0, vp[1] + 4)); y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    const phi = Math.atan2(y - vp[1], x - vp[0]);                 // 0..pi below the vanishing point
    if (th && th[i] >= 0) {                                         // the pixel's own line must point at the vanishing point
      let d = Math.abs(((th[i] + Math.PI / 2) % Math.PI) - phi % Math.PI); d = Math.min(d, Math.PI - d);
      if (d > 0.14) continue;
    }
    const bin = Math.floor(phi / Math.PI * NB); if (bin >= 0 && bin < NB) acc[bin] += 1;
  }
  const sm = acc.map((_, b) => (acc[b - 1] || 0) * 0.5 + acc[b] + (acc[b + 1] || 0) * 0.5);
  const peaks = [];
  for (let b = 0; b < NB; b++) {
    if (sm[b] < Math.max(15, h * 0.06)) continue;
    let isMax = true; for (let k = -6; k <= 6; k++) if (k && sm[b + k] > sm[b]) { isMax = false; break; }
    if (isMax) peaks.push({ b, v: sm[b] });
  }
  return peaks.sort((a, b) => b.v - a.v).slice(0, 9).map(({ b, v }) => {
    const phi = (b + 0.5) / NB * Math.PI, d = [Math.cos(phi), Math.sin(phi)], n = [-d[1], d[0]];
    return { votes: v, l: [n[0], n[1], -(n[0] * vp[0] + n[1] * vp[1])] };
  });
}
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function meet(a, b) { const p = cross3(a, b); return Math.abs(p[2]) < 1e-9 ? null : [p[0] / p[2], p[1] / p[2]]; }

// Try pairs of across-court lines x pairs of along-court lines against each template; keep the best-supported court.
function fitCourt(mask, w, h, lines, feet, only = null) {
  const dm = dilate(mask, w, h, Math.max(1, Math.round(w / 300)));
  const across = [], along = [];
  for (const L of lines) {
    const dirAngle = Math.abs(Math.atan2(-L.l[0], L.l[1]));          // direction of the line, 0 = horizontal
    const a = Math.min(dirAngle, Math.PI - dirAngle);
    (a < 0.3 ? across : along).push(L);
  }
  const atX = (L, x) => -(L.l[0] * x + L.l[2]) / L.l[1];             // y of an across line at column x
  const atY = (L, y) => -(L.l[1] * y + L.l[2]) / L.l[0];             // x of an along line at row y
  // strongest candidates of each kind, then ordered far-to-near and left-to-right
  const A = across.sort((a, b) => b.votes - a.votes).slice(0, 8).sort((a, b) => atX(a, w / 2) - atX(b, w / 2));
  const rays = alongRays(mask, w, h, along);
  const B = (rays.length >= 2 ? rays : along.sort((a, b) => b.votes - a.votes).slice(0, 8)).sort((a, b) => atY(a, h) - atY(b, h));
  let best = null;
  // score only the camera's half of the court: the far half is small and cluttered by the net and players
  const samples = (tpl) => tpl.lines.filter((l) => l[1] >= 0 || l[3] >= 0).map(([x0, y0, x1, y1]) => [x0, Math.max(0, y0), x1, Math.max(0, y1)]).flatMap(([x0, y0, x1, y1]) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); const pts = [];
    for (let k = 0; k <= n; k++) pts.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
    return pts;
  });
  for (const [name, tpl] of Object.entries(COURT_TEMPLATES)) {
    if (only && name !== only) continue;
    const S = samples(tpl), crossNear = tpl.cross.filter((y) => y > 0);
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++)
      for (let k = 0; k < B.length; k++) for (let m = k + 1; m < B.length; m++) {
        const p = [meet(A[i].l, B[k].l), meet(A[i].l, B[m].l), meet(A[j].l, B[m].l), meet(A[j].l, B[k].l)];
        if (p.some((q) => !q)) continue;
        if (p[0][0] >= p[1][0] || p[3][0] >= p[2][0]) continue;       // left must stay left
        if (quadArea(p) < w * h * 0.01) continue;                        // a real court spans a good part of the frame
        for (let ya = 0; ya < crossNear.length; ya++) for (let yb = ya + 1; yb < crossNear.length; yb++)
          for (let xa = 0; xa < tpl.sides.length; xa++) for (let xb = xa + 1; xb < tpl.sides.length; xb++) {
            const Y0 = crossNear[ya], Y1 = crossNear[yb], X0 = tpl.sides[xa], X1 = tpl.sides[xb];
            const H = homography([[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]], p);
            if (!H) continue;
            if (feet) {   // the player has to be standing on this court
              const Hi = hInvert(H); if (!Hi) continue;
              const f = hApply(Hi, feet[0], feet[1]);
              if (!(f[0] > -0.5 && f[0] < 20.5 && f[1] > -1 && f[1] < 24)) continue;
            }
            // count distinct supporting pixels, so a court squashed onto one line cannot score
            let hit = 0, miss = 0; const seen = new Set();
            for (const [x, y] of S) {
              const q = hApply(H, x, y); if (q[2] <= 0) { miss++; continue; }
              const px = Math.round(q[0]), py = Math.round(q[1]);
              if (px < 0 || py < h * 0.3 || px >= w || py >= h) continue;
              const key = py * w + px; if (seen.has(key)) continue; seen.add(key);
              dm[key] ? hit++ : miss++;
            }
            const score = hit - 0.6 * miss;
            if (!best || score > best.score) best = { score, hit, miss, H, template: name };
          }
      }
  }
  return best;
}
// rgba: an ImageData-like buffer of the frame scaled to w x h; feet: [x, y] normalized (or null).
// Returns homographies between normalized image coords and court feet, or null when no court is found.
// only: "pickleball" or "badminton" to fit just that line layout (null tries both)
function detectCourt(rgba, w, h, feet, only = null) {
  const fp = feet ? [feet[0] * w, feet[1] * h] : null;
  const mask = courtMask(rgba, w, h, fp);
  const lines = houghLines(mask, w, h);
  const fit = fitCourt(mask, w, h, lines, fp, only);
  if (!fit || fit.hit < 40 || fit.hit < 1.5 * fit.miss) return null;
  const S = [[1 / w, 0, 0], [0, 1 / h, 0], [0, 0, 1]];   // pixels -> normalized
  const m2i = mul3(S, fit.H), i2m = hInvert(m2i);
  return { m2i, i2m, template: fit.template, score: fit.score, hit: fit.hit, miss: fit.miss };
}
function mul3(A, h) { // A (3x3 rows) * h (flat 9)
  const B = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], h[8]]], out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(A[r][0] * B[0][c] + A[r][1] * B[1][c] + A[r][2] * B[2][c]);
  return out;
}
