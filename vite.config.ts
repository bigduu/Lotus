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
    // Bundle analysis — gated behind ANALYZE=true so a normal build does not
    // serialize the full module graph into a 3.6 MB stats.html on every run.
    // Run `ANALYZE=true npx vite build` then open stats.html.
    ...(process.env.ANALYZE === "true"
      ? [
          visualizer({
            filename: "stats.html",
            gzipSize: true,
            brotliSize: true,
            open: false,
          }),
        ]
      : []),
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
          // `react-syntax-highlighter`'s barrel is deliberately NOT listed
          // here — it's now only reached via
          // `React.lazy(() => import(...))` from
          // `markdownSyntaxHighlighter.tsx` (issue #7). Forcing it into this
          // eagerly-loaded vendor chunk would defeat the lazy boundary and
          // ship the highlighter on the critical chat-render path again.
          "vendor-markdown": ["react-markdown", "remark-gfm", "remark-breaks", "rehype-sanitize"],
          // Pin the lazy-loaded highlighter to its own named chunk, rooted
          // at our wrapper module — everything it exclusively reaches
          // (PrismLight, the oneLight/oneDark themes, the 10 registered language
          // grammars) is co-located here by Rollup rather than left for
          // `experimentalMinChunkSize` below to fuse into whatever unrelated
          // async chunk happens to be small at build time. Verified lean:
          // this chunk contains none of react-syntax-highlighter's other
          // ~300 bundled Prism languages. Every chat component that renders
          // highlighted code (ToolCallCard, WorkflowResultCard,
          // ToolResultCard, FormattedContentPreview, SystemPromptPreview,
          // and MarkdownCodeBlock) now reaches PrismLight exclusively
          // through `LazySyntaxHighlighter`/`markdownSyntaxHighlighter.tsx`
          // — issue #7's follow-up (#82) closed the last full-`Prism`
          // eager importers.
          "vendor-syntax-highlighter": [
            path.resolve(
              __dirname,
              "./src/shared/components/Markdown/markdownSyntaxHighlighter.tsx",
            ),
          ],
          "vendor-charts": ["recharts"],
          // `openai` is a heavy SDK (~300 KB+) pulled in transitively by the
          // metrics services; pin it to its own chunk so it never lands in the
          // main or SettingsPage chunks unless metrics are actually used.
          "vendor-openai": ["openai"],
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
