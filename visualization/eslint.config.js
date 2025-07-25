import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        files: ["*.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.es2021,
                ...globals.node,
            },
        },
        rules: {
            // Error prevention
            "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "no-undef": "error",
            "no-console": "warn",
            "no-debugger": "warn",

            // Code style
            "prefer-const": "error",
            "no-var": "error",
            eqeqeq: ["error", "always"],
            curly: ["error", "all"],

            // Best practices
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error",
            "no-script-url": "error",
        },
    },
    {
        files: ["gene_effects_data.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "script",
            globals: {
                ...globals.browser,
                ...globals.es2021,
                ...globals.node,
                module: "writable",
                exports: "writable",
            },
        },
        rules: {
            "no-unused-vars": "off",
            "no-undef": "off",
        },
    },
    {
        ignores: ["node_modules/", "*.min.js", "dist/", "*.html"],
    },
];
