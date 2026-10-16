import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { connect as tcpConnect } from "node:net";
import os from "node:os";
import { connect as tlsConnect } from "node:tls";

// Vizio SmartCast TVs (the library's V505-G9) have a local HTTPS API that sets
// and reports the TV's own volume. Over HDMI-CEC the same TV refuses volume
// commands, so this is what keeps the phone remote and the TV remote on one volume.
// The API needs a one-time pairing: the TV shows a PIN that is typed back.
const PORT = 7345;
const DEVICE_ID = `pitv-${os.hostname()}`;
const AUDIO = "/menu_native/dynamic/tv_settings/audio";

export interface TvVolume { level: number; muted: boolean }
export interface TvIdentity { model: string; name: string; serial: string }
interface TvPairing extends TvIdentity { host: string; token: string; fingerprint: string }
export interface TvRequest { host: string; method: "GET" | "PUT"; path: string; body?: unknown; auth?: string; fingerprint?: string }
export interface TvReply { status: number; body: any; fingerprint: string }
export interface TvOptions {
  /** The pairing (address, key, identity), readable only by the service user. */
  file: string;
  /** Tests replace the TV. */
  transport: (request: TvRequest) => Promise<TvReply>;
  /** Addresses that accept connections on the API port. */
  candidates: () => Promise<string[]>;
}

export class TvError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** One HTTPS exchange. The TV's certificate is Vizio's own, not publicly trusted,
 * so it is checked against the one seen at pairing before the key is sent. */
function httpsTransport({ host, method, path, body, auth, fingerprint }: TvRequest): Promise<TvReply> {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host, port: PORT, rejectUnauthorized: false, servername: "" });
    socket.setTimeout(4000, () => socket.destroy(Object.assign(new Error("The TV did not answer."), { code: "ETIMEDOUT" })));
    socket.once("error", reject);
    socket.once("secureConnect", () => {
      const seen = socket.getPeerCertificate().fingerprint256 ?? "";
      if (fingerprint && seen !== fingerprint) {
        socket.destroy();
        reject(Object.assign(new Error("Another device answered at the TV's address."), { code: "EFINGERPRINT" }));
        return;
      }
      const payload = body === undefined ? undefined : JSON.stringify(body);
      // No agent: an agent would open a connection of its own instead of the checked one.
      const req = httpsRequest({
        host, port: PORT, method, path, createConnection: () => socket,
        headers: { "Content-Type": "application/json", ...(auth ? { AUTH: auth } : {}), ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}) },
      }, res => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { text += chunk; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {}, fingerprint: seen }); }
          catch { reject(new Error("The TV sent an unreadable reply.")); }
        });
      });
      req.once("error", reject);
      req.end(payload);
    });
  });
}

