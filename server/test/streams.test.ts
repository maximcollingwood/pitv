import { test } from "node:test";
import assert from "node:assert/strict";
import type { Readable } from "node:stream";
import { StreamError, StreamResolver, type Fetcher } from "../src/streams.js";
import type { ProcessRunner } from "../src/process-runner.js";

const VIDEO = "dQw4w9WgXcQ";
const URL = `https://www.youtube.com/watch?v=${VIDEO}`;
const SIZE = 100_000, CHUNK = 16_384;
const content = Buffer.from(Array.from({ length: SIZE }, (_, i) => (i * 7) % 251));

/** yt-dlp's answer: separate H.264 picture and AAC sound; `token` tells lookups apart. */
function lookups(options: { clen?: boolean } = {}) {
  let calls = 0;
  const runner: ProcessRunner = async (_command, args) => {
    calls++;
    assert.ok(args.includes("--no-playlist") && args.includes("--dump-single-json"));
    assert.match(args[args.indexOf("--format") + 1], /^bv\*\[vcodec\^=avc1\]\[height<=1080\]\[fps<=30\]/);
    assert.equal(args.at(-1), URL);
    const query = `expire=4102444800&token=${calls}${options.clen === false ? "" : `&clen=${SIZE}`}`;
    return JSON.stringify({ id: VIDEO, title: "A talk", duration: 61.5, requested_formats: [
      { url: `https://media.example/video?${query}`, vcodec: "avc1.640028", acodec: "none", ext: "mp4", protocol: "https", http_headers: { "User-Agent": "Test agent", Accept: "*/*" } },
      { url: `https://media.example/audio?${query}`, vcodec: "none", acodec: "mp4a.40.2", ext: "m4a", protocol: "https" }] });
  };
  return { runner, calls: () => calls };
}
/** YouTube's media server: honours ranges; `behaviour` can refuse or break a request. */
function upstream(behaviour: (request: { url: URL; from: number; to: number; index: number }) => "ok" | "refuse" | "break" | "stall" = () => "ok") {
  const requests: { url: string; from: number; to: number; agent?: string }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range)!.map(Number);
    requests.push({ url, from, to, agent: init.headers["User-Agent"] });
    const action = behaviour({ url: new globalThis.URL(url), from, to, index: requests.length - 1 });
    if (action === "refuse") return new Response("expired", { status: 403 });
    const last = Math.min(to, SIZE - 1);
    const body = content.subarray(from, last + 1);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (action === "stall" && sent) return new Promise<void>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
        if (action === "break" && sent) { controller.error(new Error("connection reset")); return; }
        if (sent >= body.length) { controller.close(); return; }
        const piece = body.subarray(sent, sent + 4096);
        sent += piece.length;
        controller.enqueue(piece);
      },
    });
    return new Response(stream, { status: 206, headers: { "Content-Range": `bytes ${from}-${last}/${SIZE}`, "Content-Type": "video/mp4" } });
  };
  return { fetcher, requests };
}
async function read(body: Readable | undefined) {
  const parts: Buffer[] = [];
  for await (const part of body!) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}

test("a video is looked up once, shared between requests, and looked up again when asked", async () => {
  const { runner, calls } = lookups();
  const titles: string[] = [];
  const streams = new StreamResolver({ runner, onResolved: (_url, title) => titles.push(title) });
  const [first, second] = await Promise.all([streams.resolve(`https://youtu.be/${VIDEO}`), streams.resolve(URL)]);
  assert.equal(calls(), 1);
  assert.deepEqual(first, { id: VIDEO, title: "A talk", duration: 61.5, live: false, video: `/api/stream/${VIDEO}/video`, audio: `/api/stream/${VIDEO}/audio`, userAgent: null, headers: {}, hlsBitrate: null });
  assert.deepEqual(second, first);
  assert.equal(streams.knownTitle(URL), "A talk");
  await streams.resolve(URL); assert.equal(calls(), 1);
  await streams.resolve(URL, true); assert.equal(calls(), 2);
  assert.deepEqual(titles, ["A talk", "A talk"]);
  await assert.rejects(streams.resolve("https://www.youtube.com/playlist?list=PLexample"), (error: StreamError) => error.status === 400);
  await assert.rejects(streams.resolve("https://example.com/watch?v=dQw4w9WgXcQ"), (error: StreamError) => error.status === 400);
});

