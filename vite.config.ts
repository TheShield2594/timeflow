import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
    // Power Apps Code App host loads the JS via blob:/sandbox URLs, which
    // breaks Vite's default `new URL(asset, import.meta.url)` for external
    // assets. Inline anything reasonably small as base64 so the bundle is
    // self-contained.
    assetsInlineLimit: 32 * 1024,
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
