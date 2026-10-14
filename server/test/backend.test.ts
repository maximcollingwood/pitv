import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";
import { MediaManager } from "../src/media.js";
import { normalizeYouTube } from "../src/youtube.js";
import { runProcess, type ProcessRunner } from "../src/process-runner.js";

const VIDEO = "dQw4w9WgXcQ";
const VIDEO2 = "aqz-KE-bpKQ";
const URL = `https://www.youtube.com/watch?v=${VIDEO}`;
function temporary() {
  const path = mkdtempSync(join(tmpdir(), "pitv-backend-test-"));
  return { path, cleanup() {
    const target = resolve(path);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && target.includes("pitv-backend-test-"));
    rmSync(target, { recursive: true, force: true });
  } };
}
const successfulRunner: ProcessRunner = async (_command, args, { signal, onLine }) => {
  assert.equal(signal.aborted, false);
  if (args.includes("-show_entries")) return JSON.stringify({ format: { duration: "12.0" }, streams: [{ codec_type: "audio" }, { codec_type: "video" }] });
  assert.ok(args.includes("--ignore-config"));
  assert.match(args[args.indexOf("--js-runtimes") + 1], /^node:/);
  if (args.includes("--flat-playlist")) return JSON.stringify({ title: "Prepared playlist", entries: [{ id: VIDEO, title: "First" }, { id: VIDEO2, title: "Second" }] });
  const template = args[args.indexOf("--output") + 1];
  mkdirSync(dirname(template), { recursive: true });
  writeFileSync(template.replace("%(ext)s", args.includes("--extract-audio") ? "m4a" : "mp4"), "0123456789");
  writeFileSync(join(dirname(template), "payload.info.json"), JSON.stringify({ title: "Prepared title" }));
  onLine?.("PITV_PROGRESS:50.0%");
  return "";
};

test("database initialization is additive and preserves edited/deleted starter content", () => {
  const temp = temporary();
  try {
    let db = openDatabase(join(temp.path, "library.db"));
    db.prepare("UPDATE sections SET name='Personal name'").run();
    db.prepare("DELETE FROM faqs").run();
    db.prepare("INSERT INTO settings(key,value) VALUES('title','My library')").run();
    db.close();
    db = openDatabase(join(temp.path, "library.db"));
    assert.equal((db.prepare("SELECT value FROM settings WHERE key='title'").get() as { value: string }).value, "My library");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM faqs").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT name FROM sections").get() as { name: string }).name, "Personal name");
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='media_assets'").get());
    db.close();
  } finally { temp.cleanup(); }
});

