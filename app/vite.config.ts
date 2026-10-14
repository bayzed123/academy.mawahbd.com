import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const WORKER = "http://127.0.0.1:8787";

// Served by the Worker under /app/. In `vite dev` everything that is not the app itself is proxied to `wrangler dev`.
export default defineConfig({
  base: "/app/",
  plugins: [react()],
  build: {
    outDir: "../dist/static/app",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(["/api", "/media", "/fonts", "/chat.js", "/chat.css", "/favicon.svg", "/sprite.svg", "/pattern.svg", "/manifest.webmanifest"].map((p) => [p, WORKER])),
  },
});
