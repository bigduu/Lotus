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
        // Lazy-loaded features are imported through their directory's
        // `index.tsx` barrel, so Rollup names every one of them `index-*.js`
        // — indistinguishable in the network tab and in chunk-404 errors.
        // Fall back to the module's parent directory name (e.g.
        // `CommandPalette-*.js`, `SystemSettingsPage-*.js`) so a failed chunk
        // says which feature it is.
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name === "index" && chunkInfo.facadeModuleId) {
            const parts = chunkInfo.facadeModuleId
              .split("?")[0]
              .split(/[\\/]/)
              .filter(Boolean);
            const file = parts[parts.length - 1] ?? "";
            const dir = parts[parts.length - 2];
            if (dir && /^index\.[cm]?[jt]sx?$/.test(file)) {
              return `assets/${dir}-[hash].js`;
            }
          }
          return "assets/[name]-[hash].js";
        },
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
