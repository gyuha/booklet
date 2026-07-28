import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "scripts/checks",
  timeout: 90_000,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:1420" },
  webServer: {
    command: "pnpm dev",
    port: 1420,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
