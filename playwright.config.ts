import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;
// The smoke flows run against the production build under its GitHub Pages base path, so a broken
// asset path fails here rather than on the live site.
const BASE_URL = `http://localhost:${String(PORT)}/order-processor/`;
const SYNC_SERVER = "https://localhost:8443";

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    ...devices["Desktop Chrome"],
    // The window iPad in landscape (spec, "Screens").
    viewport: { width: 1180, height: 820 },
    serviceWorkers: "block",
    // The sync server's certificate is self-signed for localhost.
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      command: `pnpm build && pnpm preview --port ${String(PORT)} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
    },
    {
      // The real server/, as the iPads meet it at the Fest, but on localhost.
      command: "node e2e/sync-server.ts",
      url: `${SYNC_SERVER}/log`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