test("YouTube's refusal reaches the screen as a readable message, and a live video opens directly", async () => {
  const failing = new StreamResolver({ runner: async () => { throw new Error(`[youtube] Extracting URL\nERROR: [youtube] ${VIDEO}: Video unavailable. This video is private`); } });
  await assert.rejects(failing.resolve(URL), (error: StreamError) => error.status === 502 && error.message === "Video unavailable. This video is private");
  const bot = new StreamResolver({ runner: async () => { throw new Error(`ERROR: [youtube] ${VIDEO}: Sign in to confirm you’re not a bot`); } });
  await assert.rejects(bot.resolve(URL), /prove it is not a bot/);
  const live = new StreamResolver({ runner: async () => JSON.stringify({ id: VIDEO, title: "Live", is_live: true, url: "https://manifest.example/live.m3u8", protocol: "m3u8_native", vcodec: "avc1", acodec: "mp4a", http_headers: { "User-Agent": "Agent", Referer: "https://www.youtube.com/" } }) });
  assert.deepEqual(await live.resolve(URL), { id: VIDEO, title: "Live", duration: null, live: true, video: "https://manifest.example/live.m3u8", audio: null, userAgent: "Agent", headers: { Referer: "https://www.youtube.com/" }, hlsBitrate: null });
});

test("a channel's live address plays its current stream from YouTube's master playlist, and says when it is off air", async () => {
  let live = true, calls = 0;
  const runner: ProcessRunner = async (_command, args) => {
    calls++;
    assert.equal(args.at(-1), "https://www.youtube.com/@LofiGirl/live");
    if (!live) throw new Error("ERROR: [youtube:tab] @LofiGirl: The channel is not currently live");
    return JSON.stringify({ id: "jfKfPfyJRdk", title: "lofi hip hop radio", is_live: true, requested_formats: [
      { url: "https://manifest.example/hls_playlist/itag/270/index.m3u8", manifest_url: "https://manifest.example/hls_variant/index.m3u8",
        vcodec: "avc1.640028", acodec: "none", protocol: "m3u8_native", tbr: 5420.722, http_headers: { "User-Agent": "Agent" } },
      { url: "https://manifest.example/hls_playlist/itag/234/index.m3u8", vcodec: "none", acodec: "mp4a.40.2", protocol: "m3u8_native" }] });
  };
  const titles: string[] = [];
  const streams = new StreamResolver({ runner, onResolved: (_url, title) => titles.push(title) });
  const stream = await streams.resolve("https://www.youtube.com/@LofiGirl/live");
  assert.deepEqual(stream, { id: "jfKfPfyJRdk", title: "lofi hip hop radio", duration: null, live: true, video: "https://manifest.example/hls_variant/index.m3u8",
    audio: null, userAgent: "Agent", headers: {}, hlsBitrate: 5421722 });
  await streams.resolve("https://youtube.com/@LofiGirl/live");
  streams.warm("https://www.youtube.com/@LofiGirl/live");
  assert.equal(calls, 1, "the live address names its stream for a minute");
  assert.deepEqual(titles, [], "a broadcast's title does not rename the channel's tile");
  live = false;
  await assert.rejects(streams.resolve("https://www.youtube.com/@LofiGirl/live", true),
    (error: StreamError) => error.status === 404 && error.code === "offair" && error.message === "Nothing is streaming on this channel at the moment.");
  await assert.rejects(streams.resolve("https://www.youtube.com/@LofiGirl"), (error: StreamError) => error.status === 400);
});

test("browsing warms lookups in the background, newest first, without repeating them", async () => {
  const { runner, calls } = lookups();
  const streams = new StreamResolver({ runner });
  streams.warm(URL); streams.warm(URL); streams.warm("not a link");
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls(), 1);
  await streams.resolve(URL);
  assert.equal(calls(), 1, "a warmed video opens without another lookup");
});

