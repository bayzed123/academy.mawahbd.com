import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const WORKER = "http://127.0.0.1:8787";

// Served by the Worker under /admin/ (behind a staff login). In `vite dev` everything else is proxied to `wrangler dev`.
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  build: {
    outDir: "../dist/static/admin",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5174,
    proxy: Object.fromEntries(["/api", "/media", "/fonts", "/logo.webp", "/logo-sm.webp", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/favicon.ico", "/favicon-32.png", "/sprite.svg", "/pattern.svg"].map((p) => [p, WORKER])),
  },
});
