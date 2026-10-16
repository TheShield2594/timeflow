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
 * An asset over the limit is silently emitted as a separate file instead,
 * and 404s in the host with no build error at all: the first anyone would
 * know is a production sidebar with a broken image where the logo was. The
 * self-hosted font that first made this bite (#116) is gone — the app sets
 * Verdana, which every desktop already has — but the two logos are ~13 KB
 * each and go the same way if anyone swaps in higher-resolution artwork.
 *
 * So the cliff is asserted rather than commented. The check runs twice on
 * purpose: the source-size test fails fast with the exact overage, and the
 * bundle test catches the case where Vite's inlining rule itself changes
 * under us (an SVG exemption, a different size accounting) and the source
 * was never the thing that moved.
 *
 * `everence-logo.png` is not in this list: it is the Power Apps tile
 * (`logoPath` in power.config.json) and nothing in the bundle imports it.
 */
const MUST_INLINE = [
  "src/everence-logo-stacked.png",
  "src/everence-logo-stacked-reversed.png",
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
