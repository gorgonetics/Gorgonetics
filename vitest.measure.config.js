import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Measurements over the player's own database, run on demand with
// `pnpm measure:bases`. Vitest is only the runner: it resolves `#lib` and
// TypeScript the way the app does, so the study code runs unmodified.
// Standalone for the same reason as `vitest.integration.config.js`.
export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify('measure'),
  },
  test: {
    environment: 'node',
    include: ['tests/measure/**/*.measure.ts'],
    testTimeout: 600000,
  },
});
