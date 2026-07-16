import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.opencode/**'],
    // Default (5s test / 10s hook) is too tight for AntD-heavy renders once
    // many test files run concurrently under CPU contention (full-suite
    // load); individually-fast tests were false-timing-out. See Lotus #78.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        "node_modules/",
        "src/test/",
        "src-tauri/",
        "**/*.d.ts",
        "**/*.config.*",
        "**/dist/**",
        "**/target/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@services": path.resolve(__dirname, "./src/services"),
      "@shared": path.resolve(__dirname, "./src/shared"),
      "@pages": path.resolve(__dirname, "./src/pages"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@app": path.resolve(__dirname, "./src/app"),
      "@test": path.resolve(__dirname, "./src/test"),
    },
  },
});
