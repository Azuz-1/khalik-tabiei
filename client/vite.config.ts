import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Server serves the built client from client/dist on one origin. In dev, the
// Vite dev server proxies the WebSocket to the Node server on :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow importing the shared/ folder that lives outside client/.
    fs: { allow: [".."] },
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/healthz": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