test("legacy ordering columns are added in place without replacing content", () => {
  const temp = temporary();
  try {
    let db = openDatabase(join(temp.path, "library.db"), false);
    db.prepare("INSERT INTO sections(id,type,name) VALUES(7,'articles','Existing collection')").run();
    db.prepare("INSERT INTO articles(id,section_id,title,body) VALUES(9,7,'Existing title','Existing text')").run();
    for (const table of ["sections", "articles", "faqs", "background_tracks"]) db.exec(`ALTER TABLE ${table} DROP COLUMN position`);
    db.close();
    db = openDatabase(join(temp.path, "library.db"), false);
    assert.deepEqual(db.prepare("SELECT id,section_id,title,body,position FROM articles").get(), { id: 9, section_id: 7, title: "Existing title", body: "Existing text", position: 0 });
    for (const table of ["sections", "articles", "faqs", "background_tracks"]) assert.ok((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(column => column.name === "position"));
    db.close();
  } finally { temp.cleanup(); }
});

test("native API, paste-only imports, admin compatibility, validated sources, and ranged playback", async () => {
  const temp = temporary();
  const { app, media } = createApp({ dbPath: join(temp.path, "library.db"), seed: false, logger: false, startWorker: false, adminPin: "1234", media: { runner: successfulRunner, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0 } });
  try {
    const login = await app.inject({ method: "POST", url: "/api/admin/login", payload: { pin: "1234" } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    assert.equal((await app.inject("/api/admin/media")).statusCode, 401);
    const section = (await app.inject({ method: "POST", url: "/api/admin/sections", headers, payload: { type: "media", name: "Watch" } })).json();
    const created = await app.inject({ method: "POST", url: `/api/admin/sections/${section.id}/items`, headers, payload: { youtube_url: `https://youtu.be/${VIDEO}` } });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().youtube_url, URL);
    assert.equal(created.json().title, "");
    assert.equal(media.get(`video-${VIDEO}`)?.status, "queued");
    assert.equal((await app.inject(`/api/media/video-${VIDEO}/file`)).statusCode, 404);
    await media.tick();
    assert.equal(media.get(`video-${VIDEO}`)?.status, "ready");
    const library = (await app.inject("/api/library")).json();
    assert.equal(library.items[String(section.id)][0].title, "Prepared title");
    assert.equal(library.config.sections[0].name, "Watch");
    assert.equal(typeof library.info.remoteUrl, "string");
    assert.equal(library.volume, 0.05);
    const range = await app.inject({ url: `/api/media/video-${VIDEO}/file`, headers: { range: "bytes=2-5" } });
    assert.equal(range.statusCode, 206); assert.equal(range.body, "2345");
    assert.equal(range.headers["content-range"], "bytes 2-5/10");
    assert.equal(range.headers["content-type"], "video/mp4");
    assert.equal((await app.inject({ url: `/api/media/video-${VIDEO}/file`, headers: { range: "bytes=-3" } })).body, "789");
    assert.equal((await app.inject({ url: `/api/media/video-${VIDEO}/file`, headers: { range: "bytes=99-" } })).statusCode, 416);
    assert.equal((await app.inject({ method: "HEAD", url: `/api/media/video-${VIDEO}/file` })).headers["content-length"], "10");
    assert.equal((await app.inject({ method: "POST", url: "/api/media/prepare", payload: { url: "http://127.0.0.1/private", kind: "video" } })).statusCode, 400);
    const sharedVideo = await app.inject({ method: "POST", url: `/api/admin/sections/${section.id}/items`, headers, payload: { youtube_url: "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLexample" } });
    assert.equal(sharedVideo.statusCode, 201); assert.equal(sharedVideo.json().is_playlist, 0);
    assert.equal(sharedVideo.json().title, "Prepared title");
    const playlist = await app.inject({ method: "POST", url: `/api/admin/sections/${section.id}/items`, headers, payload: { youtube_url: "https://youtube.com/playlist?list=PLexample" } });
    assert.equal(playlist.statusCode, 201); assert.equal(playlist.json().is_playlist, 1);
    const bg = await app.inject({ method: "POST", url: "/api/admin/background/tracks", headers, payload: { youtube_url: URL } });
    assert.equal(bg.statusCode, 201); assert.equal(media.get(`audio-${VIDEO}`)?.status, "queued");
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/background/tracks", headers, payload: { youtube_url: "https://youtube.com/playlist?list=PLexample" } })).statusCode, 400);
    const background = await app.inject({ method: "POST", url: "/api/background/state", payload: { trackId: bg.json().id, playing: true } });
    assert.equal(background.json().playing, true);
    assert.equal((await app.inject({ method: "POST", url: "/api/background/state", payload: { trackId: 999 } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/remote/press", payload: { action: "home" } })).statusCode, 200);
    const image = await app.inject({ method: "POST", url: "/api/admin/uploads/cover", headers, payload: { data: Buffer.from("image-data").toString("base64"), mime: "image/png" } });
    assert.equal((await app.inject(image.json().url)).body, "image-data");
    assert.equal((await app.inject({ method: "POST", url: "/api/device/status", remoteAddress: "192.168.1.23", payload: { title: "spoof" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/device/status", payload: { page: "player", title: "Local", playing: true } })).json().connected, true);
    assert.equal((await app.inject("/api/device/status")).json().title, "Local");
    assert.equal((await app.inject({ method: "POST", url: "/api/system/volume", payload: { level: null } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/system/volume", payload: { level: 0.23 } })).json().level, 0.23);
  } finally { await app.close(); }
  const reopened = createApp({ dbPath: join(temp.path, "library.db"), seed: false, logger: false, startWorker: false });
  try { assert.equal((await reopened.app.inject("/api/library")).json().volume, 0.23); }
  finally { await reopened.app.close(); temp.cleanup(); }
});

test("single worker, shutdown recovery, restart cleanup, failures, retries and private partials", async () => {
  const temp = temporary();
  const db = openDatabase(join(temp.path, "library.db"), false);
  const cacheDir = join(temp.path, "media");
  let calls = 0;
  const slow: ProcessRunner = async (_command, args, { signal }) => {
    calls++;
    const directory = dirname(args[args.indexOf("--output") + 1]);
    writeFileSync(join(directory, "payload.mp4.part"), "partial");
    return await new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  };
  let media = new MediaManager(db, { cacheDir, runner: slow, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0 });
  try {
    media.prepare(URL, "video");
    const tick = media.tick();
    await media.tick();
    assert.equal(calls, 1);
    assert.equal(media.file(`video-${VIDEO}`), undefined);
    await media.close(); await tick;
    assert.equal(media.get(`video-${VIDEO}`)?.status, "queued");
    const partialDir = join(cacheDir, ".work", `video-${VIDEO}`);
    mkdirSync(partialDir, { recursive: true }); writeFileSync(join(partialDir, "abandoned.part"), "abandoned");
    db.prepare("UPDATE media_assets SET status='downloading'").run();
    media = new MediaManager(db, { cacheDir, runner: async () => { throw new Error("YouTube is unavailable"); }, maxAttempts: 1, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0 });
    assert.equal(existsSync(partialDir), false);
    await media.tick();
    assert.equal(media.get(`video-${VIDEO}`)?.status, "error");
    assert.match(media.get(`video-${VIDEO}`)?.error ?? "", /unavailable/);
    assert.equal(media.get(`video-${VIDEO}`)?.playbackUrl, null);
    await media.close();
    media = new MediaManager(db, { cacheDir, runner: successfulRunner, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0 });
    assert.equal(media.prepare(URL, "video", true).status, "queued");
    await media.tick(); assert.equal(media.get(`video-${VIDEO}`)?.status, "ready");
  } finally { await media.close(); db.close(); temp.cleanup(); }
});

test("playlist discovery caches ordered entries and fills optional titles without further network work", async () => {
  const temp = temporary();
  const db = openDatabase(join(temp.path, "library.db"), false);
  let calls = 0;
  const media = new MediaManager(db, { cacheDir: join(temp.path, "media"), runner: async (...args) => { calls++; return successfulRunner(...args); }, playlistPrefetch: 1, queueLimit: 2 });
  try {
    db.prepare("INSERT INTO media_items(section_id,title,youtube_url,is_playlist) VALUES(1,'','https://www.youtube.com/playlist?list=PLexample',1)").run();
    assert.equal(media.playlist("PLexample").status, "queued");
    await media.tick();
    const cached = media.playlist("PLexample");
    assert.equal(cached.status, "ready"); assert.equal(cached.source, "cache");
    assert.deepEqual(cached.videos.map(v => v.id), [VIDEO, VIDEO2]);
    assert.equal(calls, 1);
    assert.equal((db.prepare("SELECT title FROM media_items").get() as { title: string }).title, "Prepared playlist");
    assert.equal(media.get(`video-${VIDEO}`)?.status, "queued");
    assert.equal(media.get(`video-${VIDEO2}`), undefined);
    assert.equal(media.playlist("PLexample", true).status, "queued");
    assert.throws(() => media.prepare(`https://youtu.be/${VIDEO2}`, "video"), /queue is full/);
  } finally { await media.close(); db.close(); temp.cleanup(); }
});

test("admin preparation lists failed playlist discovery without reprioritizing or retrying it", async () => {
  const temp = temporary();
  const { app, db, media } = createApp({ dbPath: join(temp.path, "library.db"), seed: false, logger: false, startWorker: false, adminPin: "1234",
    media: { runner: async () => { throw new Error("Playlist is unavailable"); }, maxAttempts: 1 } });
  try {
    const login = await app.inject({ method: "POST", url: "/api/admin/login", payload: { pin: "1234" } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    media.queueSource("https://youtube.com/playlist?list=PLexample", "video");
    await media.tick();
    const before = db.prepare("SELECT * FROM media_playlists").get();
    const response = await app.inject({ url: "/api/admin/media", headers });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().assets, []);
    assert.deepEqual(response.json().playlists, [{ id: "PLexample", title: "", sourceUrl: "https://www.youtube.com/playlist?list=PLexample", status: "error", error: "Playlist is unavailable", videoCount: 0 }]);
    assert.deepEqual(db.prepare("SELECT * FROM media_playlists").get(), before);
    assert.equal((await app.inject("/api/playlist?list=PLexample&retry=1")).json().status, "queued");
  } finally { await app.close(); temp.cleanup(); }
});

test("extractor discovers system ffmpeg unless a custom filesystem path is configured", async () => {
  const temp = temporary();
  const db = openDatabase(join(temp.path, "library.db"), false);
  let expectedPath: string | undefined;
  const runner: ProcessRunner = async (command, args, options) => {
    if (!args.includes("-show_entries")) {
      const flag = args.indexOf("--ffmpeg-location");
      if (expectedPath) assert.equal(args[flag + 1], expectedPath);
      else assert.equal(flag, -1);
    }
    return successfulRunner(command, args, options);
  };
  let media = new MediaManager(db, { cacheDir: join(temp.path, "media"), runner, ffmpegPath: "", maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0 });
  try {
    media.prepare(URL, "audio"); await media.tick();
    assert.equal(media.get(`audio-${VIDEO}`)?.status, "ready");
    await media.close();
    expectedPath = join(temp.path, "custom-tools", "ffmpeg");
    media = new MediaManager(db, { cacheDir: join(temp.path, "media"), runner, ffmpegPath: expectedPath, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0 });
    media.prepare(URL, "video"); await media.tick();
    assert.equal(media.get(`video-${VIDEO}`)?.status, "ready");
  } finally { await media.close(); db.close(); temp.cleanup(); }
});

test("timeout retries are bounded and oversized downloads never become playable", async () => {
  const temp = temporary();
  const db = openDatabase(join(temp.path, "library.db"), false);
  let media = new MediaManager(db, { cacheDir: join(temp.path, "media"), timeoutMs: 20, maxAttempts: 2, retryBaseMs: 1, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0,
    runner: async (_command, _args, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true })) });
  try {
    media.prepare(URL, "audio"); await media.tick();
    assert.equal(media.get(`audio-${VIDEO}`)?.status, "queued");
    db.prepare("UPDATE media_assets SET next_attempt=0").run();
    await media.tick(); assert.equal(media.get(`audio-${VIDEO}`)?.status, "error");
    await media.close();
    media = new MediaManager(db, { cacheDir: join(temp.path, "media"), runner: successfulRunner, maxAttempts: 1, maxAssetBytes: 5, cacheLimitBytes: 1000, minFreeBytes: 0 });
    media.prepare(URL, "video"); await media.tick();
    assert.equal(media.get(`video-${VIDEO}`)?.status, "error");
    assert.match(media.get(`video-${VIDEO}`)?.error ?? "", /size limit/);
    assert.equal(media.file(`video-${VIDEO}`), undefined);
    assert.equal(media.list().cacheBytes, 0);
  } finally { await media.close(); db.close(); temp.cleanup(); }
});

test("YouTube normalization rejects forged hosts and shell-shaped URLs", () => {
  assert.equal(normalizeYouTube(`https://youtu.be/${VIDEO}?t=10`).url, URL);
  assert.equal(normalizeYouTube(`https://www.youtube.com/shorts/${VIDEO}`).videoId, VIDEO);
  assert.equal(normalizeYouTube(`${URL}&list=PLexample`).url, URL);
  assert.equal(normalizeYouTube(`${URL}&list=PLexample`, true).url, "https://www.youtube.com/playlist?list=PLexample");
  assert.throws(() => normalizeYouTube(`https://youtube.com.evil.example/watch?v=${VIDEO}`), /Only YouTube/);
  assert.throws(() => normalizeYouTube(`https://user@youtube.com/watch?v=${VIDEO}`), /Only YouTube/);
  assert.throws(() => normalizeYouTube("--exec calc.exe"), /URL/);
  assert.throws(() => normalizeYouTube("https://youtube.com/watch?v=$(whoami)"), /Invalid/);
});

test("passive library refresh allows cache eviction while active playback leases protect files", async () => {
  const temp = temporary();
  const db = openDatabase(join(temp.path, "library.db"), false);
  const media = new MediaManager(db, { cacheDir: join(temp.path, "media"), runner: successfulRunner, maxAttempts: 1, maxAssetBytes: 100, cacheLimitBytes: 300, minFreeBytes: 0 });
  try {
    db.prepare("INSERT INTO media_items(section_id,title,youtube_url) VALUES(1,'Keep my title',?)").run(URL);
    media.prepare(URL, "video"); await media.tick();
    assert.equal((db.prepare("SELECT title FROM media_items").get() as { title: string }).title, "Keep my title");
    db.prepare("UPDATE media_assets SET accessed_at=0").run();
    media.queueExisting();
    assert.equal((db.prepare("SELECT accessed_at FROM media_assets").get() as { accessed_at: number }).accessed_at, 0);
    const release = media.lease(`video-${VIDEO}`);
    media.prepare(`https://youtu.be/${VIDEO2}`, "video"); await media.tick();
    assert.equal(media.get(`video-${VIDEO}`)?.status, "ready");
    assert.match(media.get(`video-${VIDEO2}`)?.error ?? "", /cache is full/);
    release();
    media.retry(`video-${VIDEO2}`); await media.tick();
    assert.equal(media.get(`video-${VIDEO2}`)?.status, "ready");
    assert.equal(media.get(`video-${VIDEO}`)?.status, "error");
    media.queueExisting();
    assert.equal(media.get(`video-${VIDEO}`)?.status, "error");
    assert.equal(media.list().cacheBytes, 10);
  } finally { await media.close(); db.close(); temp.cleanup(); }
});

test("selected playback and playlist discovery run ahead of passive library prefetch", async () => {
  const temp = temporary();
  const db = openDatabase(join(temp.path, "library.db"), false);
  const media = new MediaManager(db, { cacheDir: join(temp.path, "media"), runner: successfulRunner, playlistPrefetch: 0, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0 });
  try {
    media.queueSource(URL, "video");
    media.queueSource(`https://youtu.be/${VIDEO2}`, "video");
    media.queueSource("https://youtube.com/playlist?list=PLexample", "video");
    db.prepare("UPDATE media_assets SET created_at=1 WHERE key=?").run(`video-${VIDEO}`);
    media.prepare(`https://youtu.be/${VIDEO2}`, "video");
    await media.tick();
    assert.equal(media.get(`video-${VIDEO2}`)?.status, "ready");
    assert.equal(media.get(`video-${VIDEO}`)?.status, "queued");
    media.playlist("PLexample");
    await media.tick();
    assert.equal(media.playlist("PLexample").status, "ready");
    assert.equal(media.get(`video-${VIDEO}`)?.status, "queued");
    await media.tick();
    assert.equal(media.get(`video-${VIDEO}`)?.status, "ready");
  } finally { await media.close(); db.close(); temp.cleanup(); }
});

test("live device stream delivers navigation, settings, background, volume, and library changes", { timeout: 10000 }, async () => {
  const temp = temporary();
  const { app } = createApp({ dbPath: join(temp.path, "library.db"), seed: false, logger: false, startWorker: false, adminPin: "1234" });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    const response = await fetch(`${base}/api/device/events`, { signal: AbortSignal.timeout(8000) });
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    reader = response.body!.getReader();
    let buffer = "";
    const decoder = new TextDecoder();
    async function next(type: string): Promise<Record<string, any>> {
      for (;;) {
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (!frame.startsWith("data: ")) continue;
          const event = JSON.parse(frame.slice(6));
          if (event.type === type) return event;
        }
        const result = await reader!.read();
        assert.equal(result.done, false);
        buffer += decoder.decode(result.value, { stream: true });
      }
    }
    assert.equal((await next("library")).type, "library");
    await app.inject({ method: "POST", url: "/api/remote/press", payload: { action: "right" } });
    assert.equal((await next("remote")).action, "right");
    const login = await app.inject({ method: "POST", url: "/api/admin/login", payload: { pin: "1234" } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    const bg = await app.inject({ method: "POST", url: "/api/admin/background/tracks", headers, payload: { youtube_url: `${URL}&list=PLcontext` } });
    assert.equal(bg.statusCode, 201);
    assert.equal((await next("background")).tracks[0].youtube_url, URL);
    await next("library");
    await app.inject({ method: "PUT", url: "/api/admin/settings", headers, payload: { title: "My room", volume: "0.31", bg_track_id: String(bg.json().id), bg_playing: "1" } });
    assert.equal((await next("volume")).level, 0.31);
    assert.equal((await next("background")).state.playing, true);
    await next("library");
    const snapshot = (await app.inject("/api/library")).json();
    assert.equal(snapshot.config.title, "My room");
    assert.equal(snapshot.volume, 0.31);
    assert.equal(snapshot.background.state.trackId, bg.json().id);
    await app.inject({ method: "DELETE", url: `/api/admin/background/tracks/${bg.json().id}`, headers });
    assert.deepEqual((await next("background")).state, { trackId: null, playing: false });
  } finally { await reader?.cancel(); await app.close(); temp.cleanup(); }
});

test("removed or changed library links cancel pending imports while prepared files stay cached", async () => {
  const temp = temporary();
  const { app, media } = createApp({ dbPath: join(temp.path, "library.db"), seed: false, logger: false, startWorker: false, adminPin: "1234", media: { runner: successfulRunner, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0 } });
  try {
    const headers = { authorization: `Bearer ${(await app.inject({ method: "POST", url: "/api/admin/login", payload: { pin: "1234" } })).json().token}` };
    const section = (await app.inject({ method: "POST", url: "/api/admin/sections", headers, payload: { type: "media", name: "Watch" } })).json();
    const items = `/api/admin/sections/${section.id}/items`;
    const add = async (youtube_url: string) => (await app.inject({ method: "POST", url: items, headers, payload: { youtube_url } })).json();
    await add(URL);
    const duplicate = await add(`https://youtu.be/${VIDEO}`);
    const second = await add(`https://youtu.be/${VIDEO2}`);
    await app.inject({ method: "DELETE", url: `${items}/${duplicate.id}`, headers });
    assert.equal(media.get(`video-${VIDEO}`)?.status, "queued", "a link another item still uses stays queued");
    await app.inject({ method: "PUT", url: `${items}/${second.id}`, headers, payload: { youtube_url: URL } });
    assert.equal(media.get(`video-${VIDEO2}`), undefined, "replacing a link cancels the old import");
    await media.tick();
    assert.equal(media.get(`video-${VIDEO}`)?.status, "ready");

    const track = (await app.inject({ method: "POST", url: "/api/admin/background/tracks", headers, payload: { youtube_url: `https://youtu.be/${VIDEO2}` } })).json();
    assert.equal(media.get(`audio-${VIDEO2}`)?.status, "queued");
    await app.inject({ method: "DELETE", url: `/api/admin/background/tracks/${track.id}`, headers });
    assert.equal(media.get(`audio-${VIDEO2}`), undefined);

    await add("https://www.youtube.com/playlist?list=PLexample");
    await media.tick();
    assert.equal(media.get(`video-${VIDEO2}`)?.status, "queued", "playlist entries are referenced through their playlist");
    media.queueExisting();
    assert.equal(media.get(`video-${VIDEO2}`)?.status, "queued");
    await app.inject({ method: "DELETE", url: `/api/admin/sections/${section.id}`, headers });
    assert.equal(media.get(`video-${VIDEO2}`), undefined);
    assert.equal(media.get(`video-${VIDEO}`)?.status, "ready", "prepared files remain cached until evicted");
    assert.equal(media.list().playlists.length, 1);
  } finally { await app.close(); temp.cleanup(); }
});

test("library reconciliation refills when the queue drains and rewrites only changed links", async () => {
  const temp = temporary();
  const db = openDatabase(join(temp.path, "library.db"), false);
  const media = new MediaManager(db, { cacheDir: join(temp.path, "media"), runner: successfulRunner, queueLimit: 1, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0 });
  const changes = () => (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  try {
    db.prepare("INSERT INTO media_items(section_id,title,youtube_url) VALUES(1,'',?),(1,'',?)").run(`https://youtu.be/${VIDEO}?si=share`, `https://youtu.be/${VIDEO2}`);
    db.prepare("INSERT INTO background_tracks(title,youtube_url) VALUES('',?)").run(`https://youtu.be/${VIDEO}?si=share`);
    media.queueExisting();
    assert.deepEqual((db.prepare("SELECT youtube_url FROM media_items UNION ALL SELECT youtube_url FROM background_tracks").all() as { youtube_url: string }[]).map(r => r.youtube_url),
      [URL, `https://www.youtube.com/watch?v=${VIDEO2}`, URL]);
    assert.equal(media.get(`video-${VIDEO2}`), undefined, "a full queue defers the rest of the library");
    for (let i = 0; i < 3; i++) await media.tick();
    for (const key of [`video-${VIDEO}`, `video-${VIDEO2}`, `audio-${VIDEO}`]) assert.equal(media.get(key)?.status, "ready", key);
    const before = changes();
    media.queueExisting();
    assert.equal(changes(), before, "an unchanged library is reconciled without writes");
  } finally { await media.close(); db.close(); temp.cleanup(); }
});

test("download progress is published live without per-second database writes", async () => {
  const temp = temporary();
  const db = openDatabase(join(temp.path, "library.db"), false);
  const published: number[] = [];
  let stored: number | undefined;
  const runner: ProcessRunner = async (command, args, options) => {
    const output = await successfulRunner(command, args, options);
    if (!args.includes("-show_entries")) stored = (db.prepare("SELECT progress FROM media_assets").get() as { progress: number }).progress;
    return output;
  };
  const media = new MediaManager(db, { cacheDir: join(temp.path, "media"), runner, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0,
    onEvent: event => { const asset = (event as { asset?: { status: string; progress: number } }).asset; if (asset?.status === "downloading") published.push(asset.progress); } });
  try {
    media.prepare(URL, "video"); await media.tick();
    assert.ok(published.includes(50), "the extractor's progress reaches clients");
    assert.equal(stored, 0, "progress is not written to the database while downloading");
    assert.equal(media.get(`video-${VIDEO}`)?.progress, 100);
  } finally { await media.close(); db.close(); temp.cleanup(); }
});

test("video imports pick the best H.264 quality that fits the per-file limit", async () => {
  const temp = temporary();
  const db = openDatabase(join(temp.path, "library.db"), false);
  let format = "";
  const runner: ProcessRunner = async (command, args, options) => {
    if (args.includes("--format")) format = args[args.indexOf("--format") + 1];
    if (args.includes(`https://www.youtube.com/watch?v=${VIDEO2}`)) throw new Error("ERROR: [youtube] aqz-KE-bpKQ: Requested format is not available. Use --list-formats for a list of available formats");
    return successfulRunner(command, args, options);
  };
  const media = new MediaManager(db, { cacheDir: join(temp.path, "media"), runner, maxAttempts: 1, maxAssetBytes: 100, cacheLimitBytes: 1000, minFreeBytes: 0 });
  try {
    media.prepare(URL, "video"); await media.tick();
    assert.equal(media.get(`video-${VIDEO}`)?.status, "ready");
    assert.equal(format, "bv*[vcodec^=avc1][height<=1080][filesize<?90][filesize_approx<?90]+ba[ext=m4a]/b[vcodec^=avc1][ext=mp4][height<=1080][filesize<?90][filesize_approx<?90]");
    media.prepare(`https://youtu.be/${VIDEO2}`, "video"); await media.tick();
    assert.match(media.get(`video-${VIDEO2}`)?.error ?? "", /fits the 0 MB per-file limit/);
  } finally { await media.close(); db.close(); temp.cleanup(); }
});

test("process runner aborts bounded subprocesses and does not launch an already cancelled job", async () => {
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(runProcess("does-not-exist", [], { signal: cancelled.signal }), /cancelled/);
  const signal = AbortSignal.timeout(100);
  await assert.rejects(runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { signal }), /cancelled/);
  assert.equal((await runProcess(process.execPath, ["-e", "process.stdout.write('hello')"], { signal: new AbortController().signal })), "hello");
});
