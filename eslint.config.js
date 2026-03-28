/**
 * ESLint configuration for Gorgonetics (ESLint v9+)
 * See: https://eslint.org/docs/latest/use/configure/configuration-files-new
 */
import js from "@eslint/js";
import sveltePlugin from "eslint-plugin-svelte";
import globals from "globals";

export default [
  // Global ignores
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "coverage/",
      "*.log",
      ".npm",
      ".eslintcache",
      "__pycache__/",
      "*.py",
      ".vscode/",
      ".idea/",
      ".DS_Store",
      "Thumbs.db",
      "*.tmp",
      "*.temp",
      ".venv/",
      ".mypy_cache/",
      ".pytest_cache/",
      ".ruff_cache/",
      ".ropeproject/",
      "uv.lock",
    ],
  },

  // Base JavaScript configuration
  js.configs.recommended,

  // JavaScript and TypeScript files
  {
    files: ["**/*.js", "**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
      semi: ["error", "always"],
      quotes: "off", // Allow both single and double quotes
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "error",
    },
  },

  // Svelte files configuration
  ...sveltePlugin.configs["flat/recommended"],
  {
    files: ["**/*.svelte"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // Override or add Svelte-specific rules
      "svelte/no-unused-svelte-ignore": "warn",
      "svelte/no-at-html-tags": "warn",
      "svelte/no-target-blank": "error",
      "svelte/valid-compile": "warn", // Changed from error to warn for development
      "svelte/no-reactive-functions": "warn",
      "svelte/no-reactive-literals": "warn",

      // JavaScript rules that work well with Svelte
      "no-unused-vars": "warn",
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "error",
    },
  },

];
