// Reads raw 640x360 RGBA frames (30 fps) from stdin and writes ball candidates per frame, like score.html does.
// Usage: ffmpeg -i video -vf scale=640:360 -f rawvideo -pix_fmt rgba - | node cands.mjs ../../ball.js out.json
import fs from 'fs';
const [,, ballJs, out] = process.argv;
const B = new Function(fs.readFileSync(ballJs, 'utf8') + '; return { ballCandidates };')();
const W = 640, H = 360, N = W * H * 4;
let buf = Buffer.alloc(0), k = 0, prev = null;
const stay = new Uint8Array(W * H), frames = [];
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= N) {
    const f = buf.subarray(0, N);
    const r = B.ballCandidates(f, W, H, prev, null, stay);
    prev = r.gray;
    frames.push([+(k / 30).toFixed(4), r.cands.map((q) => [+q.x.toFixed(1), +q.y.toFixed(1), q.a])]);
    k++; buf = Buffer.from(buf.subarray(N));
  }
});
process.stdin.on('end', () => { fs.writeFileSync(out, JSON.stringify(frames)); console.log('frames', frames.length, 'cands', frames.reduce((a, f) => a + f[1].length, 0)); });
