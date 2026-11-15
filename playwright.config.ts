import { defineConfig, devices } from "@playwright/test";

// Playwright config for end-to-end specs in tests/e2e.
//
// We point at `pnpm start` (prod build) instead of `pnpm dev` because
// (a) prod build matches what users see, (b) HMR + dev-only console
// noise messes with pixel-diff snapshots, (c) the next-intl + Sentry
// plugins behave differently in dev vs prod and we want the realistic
// path on every run.
//
// `reuseExistingServer` is true outside CI so a developer who already
// has `pnpm start` running on :3000 doesn't get a port collision.

const PORT = Number(process.env["PORT"] ?? 3000);
const BASE_URL = process.env["PLAYWRIGHT_BASE_URL"] ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  ...(process.env["CI"] ? { workers: 1 } : {}),
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  expect: {
    // Pixel-diff comparisons get their own per-test tolerance via
    // `toHaveScreenshot({ maxDiffPixels: ... })`. The default is for
    // any incidental visual assertions.
    toHaveScreenshot: { maxDiffPixels: 5000, threshold: 0.2 },
  },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    locale: "en-US",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: process.env["PLAYWRIGHT_WEB_SERVER"] ?? "pnpm start",
    port: PORT,
    timeout: 120_000,
    reuseExistingServer: !process.env["CI"],
    stdout: "pipe",
    stderr: "pipe",
  },
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
});
