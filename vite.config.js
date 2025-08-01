import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  root: "src/svelte",
  publicDir: "public",
  build: {
    outDir: "../../dist/svelte",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    cors: true,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/static": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      $lib: "/lib",
      $components: "/lib/components",
    },
  },
});
