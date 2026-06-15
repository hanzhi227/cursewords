import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    environment: "node"
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    proxy: {
      "/auth-config": {
        target: "http://127.0.0.1:4949"
      },
      "/socket.io": {
        target: "http://127.0.0.1:4949",
        ws: true
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
