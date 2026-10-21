import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html' }),
      prerender: { handleHttpError: 'ignore' },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 5174,
    host: true,
    strictPort: true,
    fs: {
      // Allow serving gene template and demo genome files for non-Tauri testing
      allow: ['..'],
    },
  },
  // Tauri expects a fixed port; fail if it's already in use
  clearScreen: false,
});
