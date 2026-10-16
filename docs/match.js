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
    this.mime = RallyRecorder.pickMime(); this.standby = []; this.kept = null; this.timer = 0;
  }
  get ok() { return !!this.mime; }
  now() { return performance.now() / 1000; }
  begin() { if (!this.ok) return; this.cycle(); this.timer = setInterval(() => this.cycle(), 400); }
  make() {
    const r = { rec: new MediaRecorder(this.stream, { mimeType: this.mime, videoBitsPerSecond: this.bitrate }), chunks: [], t0: this.now() };
    r.rec.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
    r.rec.start();
    return r;
  }
  drop(r) { r.rec.onstop = null; try { r.rec.stop(); } catch {} }
  // between rallies: always have a recording that is at least `preroll` seconds old
  cycle() {
    if (this.kept) return;
    const t = this.now();
    this.standby = this.standby.filter((r) => (t - r.t0 > 2 * this.preroll + 0.5 ? (this.drop(r), false) : true));
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
      const blob = new Blob(k.chunks, { type: this.mime.split(";")[0] });
      this.onClip?.({ n: k.n, blob, mime: blob.type, preroll: +(k.rallyAt - k.t0).toFixed(2), duration: +(this.now() - k.t0).toFixed(2) });
    };
    try { k.rec.stop(); } catch {}
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
