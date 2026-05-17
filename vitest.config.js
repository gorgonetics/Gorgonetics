import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['tests/e2e/**', 'tests/integration/**', 'node_modules'],
    testTimeout: 10000,
    alias: {
      $lib: resolve(__dirname, './src/lib'),
      '$lib/': resolve(__dirname, './src/lib/'),
      $app: resolve(__dirname, './.svelte-kit/runtime/app'),
    },
  },
  resolve: {
    alias: {
      $lib: resolve(__dirname, './src/lib'),
    },
    // Component tests (statusBanner, …) mount real Svelte 5 modules via
    // @testing-library/svelte. Without `browser`, Svelte ships its
    // server bundle and `mount(...)` throws "lifecycle_function_unavailable"
    // even under jsdom. The condition is safe for service tests too —
    // they don't depend on SSR-only paths.
    conditions: ['browser'],
  },
});
