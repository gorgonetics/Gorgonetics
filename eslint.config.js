/**
 * ESLint configuration for PGBreeder (ESLint v9+)
 * See: https://eslint.org/docs/latest/use/configure/configuration-files-new
 */
export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "error",
      semi: ["error", "always"],
      quotes: ["error", "double"],
      "no-console": "off",
    },
  },
];