test("the relay serves ranges, fetching in pieces YouTube sends at full speed", async () => {
  const { runner } = lookups();
  const { fetcher, requests } = upstream();
  const streams = new StreamResolver({ runner, fetcher, chunkBytes: CHUNK });
  const whole = await streams.relay(VIDEO, "video", undefined, false, new AbortController().signal);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers["Content-Length"], String(SIZE));
  assert.equal(whole.headers["Content-Type"], "video/mp4");
  assert.ok((await read(whole.body)).equals(content));
  assert.ok(requests.every(request => request.to - request.from + 1 <= CHUNK), "no request asks for more than one piece");
  assert.equal(requests.length, Math.ceil(SIZE / CHUNK));
  assert.ok(requests.every(request => request.agent === "Test agent"));
  const part = await streams.relay(VIDEO, "audio", "bytes=50000-", false, new AbortController().signal);
  assert.equal(part.status, 206);
  assert.equal(part.headers["Content-Range"], `bytes 50000-${SIZE - 1}/${SIZE}`);
  assert.equal(part.headers["Content-Type"], "audio/mp4");
  assert.ok((await read(part.body)).equals(content.subarray(50000)));
  assert.ok(requests.at(-1)!.url.startsWith("https://media.example/audio"));
  const before = requests.length;
  const head = await streams.relay(VIDEO, "video", "bytes=10-19", true, new AbortController().signal);
  assert.deepEqual([head.status, head.headers["Content-Length"], head.body], [206, "10", undefined]);
  assert.equal(requests.length, before, "the length in the address answers a HEAD without asking YouTube");
  assert.equal((await streams.relay(VIDEO, "video", `bytes=${SIZE}-`, false, new AbortController().signal)).status, 416);
  await assert.rejects(streams.relay(VIDEO, "subtitles", undefined, false, new AbortController().signal), (error: StreamError) => error.status === 404);
  await assert.rejects(streams.relay("../../etc", "video", undefined, false, new AbortController().signal), (error: StreamError) => error.status === 404);
});

test("the relay learns the length from YouTube when the address does not carry it", async () => {
  const { runner } = lookups({ clen: false });
  const { fetcher } = upstream();
  const streams = new StreamResolver({ runner, fetcher, chunkBytes: CHUNK });
  const relayed = await streams.relay(VIDEO, "video", "bytes=0-", false, new AbortController().signal);
  assert.equal(relayed.headers["Content-Range"], `bytes 0-${SIZE - 1}/${SIZE}`);
  assert.ok((await read(relayed.body)).equals(content));
});

test("an address YouTube refuses mid-stream is looked up again, and a broken piece resumes where it stopped", async () => {
  const { runner, calls } = lookups();
  const { fetcher, requests } = upstream(({ url, from, index }) =>
    url.searchParams.get("token") === "1" && from >= 3 * CHUNK ? "refuse" : index === 1 ? "break" : "ok");
  const streams = new StreamResolver({ runner, fetcher, chunkBytes: CHUNK, activationMs: 0 });
  const relayed = await streams.relay(VIDEO, "video", undefined, false, new AbortController().signal);
  assert.ok((await read(relayed.body)).equals(content), "the player receives every byte once, in order");
  assert.equal(calls(), 2, "the refused address was looked up again");
  assert.ok(requests.some(request => request.from > CHUNK && request.from < 2 * CHUNK), "the broken piece was asked for again from where it stopped");
});

test("a newly issued address YouTube still refuses is asked again, without another lookup", async () => {
  const { runner, calls } = lookups();
  const { fetcher, requests } = upstream(({ index }) => index < 2 ? "refuse" : "ok");
  const streams = new StreamResolver({ runner, fetcher, chunkBytes: CHUNK });
  const relayed = await streams.relay(VIDEO, "video", undefined, false, new AbortController().signal);
  assert.ok((await read(relayed.body)).equals(content));
  assert.equal(calls(), 1, "the address was not looked up again");
  assert.deepEqual(requests.slice(0, 3).map(request => request.from), [0, 0, 0]);
});

test("a piece that stops sending is asked for again, and the player leaving stops the relay", async () => {
  const { runner } = lookups();
  const { fetcher, requests } = upstream(({ index }) => index === 1 ? "stall" : "ok");
  const streams = new StreamResolver({ runner, fetcher, chunkBytes: CHUNK, stallMs: 50 });
  const relayed = await streams.relay(VIDEO, "video", undefined, false, new AbortController().signal);
  assert.ok((await read(relayed.body)).equals(content));
  const player = new AbortController();
  const leaving = await streams.relay(VIDEO, "video", undefined, false, player.signal);
  const count = requests.length;
  for await (const _part of leaving.body!) { player.abort(); }
  assert.ok(requests.length <= count + 1, "nothing more is fetched once the player has gone");
});
