import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import packageJson from "./package.json" with { type: "json" };

// GitHub Pages serves the app as a project site under the repository name. The origin is frozen
// once the iPad is set up: moving it strands the event log (spec, "PWA, device and hosting").
const PAGES_BASE = "/order-processor/";

// Left out of the precache (see globPatterns) so the Verwaltung can name a waiting version before
// it takes over.
function versionFile(): Plugin {
  return {
    name: "version-file",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: packageJson.version }),
      });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview === true ? PAGES_BASE : "/",
  define: {
    "import.meta.env.APP_VERSION": JSON.stringify(packageJson.version),
  },
  plugins: [
    react(),
    versionFile(),
    VitePWA({
      // A new version takes over only on Aktualisieren, never by an auto-reload mid-service.
      registerType: "prompt",
      strategies: "generateSW",
      includeAssets: ["icon.svg"],
      workbox: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"] },
      manifest: {
        name: "Kirbe Essensausgabe",
        short_name: "Essensausgabe",
        lang: "de",
        display: "standalone",
        orientation: "landscape",
        background_color: "#f3f0e8",
        theme_color: "#1d1d1b",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
