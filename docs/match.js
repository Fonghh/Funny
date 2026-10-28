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

// Records only the rallies, each as its own complete video file, starting `preroll` seconds before the
// rally was detected. A recording cannot reach back in time, so short "standby" recordings are kept
// running, staggered by `preroll` seconds; when a rally starts, the one that already holds about
// `preroll` seconds is kept going and the rest are dropped.
class RallyRecorder {
  static pickMime() {
    if (typeof MediaRecorder === "undefined") return null;
    return ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || null;
  }
  constructor(stream, { preroll = 3, after = 1, bitrate = 4e6, onClip }) {
    this.stream = stream; this.preroll = preroll; this.after = after; this.bitrate = bitrate; this.onClip = onClip;
    this.mime = RallyRecorder.pickMime(); this.standby = []; this.kept = null; this.timer = 0; this.stalls = 0;
  }
  get ok() { return !!this.mime; }
  now() { return performance.now() / 1000; }
  begin() { if (!this.ok) return; this.cycle(); this.timer = setInterval(() => this.cycle(), 400); }
  // Each recording gets its own copy of the camera track: on iPhones a clip recorded next to others stopped getting frames
  // part way through (the file runs on, frozen). Data is asked for every second, so a recording that stalls shows up.
  make() {
    const track = this.stream.getVideoTracks()[0], copy = track?.clone ? track.clone() : null;
    const stream = copy ? new MediaStream([copy]) : this.stream;
    const r = { rec: new MediaRecorder(stream, { mimeType: this.mime, videoBitsPerSecond: this.bitrate }), copy, chunks: [], t0: this.now(), sizes: [], peak: 0 };
    r.rec.ondataavailable = (e) => {
      const n = e.data?.size || 0;
      if (n) r.chunks.push(e.data);
      r.sizes.push(n); if (r.sizes.length > 3) r.sizes.shift();
      r.peak = Math.max(r.peak, n);
    };
    r.rec.start(1000);
    return r;
  }
  // the last two seconds brought next to nothing after real data before: the recording has stopped getting frames
  // (a still scene gives little data all along, so it is measured against the recording's own best second)
  stalled(r) {
    const s = r.sizes;
    return s.length >= 2 && r.peak > 30000 && s.slice(-2).every((n) => n < Math.max(1500, 0.03 * r.peak));
  }
  release(r) { try { r.copy?.stop(); } catch {} }
  drop(r) { r.rec.onstop = null; try { r.rec.stop(); } catch {} this.release(r); }
  // between rallies: always have a recording that is at least `preroll` seconds old
  cycle() {
    if (this.kept) { if (!this.kept.stall && this.stalled(this.kept)) { this.kept.stall = true; this.stalls++; } return; }
    const t = this.now();
    this.standby = this.standby.filter((r) => (t - r.t0 > 2 * this.preroll + 0.5 || this.stalled(r) ? (this.stalled(r) && this.stalls++, this.drop(r), false) : true));
    const newest = this.standby[this.standby.length - 1];
    if (!newest || t - newest.t0 >= this.preroll) this.standby.push(this.make());
  }
  rallyStart(n) {
    if (!this.ok) return;
    const t = this.now();
    const pick = [...this.standby].reverse().find((r) => t - r.t0 >= this.preroll) || this.standby[0] || this.make();
    for (const r of this.standby) if (r !== pick) this.drop(r);
    this.standby = [];
    this.kept = Object.assign(pick, { n, rallyAt: t });
  }
  // keep recording `after` seconds past the end, then hand over the clip
  rallyEnd() {
    const k = this.kept; if (!k) return;
    this.kept = null;
    setTimeout(() => this.finish(k), this.after * 1000);
    this.cycle();
  }
  rallyCancel() { const k = this.kept; if (!k) return; this.kept = null; this.drop(k); this.cycle(); }
  finish(k) {
    k.rec.onstop = () => {
      this.release(k);
      const blob = new Blob(k.chunks, { type: this.mime.split(";")[0] });
      this.onClip?.({ n: k.n, blob, mime: blob.type, preroll: +(k.rallyAt - k.t0).toFixed(2), duration: +(this.now() - k.t0).toFixed(2), stalled: !!k.stall });
    };
    try { k.rec.stop(); } catch {}
  }
  // for the diagnostics line: how many recordings run, KB written in their last second, and how many stalled so far
  status() {
    const all = [...this.standby, ...(this.kept ? [this.kept] : [])];
    return `錄影 ${all.length} 段 ${all.map((r) => (r === this.kept ? "●" : "") + Math.round((r.sizes[r.sizes.length - 1] || 0) / 1000)).join("/")}KB/秒 · 中斷 ${this.stalls}`;
  }
  end() {
    clearInterval(this.timer);
    for (const r of this.standby) this.drop(r);
    this.standby = [];
    if (this.kept) { const k = this.kept; this.kept = null; this.finish(k); }
  }
}

function fmtBytes(n) { return n > 1e9 ? (n / 1e9).toFixed(1) + " GB" : n > 1e6 ? Math.round(n / 1e6) + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB"; }
function fmtDate(ms) { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
