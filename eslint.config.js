import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

const noLiteralTranslationFallback = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep locale resources as the single source of default text and require inline t() options",
    },
    schema: [],
    messages: {
      invalidSecondArgument:
        "The second argument to t() must be an inline options object; indirect and positional fallbacks are forbidden.",
      staticDefaultValue:
        "Do not set defaultValue for a static t() key; add or update the text in src/shared/i18n/resources/en-US.ts instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const isDirectTranslationCall =
          node.callee.type === "Identifier" && node.callee.name === "t";
        const isMemberTranslationCall =
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "t";
        if (!isDirectTranslationCall && !isMemberTranslationCall) {
          return;
        }

        const options = node.arguments[1];
        if (!options) {
          return;
        }
        if (options.type !== "ObjectExpression") {
          context.report({ node: options, messageId: "invalidSecondArgument" });
          return;
        }

        const key = node.arguments[0];
        const isStaticKey =
          (key?.type === "Literal" && typeof key.value === "string") ||
          (key?.type === "TemplateLiteral" && key.expressions.length === 0);
        if (!isStaticKey) {
          return;
        }

        for (const property of options.properties) {
          if (property.type !== "Property") {
            continue;
          }
          const propertyName =
            property.key.type === "Identifier" && !property.computed
              ? property.key.name
              : property.key.type === "Literal"
                ? property.key.value
                : undefined;
          if (propertyName === "defaultValue") {
            context.report({ node: property, messageId: "staticDefaultValue" });
          }
        }
      },
    };
  },
};

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
      "lotus-i18n": {
        rules: {
          "no-literal-fallback": noLiteralTranslationFallback,
        },
      },
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
      "react-hooks/exhaustive-deps": "error",

      // ── React Refresh (Vite HMR) ──
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // ── Code quality ──
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "prefer-const": "warn",
      eqeqeq: ["error", "always", { null: "ignore" }],

      // Static text belongs in locale resources. Only inline interpolation /
      // i18next option objects are accepted as a second argument; dynamic keys
      // may keep a computed defaultValue when no static resource key exists.
      "lotus-i18n/no-literal-fallback": "error",
    },
  },

  // ── Test files — relaxed rules ───────────────────────────────────
  {
    files: ["src/**/*.test.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "lotus-i18n/no-literal-fallback": "off",
      "no-console": "off",
    },
  },
];
