import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.{test,spec}.{js,ts}"],
    exclude: ["tests/e2e/**", "node_modules"],
    testTimeout: 10000,
    alias: {
      "$lib": resolve(__dirname, "./src/lib"),
      "$lib/": resolve(__dirname, "./src/lib/"),
      "$app": resolve(__dirname, "./.svelte-kit/runtime/app"),
    },
  },
  resolve: {
    alias: {
      "$lib": resolve(__dirname, "./src/lib"),
    },
  },
});
