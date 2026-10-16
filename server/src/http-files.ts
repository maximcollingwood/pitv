import { createReadStream } from "node:fs";
import { extname } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

const types: Record<string, string> = {
  ".mp4": "video/mp4", ".m4a": "audio/mp4", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".opus": "audio/ogg", ".mkv": "video/x-matroska",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};

/** The single byte range a Range header asks for, the whole body without one, or null when it cannot be served. */
export function byteRange(range: string | undefined, size: number): { start: number; end: number; partial: boolean } | null {
  if (!range) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  let start: number, end = size - 1;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end, partial: true };
}

/** Only call with an already validated, owned path. Single byte ranges support seeking. */
export function sendFile(req: FastifyRequest, reply: FastifyReply, path: string, size: number, release?: () => void) {
  reply.header("Content-Type", types[extname(path)] ?? "application/octet-stream");
  reply.header("Accept-Ranges", "bytes");
  reply.header("X-Content-Type-Options", "nosniff");
  const range = byteRange(req.headers.range, size);
  if (!range) { release?.(); return reply.code(416).header("Content-Range", `bytes */${size}`).send(); }
  const { start, end } = range;
  if (range.partial) reply.code(206).header("Content-Range", `bytes ${start}-${end}/${size}`);
  reply.header("Content-Length", Math.max(0, end - start + 1));
  if (req.method === "HEAD" || size === 0) { release?.(); return reply.send(); }
  const stream = createReadStream(path, { start, end });
  // The HTTP socket can close before the file reader (e.g. a player seeks).
  let released = false;
  const cleanup = () => { if (!released) { released = true; release?.(); } stream.destroy(); };
  reply.raw.once("close", cleanup);
  stream.once("close", () => { reply.raw.off("close", cleanup); if (!released) { released = true; release?.(); } });
  return reply.send(stream);
}
