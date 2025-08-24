import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    // Test environment configuration
    environment: "node",

    // Global test settings
    globals: true,
    clearMocks: true,

    // Test file patterns
    include: [
      "tests/client/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}",
      "tests/client/**/test-*.{js,mjs,cjs,ts,mts,cts}",
    ],

    // Exclude patterns
    exclude: ["node_modules", "dist", ".git", "tests/integration/**"],

    // Test timeout settings
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "tests/",
        "dist/",
        "scripts/",
        "**/*.config.js",
        "**/*.config.ts",
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      },
    },

    // Setup files
    setupFiles: ["tests/client/setup.js"],

    // Reporter configuration
    reporter: ["default", "json", "html"],
    outputFile: {
      json: "test-results/client-tests.json",
      html: "test-results/client-tests.html",
    },

    // Retry configuration
    retry: 2,

    // Pool configuration for concurrency
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 1,
        maxThreads: 4,
      },
    },

    // Watch mode settings
    watch: false,

    // Silent mode for CI
    silent: false,

    // Benchmark configuration
    benchmark: {
      include: ["tests/client/**/*.{bench,benchmark}.{js,mjs,cjs,ts,mts,cts}"],
      exclude: ["node_modules", "dist", ".git"],
    },
  },

  // Resolve configuration for imports
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@tests": resolve(__dirname, "./tests"),
      "@client": resolve(__dirname, "./tests/client"),
      "@svelte": resolve(__dirname, "./src/svelte"),
    },
  },

  // Define global constants
  define: {
    __TEST__: true,
    __DEV__: true,
  },

  // ESBuild configuration
  esbuild: {
    target: "node14",
  },
});
