import { execFile } from "node:child_process";
import { existsSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname } from "node:path";

/**
 * The admin System page: device health, the deployed version, updates and
 * restarts. The backend runs unprivileged (NoNewPrivileges), so actions are
 * one-word requests in a spool file; a root-owned systemd path unit
 * (pitv-system.path, Ansible kiosk-service role) carries out only these words.
 */
export const SYSTEM_ACTIONS = ["update", "restart-screen", "reset-audio", "reboot", "poweroff"] as const;
export type SystemAction = typeof SYSTEM_ACTIONS[number];

export interface SystemOptions {
  /** Spool file the root helper watches. */
  requestPath: string;
  /** Output of the last update run (kiosk-update.service). */
  updateLogPath: string;
  /** Revision written by Ansible at deploy time. */
  versionPath: string;
  /** Where the library lives, for free-space reporting. */
  dataDir: string;
  /** Command runner, replaceable in tests. */
  run?: (command: string, args: string[], timeoutMs: number) => Promise<string | null>;
}

export interface Version { commit: string | null; date: string | null; subject: string | null; repo: string | null; branch: string | null; selfUpdate: boolean }

const run = (command: string, args: string[], timeoutMs: number) => new Promise<string | null>((done) => {
  execFile(command, args, { timeout: timeoutMs, encoding: "utf8" }, (error, stdout) => done(error ? null : stdout));
});

export class SystemControl {
  private latestCache: { commit: string | null; checkedAt: number; error: string | null } | null = null;
  private readonly exec: NonNullable<SystemOptions["run"]>;

  constructor(private readonly options: SystemOptions) {
    this.exec = options.run ?? run;
  }

  version(): Version {
    try {
      const value = JSON.parse(readFileSync(this.options.versionPath, "utf8"));
      return { commit: value.commit || null, date: value.date || null, subject: value.subject || null, repo: value.repo || null, branch: value.branch || null, selfUpdate: value.selfUpdate !== false };
    } catch {
      // Not deployed by Ansible (development): no version, and nothing to update.
      return { commit: null, date: null, subject: null, repo: null, branch: null, selfUpdate: false };
    }
  }

  /** The newest commit on the deployed branch, checked at most every five minutes. */
  async latest(force = false) {
    const { repo, branch } = this.version();
    if (!repo || !branch) return null;
    if (!force && this.latestCache && Date.now() - this.latestCache.checkedAt < 5 * 60 * 1000) return this.latestCache;
    const output = await this.exec("git", ["ls-remote", repo, `refs/heads/${branch}`], 15000);
    const commit = output?.split(/\s/)[0] || null;
    this.latestCache = { commit, checkedAt: Date.now(), error: commit ? null : "Could not reach the update server. Is the Pi online?" };
    return this.latestCache;
  }

  /** kiosk-update.service: running now, and how the last run ended. */
  async updateState() {
    const output = await this.exec("systemctl", ["show", "kiosk-update.service", "--timestamp=unix",
      "-p", "ActiveState", "-p", "Result", "-p", "ExecMainStartTimestamp", "-p", "ExecMainExitTimestamp"], 5000);
    if (output === null) return null;
    const fields = Object.fromEntries(output.trim().split("\n").map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }));
    const time = (value?: string) => value && value.startsWith("@") ? Number(value.slice(1)) * 1000 : null;
    const startedAt = time(fields.ExecMainStartTimestamp), finishedAt = time(fields.ExecMainExitTimestamp);
    const running = fields.ActiveState === "activating" || fields.ActiveState === "active";
    return {
      running,
      startedAt,
      finishedAt: running ? null : finishedAt,
      // Only meaningful once a run has happened since boot.
      succeeded: running || !startedAt ? null : fields.Result === "success",
    };
  }

  updateLog(lines = 80) {
    try { return readFileSync(this.options.updateLogPath, "utf8").split("\n").filter(Boolean).slice(-lines); }
    catch { return []; }
  }

  async device() {
    const [throttled, connections] = await Promise.all([
      this.exec("vcgencmd", ["get_throttled"], 3000),
      this.exec("nmcli", ["-t", "-f", "NAME,TYPE", "connection", "show", "--active"], 3000),
    ]);
    let temperature: number | null = null;
    try { temperature = Math.round(Number(readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8")) / 100) / 10; } catch { /* not a Pi */ }
    // get_throttled bits: 0 under-voltage now, 16 under-voltage since boot; 2/18 throttled.
    const flags = throttled ? parseInt(throttled.split("=")[1] ?? "", 16) : NaN;
    const power = Number.isNaN(flags) ? null : {
      underVoltageNow: Boolean(flags & 0x1), underVoltageSinceBoot: Boolean(flags & 0x10000),
      throttledNow: Boolean(flags & 0x4), throttledSinceBoot: Boolean(flags & 0x40000),
    };
    const wifi = connections?.split("\n").map((line) => line.replace(/\\:/g, "\u0000").split(":"))
      .find((parts) => parts[1] === "802-11-wireless")?.[0]?.replace(/\u0000/g, ":") ?? null;
    const addresses = Object.values(os.networkInterfaces()).flat()
      .filter((address) => address && address.family === "IPv4" && !address.internal).map((address) => address!.address);
    let disk: { totalBytes: number; freeBytes: number } | null = null;
    try { const stats = statfsSync(this.options.dataDir); disk = { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize }; } catch { /* unknown */ }
    return {
      hostname: os.hostname(), uptimeSeconds: Math.round(os.uptime()), load: os.loadavg()[0],
      memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
      temperature, power, wifi, addresses, disk,
    };
  }

  /** Hands an action to the root helper. False when this machine has no helper. */
  request(action: SystemAction) {
    if (!existsSync(dirname(this.options.requestPath))) return false;
    writeFileSync(this.options.requestPath, action);
    return true;
  }
}
