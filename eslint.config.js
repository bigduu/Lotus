import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "e2e/**",
      "scripts/**",
      "*.config.*",
      "src/shared/i18n/generated/**",
    ],
  },

  // ── TypeScript + React ───────────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // ── TypeScript ──
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // ── React Hooks ──
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // ── React Refresh (Vite HMR) ──
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // ── Code quality ──
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "prefer-const": "warn",
      eqeqeq: ["error", "always", { null: "ignore" }],

      // ── i18n ──
      // Inline English fallbacks drift from en-US.ts (the single source of
      // truth) and mask missing keys (#168).
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='t'][arguments.0.type='Literal'][arguments.1.type='Literal']",
          message:
            "Do not pass an inline string fallback to t(); put the default text in src/shared/i18n/resources/en-US.ts instead.",
        },
      ],
    },
  },

  // ── Test files — relaxed rules ───────────────────────────────────
  {
    files: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
];
