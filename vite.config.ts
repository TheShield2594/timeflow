import { statSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Power Apps Code App host loads the JS via blob:/sandbox URLs, which
// breaks Vite's default `new URL(asset, import.meta.url)` for external
// assets. Inline anything reasonably small as base64 so the bundle is
// self-contained.
const ASSETS_INLINE_LIMIT = 32 * 1024;

/**
 * Assets that MUST inline, and how much room each has left (#116).
 *
 * `outfit-latin-var.woff2` is 32,292 bytes against a 32,768-byte limit — 476
 * bytes of headroom. Add one glyph to the subset and Vite silently stops
 * inlining it, emits it as a separate file, and the font 404s in the host
 * with no build error at all: the first anyone would know is a production
 * page rendering in the fallback stack.
 *
 * So the cliff is asserted rather than commented. The check runs twice on
 * purpose: the source-size test fails fast with the exact overage, and the
 * bundle test catches the case where Vite's inlining rule itself changes
 * under us (an SVG exemption, a different size accounting) and the source
 * was never the thing that moved.
 */
const MUST_INLINE = [
  "src/assets/fonts/outfit-latin-var.woff2",
  "src/everence-logo.png",
];

function assertCriticalAssetsInline(limit: number): Plugin {
  const basenames = MUST_INLINE.map((p) => p.slice(p.lastIndexOf("/") + 1));
  return {
    name: "timeflow:assert-critical-assets-inline",
    apply: "build",
    buildStart() {
      for (const path of MUST_INLINE) {
        const { size } = statSync(path);
        if (size >= limit) {
          this.error(
            `${path} is ${size} bytes, at or over the ${limit}-byte assetsInlineLimit. ` +
            `It would be emitted as a separate file and 404 under the Power Apps host. ` +
            `Shrink it by ${size - limit + 1} bytes, or solve the external-asset problem first.`
          );
        }
      }
    },
    generateBundle(_options, bundle) {
      const leaked = Object.keys(bundle).filter((f) =>
        basenames.some((b) => f.includes(b.slice(0, b.lastIndexOf("."))))
      );
      if (leaked.length > 0) {
        this.error(
          `These assets emitted as separate files instead of inlining: ${leaked.join(", ")}. ` +
          `They will 404 under the Power Apps host.`
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), assertCriticalAssetsInline(ASSETS_INLINE_LIMIT)],
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
    assetsInlineLimit: ASSETS_INLINE_LIMIT,
    rollupOptions: {
      output: {
        assetFileNames: "[name]-[hash][extname]",
        chunkFileNames: "[name]-[hash].js",
        entryFileNames: "[name]-[hash].js",
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
