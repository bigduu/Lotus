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
        // Collapse the bundle into a handful of chunks. The app used to emit
        // ~70 tiny lazy `index-*.js` fragments (some <1KB); opening a view fired
        // that whole burst of parallel requests at once, which a proxy/CDN in
        // front of the app rate-limits (429) — breaking the dynamic imports.
        // Merging all app source into ONE `app` chunk (+ a few vendor chunks)
        // cuts the parallel request count ~8x so the burst no longer trips any
        // per-host concurrency / rate limit.
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            // All first-party source → a single chunk (kills the lazy fragments).
            return "app";
          }
          if (id.includes("/mermaid/")) return "vendor-mermaid";
          if (id.includes("/recharts/")) return "vendor-charts";
          if (id.includes("/jspdf/") || id.includes("/html2canvas/")) return "vendor-pdf";
          if (
            id.includes("/react-markdown/") ||
            id.includes("/react-syntax-highlighter/") ||
            id.includes("/remark") ||
            id.includes("/rehype") ||
            id.includes("/micromark") ||
            id.includes("/hast") ||
            id.includes("/mdast") ||
            id.includes("/unist") ||
            id.includes("/refractor") ||
            id.includes("/property-information") ||
            id.includes("/character-entities")
          ) {
            return "vendor-markdown";
          }
          if (id.includes("/i18next") || id.includes("/react-i18next/")) return "vendor-i18n";
          if (id.includes("/antd/") || id.includes("/@ant-design/") || id.includes("/rc-")) {
            return "vendor-antd";
          }
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "vendor-react";
          }
          // Everything else from node_modules → one shared vendor chunk.
          return "vendor";
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
