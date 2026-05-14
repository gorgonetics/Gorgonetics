import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const libAlias = { $lib: resolve(__dirname, './src/lib') };

// Integration tests live in `tests/integration/` and require an external
// service (Firestore Emulator). They are excluded from the default
// `pnpm test` run via `vitest.config.js` and invoked explicitly via
// `pnpm test:firestore`, which wraps this config in `firebase emulators:exec`.
// Standalone (not mergeConfig'd) because mergeConfig unions `test.include`
// rather than replacing it, which would re-run the entire unit suite here.
export default defineConfig({
  plugins: [svelte()],
  define: {
    __APP_VERSION__: JSON.stringify('integration-test'),
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.{test,spec}.{js,ts}'],
    testTimeout: 30000,
    alias: libAlias,
  },
  resolve: {
    alias: libAlias,
  },
});
