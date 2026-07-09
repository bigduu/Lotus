import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";
import { fileURLToPath } from "url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig(async ({ command }) => ({
  // Use relative asset URLs for production bundles so Tauri can load them
  // regardless of whether runtime uses custom protocol or file scheme.
  base: command === "serve" ? "/" : "./",

  plugins: [
    react(),
    // Bundle analysis — run `npx vite build` then open stats.html
    visualizer({
      filename: "stats.html",
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],

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

  // No optimizeDeps config - let Vite handle mermaid naturally
  // The 404 issue will be handled by proper chunk splitting in build

  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: "index.html",
      },
      output: {
        // Only consolidate node_modules into a handful of vendor chunks. App
        // source keeps its natural code-splitting — forcing all first-party
        // modules into one chunk broke module init order (app failed to mount).
        // To cut the lazy-fragment burst safely, small chunks are merged via
        // `experimentalMinChunkSize` below (semantics-preserving) rather than by
        // collapsing the graph by hand.
        experimentalMinChunkSize: 150_000,
        manualChunks: {
          // ── Vendor splits ──────────────────────────────
          "vendor-react": ["react", "react-dom"],
          "vendor-antd": ["antd", "@ant-design/icons"],
          "vendor-markdown": [
            "react-markdown",
            "react-syntax-highlighter",
            "remark-gfm",
            "remark-breaks",
            "rehype-sanitize",
          ],
          "vendor-charts": ["recharts"],
          "vendor-mermaid": ["mermaid"],
          "vendor-i18n": ["i18next", "react-i18next"],
          "vendor-pdf": ["jspdf", "html2canvas"],
        },
      },
    },
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "0.0.0.0",
    allowedHosts: ["mac.local"],
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
