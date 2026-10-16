import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import type { TvReply, TvRequest } from "../src/tv.js";

// A Vizio SmartCast TV as the library's V505-G9 answers: pairing with the PIN it
// shows, then volume settings that change only with the current setting's hash.
function fakeTv() {
  const tv = { host: "192.168.87.94", fingerprint: "55:93:09", volume: 27, muted: false, token: "", requests: [] as TvRequest[] };
  const reply = (body: object, status = 200): TvReply => ({ status, fingerprint: tv.fingerprint, body });
  const ok = (extra: object = {}) => reply({ STATUS: { RESULT: "SUCCESS", DETAIL: "Success" }, ...extra });
  const transport = async (request: TvRequest): Promise<TvReply> => {
    tv.requests.push(request);
    if (request.host !== tv.host) throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    if (request.fingerprint && request.fingerprint !== tv.fingerprint) throw Object.assign(new Error("another device"), { code: "EFINGERPRINT" });
    const { method, path, auth } = request, body = request.body as Record<string, any>;
    if (method === "GET" && path === "/state/device/deviceinfo")
      return ok({ ITEMS: [{ VALUE: { MODEL_NAME: "V505-G9", CAST_NAME: "Bhaktivedanta Library", SYSTEM_INFO: { SERIAL_NUMBER: "03LINIXXKV03697" } } }] });
    if (method === "PUT" && path === "/pairing/start") return ok({ ITEM: { PAIRING_REQ_TOKEN: 42, CHALLENGE_TYPE: 1 } });
    if (method === "PUT" && path === "/pairing/pair") {
      if (body.RESPONSE_VALUE !== "7806" || body.PAIRING_REQ_TOKEN !== 42) return reply({ STATUS: { RESULT: "INVALID_PARAMETER" } }, 400);
      tv.token = "tv-key"; return ok({ ITEM: { AUTH_TOKEN: tv.token } });
    }
    if (!tv.token || auth !== tv.token) return reply({ STATUS: { RESULT: "REQUIRES_PAIRING", DETAIL: "Pairing is required" } }, 403);
    if (method === "GET" && path === "/menu_native/dynamic/tv_settings/audio")
      return ok({ ITEMS: [{ CNAME: "tv_speakers", VALUE: "On", HASHVAL: 1 }, { CNAME: "volume", VALUE: tv.volume, HASHVAL: 1000 + tv.volume },
        { CNAME: "mute", VALUE: tv.muted ? "On" : "Off", HASHVAL: tv.muted ? 2 : 3 }] });
    if (method === "PUT" && path === "/menu_native/dynamic/tv_settings/audio/volume") {
      if (body.REQUEST !== "MODIFY" || body.HASHVAL !== 1000 + tv.volume) return reply({ STATUS: { RESULT: "HASHVAL_ERROR" } });
      tv.volume = body.VALUE; return ok();
    }
    if (method === "PUT" && path === "/key_command/") {
      for (const key of body.KEYLIST) {
        assert.equal(key.CODESET, 5); assert.equal(key.ACTION, "KEYPRESS");
        if (key.CODE === 1) tv.volume = Math.min(100, tv.volume + 1);
        else if (key.CODE === 0) tv.volume = Math.max(0, tv.volume - 1);
        else tv.muted = key.CODE === 3 ? true : key.CODE === 2 ? false : !tv.muted;
      }
      return ok();
    }
    return reply({ STATUS: { RESULT: "URI_NOT_FOUND" } }, 404);
  };
  return { tv, transport };
}

