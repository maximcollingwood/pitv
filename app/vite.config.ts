import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// During dev, proxy API calls to the Fastify server so the frontend can call
// same-origin "/api/..." exactly as it does in production behind nginx.
// `--mode vm` (npm run vm:app) targets the Vagrant VM's nginx instead.
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), "").PITV_API_URL || "http://localhost:3000";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": target,
        "/uploads": target,
      },
    },
  };
});
