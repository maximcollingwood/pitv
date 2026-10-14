import { createApp } from "./app.js";
const { app } = createApp();
const shutdown = async () => { await app.close(); };
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  void app.close().finally(() => { process.exitCode = 1; });
});