test("the phone remote controls the TV's own volume once PiTV is paired with the TV", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pitv-tv-test-"));
  const { tv, transport } = fakeTv();
  const file = join(dir, "tv.json");
  const { app } = createApp({ dbPath: join(dir, "library.db"), seed: false, logger: false, startWorker: false, adminPin: "1234",
    system: { requestPath: join(dir, "system/request"), updateLogPath: join(dir, "update.log"), versionPath: join(dir, "version.json"), rangePath: join(dir, "hdmi-range") },
    tv: { file, transport, candidates: async () => ["192.168.87.50", tv.host] } });
  try {
    const call = async (method: "GET" | "POST" | "DELETE", url: string, payload?: object, headers?: Record<string, string>) => {
      const response = await app.inject({ method, url, payload, headers });
      return { status: response.statusCode, body: response.json() };
    };
    assert.deepEqual((await call("GET", "/api/tv")).body, { paired: false, available: false, level: 0, muted: false });
    assert.equal((await call("POST", "/api/tv/volume", { level: 30 })).status, 409);

    const headers = { authorization: `Bearer ${(await call("POST", "/api/admin/login", { pin: "1234" })).body.token}` };
    const started = await call("POST", "/api/admin/system/tv/pair", {}, headers);
    assert.equal(started.status, 200);
    assert.deepEqual(started.body.pairing, { model: "V505-G9", name: "Bhaktivedanta Library", host: tv.host }, "the TV is found among the addresses that answer");
    assert.equal((await call("POST", "/api/admin/system/tv/pair", { pin: "1234" }, headers)).status, 400);
    assert.equal((await call("POST", "/api/admin/system/tv/pair", { pin: "78" }, headers)).status, 400);
    const paired = await call("POST", "/api/admin/system/tv/pair", { pin: "7806" }, headers);
    assert.equal(paired.body.paired, true);
    assert.equal(paired.body.pairing, null);
    assert.ok(existsSync(file));
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600, "the TV's key is readable only by the service");
    assert.ok(!JSON.stringify((await call("GET", "/api/admin/settings", undefined, headers)).body).includes("tv-key"));
    const system = (await call("GET", "/api/admin/system", undefined, headers)).body;
    assert.equal(system.tv.paired, true); assert.equal(system.tv.available, true); assert.equal(system.tv.model, "V505-G9");

    assert.deepEqual((await call("GET", "/api/tv")).body, { paired: true, available: true, level: 27, muted: false });
    assert.deepEqual((await call("GET", "/api/library")).body.tv, { available: true, level: 27, muted: false }, "the screen learns the TV's volume with every snapshot");
    assert.equal((await call("POST", "/api/tv/volume", { level: 35 })).body.level, 35);
    assert.equal(tv.volume, 35);
    assert.equal((await call("POST", "/api/tv/volume", { step: 2 })).body.level, 37, "steps are the TV's own volume keys");
    assert.equal((await call("POST", "/api/tv/volume", { step: -3 })).body.level, 34);
    assert.equal((await call("POST", "/api/tv/volume", { muted: true })).body.muted, true);
    assert.equal((await call("POST", "/api/tv/volume", { muted: false })).body.muted, false);
    for (const bad of [{ level: 101 }, { level: -1 }, { step: 11 }, { step: 0.5 }, {}]) assert.equal((await call("POST", "/api/tv/volume", bad)).status, 400);
    tv.volume = 20; // the TV remote changed it
    assert.equal((await call("GET", "/api/tv")).body.level, 20);

    // The TV gets a new address: PiTV finds it again by its serial number and
    // never sends its key to the device now at the old address.
    tv.host = "192.168.87.95";
    const before = tv.requests.length;
    assert.equal((await call("POST", "/api/tv/volume", { level: 22 })).body.level, 22);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).host, "192.168.87.95");
    assert.ok(tv.requests.slice(before).every(request => !request.auth || request.host === tv.host || request.fingerprint === tv.fingerprint));
    tv.fingerprint = "another-device";
    assert.equal((await call("GET", "/api/tv")).body.available, false, "a different device at the TV's address gets no key");

    assert.equal((await call("DELETE", "/api/admin/system/tv", undefined, headers)).body.paired, false);
    assert.ok(!existsSync(file));
    assert.equal((await call("GET", "/api/tv")).body.paired, false);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
