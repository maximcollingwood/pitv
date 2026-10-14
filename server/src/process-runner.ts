import { spawn } from "node:child_process";
import { setPriority } from "node:os";
export type ProcessRunner = (command: string, args: string[], options: { signal: AbortSignal; onLine?: (line: string) => void }) => Promise<string>;

// Argument arrays, no shell, bounded output, and one cancellation owner.
export const runProcess: ProcessRunner = (command, args, { signal, onLine }) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(new Error("Media preparation cancelled or timed out")); return; }
  // A separate Linux process group lets timeout/shutdown also stop ffmpeg children.
  const group = process.platform !== "win32";
  const child = spawn(command, args, { shell: false, windowsHide: true, detached: group, stdio: ["ignore", "pipe", "pipe"] });
  // Imports are background work: yield the CPU to the TV interface and the API.
  // ffmpeg children that yt-dlp starts later inherit the lower priority.
  if (child.pid) try { setPriority(child.pid, 10); } catch { /* best effort */ }
  let output = "", errors = "", partial = "", done = false, tooLarge = false;
  let hardKill: NodeJS.Timeout | undefined;
  function kill(signal: NodeJS.Signals) {
    try { if (group && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already exited */ }
  }
  function cancel() {
    if (hardKill) return;
    kill("SIGTERM");
    hardKill = setTimeout(() => kill("SIGKILL"), 3000);
    hardKill.unref();
  }
  if (signal.aborted) cancel(); else signal.addEventListener("abort", cancel, { once: true });
  child.stdout.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    output += chunk.toString();
    if (output.length > 8 * 1024 * 1024) { tooLarge = true; output = ""; cancel(); return; }
    partial += chunk.toString();
    const lines = partial.split(/\r?\n/); partial = lines.pop() ?? "";
    for (const line of lines) onLine?.(line);
  });
  child.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-8192); });
  function finish(error?: Error) {
    if (done) return; done = true;
    signal.removeEventListener("abort", cancel);
    if (hardKill) clearTimeout(hardKill);
    if (error) reject(error); else resolve(output);
  }
  child.on("error", (error) => finish(new Error(`${command}: ${error.message}`)));
  child.on("close", (code) => {
    if (signal.aborted) finish(new Error("Media preparation cancelled or timed out"));
    else if (tooLarge) finish(new Error("Extractor output exceeded the safe limit"));
    else if (code !== 0) finish(new Error(errors.trim() || `${command} exited with status ${code}`));
    else finish();
  });
});
