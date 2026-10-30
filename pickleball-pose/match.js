// Saved games, shared by the scoring page (writes) and the analysis page (reads).
// Everything stays in this browser: IndexedDB database "picklepose" with
//   matches: one record per game (settings, score log, rallies with their bounces and clip info)
//   clips:   one video per rally, keyed "<matchId>:<rally number>"

const MatchDB = {
  open() {
    if (!this._db) this._db = new Promise((res, rej) => {
      const r = indexedDB.open("picklepose", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("matches", { keyPath: "id" });
        db.createObjectStore("clips", { keyPath: "key" }).createIndex("match", "matchId");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  async run(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && "result" in req ? req.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  saveMatch(m) { return this.run("matches", "readwrite", (s) => s.put(m)); },
  getMatch(id) { return this.run("matches", "readonly", (s) => s.get(id)); },
  async listMatches() { return (await this.run("matches", "readonly", (s) => s.getAll())).sort((a, b) => b.startedAt - a.startedAt); },
  saveClip(c) { return this.run("clips", "readwrite", (s) => s.put(c)); },
  getClip(matchId, n) { return this.run("clips", "readonly", (s) => s.get(`${matchId}:${n}`)); },
  clipsOf(matchId) { return this.run("clips", "readonly", (s) => s.index("match").getAll(matchId)); },
  async deleteMatch(id) {
    const clips = await this.clipsOf(id);
    await this.run("clips", "readwrite", (s) => { for (const c of clips) s.delete(c.key); });
    await this.run("matches", "readwrite", (s) => s.delete(id));
  },
};

// Records only the rallies, each as its own complete video file that starts some seconds before the rally was
// detected (a recording cannot reach back in time, so one is always running and is kept when a rally starts).
class RallyRecorder {
  static pickMime() {
    if (typeof MediaRecorder === "undefined") return null;
    return ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || null;
  }
  // One recording at a time. On iPhones, recordings running side by side stopped getting frames part way (the clip froze),
  // and giving each its own copy of the camera track made Safari run out of memory or lose the camera. So between rallies
  // a single recording runs and is restarted every `segment` seconds (the old one has fully stopped before the next
  // starts); when a rally starts, the running one is kept, so a clip starts anywhere from 0 to `segment` s before.
  constructor(stream, { preroll = 3, after = 1, bitrate = 4e6, onClip }) {
    this.stream = stream; this.after = after; this.bitrate = bitrate; this.onClip = onClip;
    this.segment = Math.max(8, 4 * preroll);
    this.mime = RallyRecorder.pickMime(); this.cur = null; this.kept = null; this.busy = false; this.timer = 0; this.stalls = 0;
  }
  get ok() { return !!this.mime; }
  now() { return performance.now() / 1000; }
  begin() { if (!this.ok) return; this.startCur(); this.timer = setInterval(() => this.tick(), 400); }
  // data is asked for every second, which shows a recording that stops getting frames
  make() {
    const r = { rec: new MediaRecorder(this.stream, { mimeType: this.mime, videoBitsPerSecond: this.bitrate }), chunks: [], t0: this.now(), sizes: [], peak: 0 };
    r.rec.ondataavailable = (e) => {
      const n = e.data?.size || 0;
      if (n) r.chunks.push(e.data);
      r.sizes.push(n); if (r.sizes.length > 3) r.sizes.shift();
      r.peak = Math.max(r.peak, n);
    };
    r.rec.start(1000);
    return r;
  }
  // the last two seconds brought next to nothing after real data before (a still scene gives little data all along,
  // so it is measured against the recording's own best second)
  stalled(r) { const s = r.sizes; return s.length >= 2 && r.peak > 30000 && s.slice(-2).every((n) => n < Math.max(1500, 0.03 * r.peak)); }
  startCur() { if (!this.cur && !this.kept && !this.busy) this.cur = this.make(); }
  // stop a recording, then run `then` once it has really stopped (or after 2 s at most)
  stopThen(r, keep, then) {
    this.busy = true;
    let done = false;
    const go = () => { if (done) return; done = true; this.busy = false; then?.(); };
    r.rec.onstop = () => {
      if (keep) {
        const blob = new Blob(r.chunks, { type: this.mime.split(";")[0] });
        this.onClip?.({ n: r.n, blob, mime: blob.type, preroll: +(r.rallyAt - r.t0).toFixed(2), duration: +(this.now() - r.t0).toFixed(2), stalled: !!r.stall });
      }
      go();
    };
    try { r.rec.stop(); } catch { go(); }
    setTimeout(go, 2000);
  }
  tick() {
    const t = this.now();
    if (this.kept) { if (!this.kept.stall && this.stalled(this.kept)) { this.kept.stall = true; this.stalls++; } return; }
    if (this.busy) return;
    if (!this.cur) { this.startCur(); return; }
    const stall = this.stalled(this.cur);
    if (stall || t - this.cur.t0 > this.segment) {
      if (stall) this.stalls++;
      const old = this.cur; this.cur = null;
      this.stopThen(old, false, () => this.startCur());
    }
  }
  rallyStart(n) {
    if (!this.ok || this.kept) return;
    if (!this.cur) this.cur = this.make();      // only while a restart is finishing: a short overlap is better than no clip
    this.kept = Object.assign(this.cur, { n, rallyAt: this.now() });
    this.cur = null;
  }
  // keep recording `after` seconds past the end, then hand over the clip and start the next recording
  rallyEnd() {
    const k = this.kept; if (!k) return;
    this.kept = null; this.busy = true;
    setTimeout(() => this.stopThen(k, true, () => this.startCur()), this.after * 1000);
  }
  rallyCancel() { const k = this.kept; if (!k) return; this.kept = null; this.stopThen(k, false, () => this.startCur()); }
  end() {
    clearInterval(this.timer);
    if (this.cur) { const c = this.cur; this.cur = null; this.stopThen(c, false); }
    if (this.kept) { const k = this.kept; this.kept = null; this.stopThen(k, true); }
  }
  // for the diagnostics line: the recording's KB in its last second, and how many stalled so far
  status() {
    const r = this.kept || this.cur;
    return `錄影 ${this.kept ? "●保留中" : r ? "待命" : "切換中"} ${r ? Math.round((r.sizes[r.sizes.length - 1] || 0) / 1000) : 0}KB/秒 · 中斷 ${this.stalls}`;
  }
}

function fmtBytes(n) { return n > 1e9 ? (n / 1e9).toFixed(1) + " GB" : n > 1e6 ? Math.round(n / 1e6) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB"; }
function fmtDate(ms) { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