/** Hosts on the Pi's own networks (at most a /24 around each address) with the API port open. */
async function scanCandidates(): Promise<string[]> {
  const hosts = new Set<string>();
  for (const addresses of Object.values(os.networkInterfaces()))
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      const prefix = address.address.split(".").slice(0, 3).join(".");
      for (let last = 1; last < 255; last++) if (`${prefix}.${last}` !== address.address) hosts.add(`${prefix}.${last}`);
    }
  const open = (host: string) => new Promise<boolean>(resolve => {
    const socket = tcpConnect({ host, port: PORT, timeout: 700 });
    const done = (result: boolean) => { socket.destroy(); resolve(result); };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
  const list = [...hosts], found: string[] = [];
  for (let i = 0; i < list.length; i += 64)
    found.push(...(await Promise.all(list.slice(i, i + 64).map(async host => (await open(host)) ? host : ""))).filter(Boolean));
  return found;
}

const unreachable = (error: unknown) => ["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "ECONNRESET", "EFINGERPRINT"].includes((error as { code?: string }).code ?? "");

export class TvControl {
  private pairing: TvPairing | null = null;
  private pending: (TvIdentity & { host: string; fingerprint: string; token: number; challenge: number }) | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private searchedAt = 0;
  private readonly options: TvOptions;

  constructor(options: Partial<TvOptions> & { file: string }) {
    this.options = { transport: httpsTransport, candidates: scanCandidates, ...options };
    try {
      if (existsSync(this.options.file)) this.pairing = JSON.parse(readFileSync(this.options.file, "utf8")) as TvPairing;
    } catch { this.pairing = null; }
  }

  status() {
    const pairing = this.pairing;
    return { paired: Boolean(pairing), model: pairing?.model ?? "", name: pairing?.name ?? "", host: pairing?.host ?? "",
      pairing: this.pending ? { model: this.pending.model, name: this.pending.name, host: this.pending.host } : null };
  }
  get paired() { return Boolean(this.pairing); }

  /** Find the TV and ask it to show a PIN. */
  startPairing() {
    return this.serial(async () => {
      let found: { host: string; identity: TvIdentity; fingerprint: string } | null = null;
      for (const host of await this.options.candidates()) {
        found = await this.identify(host).catch(() => null);
        if (found) break;
      }
      if (!found) throw new TvError(404, "No Vizio TV answered on the network. Check that the TV is on and connected to the same Wi-Fi as PiTV.");
      const reply = await this.options.transport({ host: found.host, method: "PUT", path: "/pairing/start", body: { DEVICE_ID, DEVICE_NAME: "PiTV" } });
      const item = reply.body?.ITEM;
      if (reply.body?.STATUS?.RESULT !== "SUCCESS" || !item) throw new TvError(502, `The TV did not start pairing (${reply.body?.STATUS?.RESULT ?? reply.status}).`);
      this.pending = { ...found.identity, host: found.host, fingerprint: found.fingerprint, token: item.PAIRING_REQ_TOKEN, challenge: item.CHALLENGE_TYPE };
      return this.status();
    });
  }

  /** Send back the PIN the TV shows. */
  finishPairing(pin: string) {
    return this.serial(async () => {
      const pending = this.pending;
      if (!pending) throw new TvError(409, "Start pairing first, so the TV shows a PIN.");
      if (!/^\d{4}$/.test(pin)) throw new TvError(400, "The PIN is the 4 digits the TV shows.");
      const reply = await this.options.transport({ host: pending.host, method: "PUT", path: "/pairing/pair", fingerprint: pending.fingerprint,
        body: { DEVICE_ID, CHALLENGE_TYPE: pending.challenge, RESPONSE_VALUE: pin, PAIRING_REQ_TOKEN: pending.token } });
      const token = reply.body?.ITEM?.AUTH_TOKEN;
      if (reply.body?.STATUS?.RESULT !== "SUCCESS" || !token) throw new TvError(400, "The TV did not accept that PIN. Start pairing again for a new one.");
      this.pending = null;
      this.save({ host: pending.host, token, fingerprint: pending.fingerprint, model: pending.model, name: pending.name, serial: pending.serial });
      return this.status();
    });
  }

  forget() { this.pending = null; this.save(null); }

  volume() { return this.serial(() => this.readVolume()); }
  setVolume(level: number) {
    return this.serial(async () => {
      const target = Math.round(Math.min(100, Math.max(0, level)));
      // The TV accepts a change only with the current setting's hash.
      const audio = await this.authed("GET", AUDIO);
      const item = (audio.ITEMS ?? []).find((entry: { CNAME?: string }) => entry.CNAME === "volume");
      if (!item) throw new TvError(502, "The TV did not report its volume.");
      await this.authed("PUT", `${AUDIO}/volume`, { REQUEST: "MODIFY", HASHVAL: item.HASHVAL, VALUE: target });
      return this.readVolume();
    });
  }
  /** Volume steps as remote presses, so the TV shows its own volume bar. */
  step(delta: number) {
    return this.serial(async () => {
      const count = Math.min(10, Math.abs(Math.round(delta)));
      if (count) await this.authed("PUT", "/key_command/", { KEYLIST: Array.from({ length: count }, () => ({ CODESET: 5, CODE: delta > 0 ? 1 : 0, ACTION: "KEYPRESS" })) });
      return this.readVolume();
    });
  }
  setMuted(muted: boolean) {
    return this.serial(async () => {
      await this.authed("PUT", "/key_command/", { KEYLIST: [{ CODESET: 5, CODE: muted ? 3 : 2, ACTION: "KEYPRESS" }] });
      return this.readVolume();
    });
  }

  private async readVolume(): Promise<TvVolume> {
    const items: { CNAME?: string; VALUE?: unknown }[] = (await this.authed("GET", AUDIO)).ITEMS ?? [];
    const level = items.find(item => item.CNAME === "volume")?.VALUE;
    if (typeof level !== "number") throw new TvError(502, "The TV did not report its volume.");
    return { level, muted: items.find(item => item.CNAME === "mute")?.VALUE === "On" };
  }

  // One exchange at a time: a volume change carries the hash of the setting it read.
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async identify(host: string) {
    const reply = await this.options.transport({ host, method: "GET", path: "/state/device/deviceinfo" });
    const value = reply.body?.ITEMS?.[0]?.VALUE;
    if (!value?.MODEL_NAME) return null;
    return { host, fingerprint: reply.fingerprint, identity: { model: String(value.MODEL_NAME), name: String(value.CAST_NAME ?? ""), serial: String(value.SYSTEM_INFO?.SERIAL_NUMBER ?? "") } };
  }

  private async authed(method: "GET" | "PUT", path: string, body?: unknown) {
    const pairing = this.pairing;
    if (!pairing) throw new TvError(409, "PiTV is not paired with the TV. Pair it from the admin page's System tab.");
    let reply: TvReply;
    try {
      reply = await this.options.transport({ host: pairing.host, method, path, body, auth: pairing.token, fingerprint: pairing.fingerprint });
    } catch (error) {
      // The TV may have a new address: find it again by its serial number.
      const host = unreachable(error) ? await this.relocate(pairing) : null;
      if (!host) throw new TvError(504, "The TV is not answering on the network. It may be off or disconnected from the Wi-Fi.");
      reply = await this.options.transport({ host, method, path, body, auth: pairing.token, fingerprint: pairing.fingerprint });
    }
    const result = reply.body?.STATUS?.RESULT;
    if (result === "REQUIRES_PAIRING" || reply.status === 403) throw new TvError(409, "The TV no longer recognises PiTV. Pair it again from the admin page's System tab.");
    if (result !== "SUCCESS") throw new TvError(502, `The TV refused the request (${result ?? reply.status}).`);
    return reply.body;
  }

  private async relocate(pairing: TvPairing) {
    // At most once every two minutes: a TV that is off does not answer anywhere.
    if (!pairing.serial || Date.now() - this.searchedAt < 120_000) return null;
    this.searchedAt = Date.now();
    for (const host of await this.options.candidates()) {
      if (host === pairing.host) continue;
      const found = await this.identify(host).catch(() => null);
      if (found?.identity.serial === pairing.serial && found.fingerprint === pairing.fingerprint) {
        this.save({ ...pairing, host });
        return host;
      }
    }
    return null;
  }

  private save(pairing: TvPairing | null) {
    this.pairing = pairing;
    if (!pairing) { if (existsSync(this.options.file)) unlinkSync(this.options.file); return; }
    const temporary = `${this.options.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(pairing), { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.options.file);
  }
}
