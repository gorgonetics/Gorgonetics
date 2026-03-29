/**
 * ESLint configuration for Gorgonetics (ESLint v9+)
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import sveltePlugin from "eslint-plugin-svelte";
import globals from "globals";

export default [
  // Global ignores
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      ".svelte-kit/",
      "coverage/",
      "*.log",
      ".npm",
      ".eslintcache",
      "*.py",
      ".venv/",
      "uv.lock",
      "src-tauri/target/",
      "test-results/",
      "playwright-report/",
    ],
  },

  // Base JS config
  js.configs.recommended,

  // TypeScript files
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      "no-unused-vars": "off", // TS handles this better
      "no-undef": "off", // TS handles this
      "no-redeclare": "off", // TS allows const+type with same name
      semi: ["error", "always"],
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "error",
    },
  },

  // JavaScript files
  {
    files: ["**/*.js"],
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
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "error",
    },
  },

  // Svelte files
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
      "svelte/no-unused-svelte-ignore": "warn",
      "svelte/no-at-html-tags": "warn",
      "svelte/no-target-blank": "error",
      "svelte/valid-compile": "warn",
      "svelte/no-reactive-functions": "warn",
      "svelte/no-reactive-literals": "warn",
      "no-unused-vars": "warn",
      "no-console": "off",
      "prefer-const": "warn",
      "no-var": "error",
    },
  },
];
