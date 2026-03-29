import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
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
