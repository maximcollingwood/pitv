import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { ChannelDirectory } from "../src/channels.js";
import { createApp } from "../src/app.js";
import type { ProcessRunner } from "../src/process-runner.js";

const CHANNEL = "@bhakticharuswami";
const LIVE = "aaaaaaaaaaa", OLD = "bbbbbbbbbbb", FIRST = "ccccccccccc", SECOND = "ddddddddddd";
/** yt-dlp's quick listing of a channel's tabs; `live` decides whether its stream is on. */
function youtube(options: { live?: () => boolean; streams?: boolean; failing?: boolean } = {}) {
  const calls: string[] = [];
  const runner: ProcessRunner = async (_command, args) => {
    const url = args.at(-1)!;
    calls.push(url.split("/").pop()!);
    assert.ok(args.includes("--flat-playlist") && args.includes("--dump-single-json"));
    if (options.failing) throw new Error("ERROR: [youtube:tab] @bhakticharuswami: Unable to download API page: HTTP Error 404: Not Found");
    const base = { channel: "HH Bhakti Charu Swami", channel_id: "UC7wHMnwgzY11p6-6sp4njrQ" };
    if (url.endsWith("/videos")) return JSON.stringify({ ...base, title: "HH Bhakti Charu Swami - Videos", entries: [
      { id: FIRST, title: "Srimad Bhagavatam class", duration: 3725 }, { id: SECOND, title: "Kirtan", duration: 610.0 }, { id: "not-an-id", title: "?" }] });
    if (url.endsWith("/streams")) {
      if (options.streams === false) throw new Error("ERROR: [youtube:tab] @bhakticharuswami: This channel does not have a streams tab");
      return JSON.stringify({ ...base, entries: [...(options.live?.() ? [{ id: LIVE, title: "Mangala arati, live from Mayapur", live_status: "is_live" }] : []),
        { id: OLD, title: "Last week's festival", live_status: "was_live", duration: 7200 }] });
    }
    if (url.endsWith("/playlists")) return JSON.stringify({ ...base, entries: [{ id: "PLJsKzhb-1q84", title: "Remembering Maharaj", ie_key: "YoutubeTab" }] });
    throw new Error(`unexpected ${url}`);
  };
  return { runner, calls };
}

test("a channel lists its live stream, latest videos and playlists, and names itself", async () => {
  const { runner, calls } = youtube({ live: () => true });
  const titles: [string, string][] = [];
  const channels = new ChannelDirectory({ runner, onTitle: (url, title) => titles.push([url, title]) });
  assert.equal(channels.get(CHANNEL).status, "loading", "the first look answers at once");
  const channel = await channels.load(CHANNEL);
  assert.equal(channel.status, "ready");
  assert.equal(channel.url, "https://www.youtube.com/@bhakticharuswami");
  assert.equal(channel.title, "HH Bhakti Charu Swami");
  assert.deepEqual(channel.live, [{ id: LIVE, title: "Mangala arati, live from Mayapur", duration: null }]);
  assert.deepEqual(channel.videos, [{ id: FIRST, title: "Srimad Bhagavatam class", duration: 3725 }, { id: SECOND, title: "Kirtan", duration: 610 }]);
  assert.deepEqual(channel.playlists, [{ id: "PLJsKzhb-1q84", title: "Remembering Maharaj" }]);
  assert.deepEqual(titles, [["https://www.youtube.com/@bhakticharuswami", "HH Bhakti Charu Swami"]]);
  assert.deepEqual(calls.sort(), ["playlists", "streams", "videos"]);
});

test("a channel's lists are kept for an hour, while whether it is live is read again every minute and a half", async () => {
  let live = false;
  const { runner, calls } = youtube({ live: () => live });
  const channels = new ChannelDirectory({ runner, liveMs: 30 });
  await channels.load(CHANNEL);
  assert.deepEqual(channels.get(CHANNEL).live, []);
  calls.length = 0;
  live = true;
  await new Promise(resolve => setTimeout(resolve, 40));
  channels.get(CHANNEL);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(calls, ["streams"], "only the live tab is read again");
  assert.equal(channels.get(CHANNEL).live[0].id, LIVE);
});

test("a channel without a live tab has no live stream, and one YouTube refuses shows the error", async () => {
  const quiet = new ChannelDirectory({ runner: youtube({ streams: false }).runner });
  const channel = await quiet.load(CHANNEL);
  assert.equal(channel.status, "ready");
  assert.deepEqual(channel.live, []);
  assert.equal(channel.videos.length, 2);
  const failing = new ChannelDirectory({ runner: youtube({ failing: true }).runner });
  const failed = await failing.load(CHANNEL);
  assert.equal(failed.status, "error");
  assert.match(failed.error ?? "", /HTTP Error 404/);
  assert.equal(failing.get(CHANNEL, true).status, "loading", "asking again shows that it is trying");
});

test("channel items open a channel on the TV, and channel and live items are named from the channel", async () => {
  const path = mkdtempSync(join(tmpdir(), "pitv-backend-test-"));
  const { runner } = youtube({ live: () => true });
  const { app } = createApp({ dbPath: join(path, "library.db"), seed: false, logger: false, startWorker: false, adminPin: "1234", channels: { runner } });
  try {
    const headers = { authorization: `Bearer ${(await app.inject({ method: "POST", url: "/api/admin/login", payload: { pin: "1234" } })).json().token}` };
    const section = (await app.inject({ method: "POST", url: "/api/admin/sections", headers, payload: { type: "media", name: "Watch" } })).json();
    const add = async (youtube_url: string) => (await app.inject({ method: "POST", url: `/api/admin/sections/${section.id}/items`, headers, payload: { youtube_url } })).json();
    assert.equal((await add("https://youtube.com/@bhakticharuswami/videos")).youtube_url, "https://www.youtube.com/@bhakticharuswami");
    await add("https://www.youtube.com/@bhakticharuswami/live");
    await add("https://youtu.be/dQw4w9WgXcQ");
    await add("https://www.youtube.com/playlist?list=PLexample");
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/background/tracks", headers, payload: { youtube_url: "https://www.youtube.com/@bhakticharuswami" } })).statusCode, 400);
    const kinds = () => app.inject("/api/library").then(response => (response.json().items[String(section.id)] as { youtube_url: string; kind: string; title: string }[]));
    assert.deepEqual((await kinds()).map(item => item.kind).sort(), ["channel", "live", "playlist", "video"]);
    const first = await app.inject("/api/channel?url=" + encodeURIComponent("https://www.youtube.com/@bhakticharuswami"));
    assert.equal(first.statusCode, 200);
    for (let i = 0; i < 50 && (await app.inject("/api/channel?url=https://www.youtube.com/@bhakticharuswami")).json().status !== "ready"; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const channel = (await app.inject("/api/channel?url=https://www.youtube.com/@bhakticharuswami")).json();
    assert.equal(channel.live[0].id, LIVE);
    const titles = Object.fromEntries((await kinds()).map(item => [item.kind, item.title]));
    assert.equal(titles.channel, "HH Bhakti Charu Swami");
    assert.equal(titles.live, "HH Bhakti Charu Swami · Live");
    assert.equal((await app.inject("/api/channel?url=https://youtu.be/dQw4w9WgXcQ")).statusCode, 400);
  } finally {
    await app.close();
    const target = resolve(path);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep));
    rmSync(target, { recursive: true, force: true });
  }
});
