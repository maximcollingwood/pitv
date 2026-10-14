import { createApp } from "./app.js";
const { app } = createApp();
const shutdown = async () => { await app.close(); };
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
// Loopback only: nginx is the network entry point and the native player is local.
// Set HOST to expose the API directly (for example HOST=0.0.0.0 in development).
app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? "127.0.0.1" }).catch((error) => {
  app.log.error(error);
  void app.close().finally(() => { process.exitCode = 1; });
});
