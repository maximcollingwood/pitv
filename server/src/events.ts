import type { ServerResponse } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";

/** A bounded ephemeral stream: slow clients reconnect instead of accumulating commands. */
export class EventStream {
  private clients = new Map<ServerResponse, () => void>();
  get size() { return this.clients.size; }
  connect(_req: FastifyRequest, reply: FastifyReply, initial?: unknown) {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive", "X-Accel-Buffering": "no",
    });
    res.socket?.setNoDelay(true);
    res.flushHeaders();
    res.write(initial === undefined ? ": connected\n\n" : `data: ${JSON.stringify(initial)}\n\n`);
    const ping = setInterval(() => this.write(res, ": ping\n\n"), 15000);
    ping.unref();
    const cleanup = () => { clearInterval(ping); this.clients.delete(res); };
    this.clients.set(res, cleanup);
    res.once("close", cleanup);
    res.once("error", cleanup);
  }
  private write(res: ServerResponse, payload: string) {
    if (res.destroyed || res.writableEnded || res.writableLength > 64 * 1024) {
      this.clients.get(res)?.(); res.destroy(); return;
    }
    res.write(payload);
  }
  publish(event: unknown) { const payload = `data: ${JSON.stringify(event)}\n\n`; for (const res of this.clients.keys()) this.write(res, payload); }
  close() { for (const [res, cleanup] of this.clients) { cleanup(); res.end(); } }
}
