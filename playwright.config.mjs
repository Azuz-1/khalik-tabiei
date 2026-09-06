import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  timeout: 90_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results/browser",
  use: {
    baseURL: "http://127.0.0.1:8080",
    locale: "ar-SA",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:8080/healthz",
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      PUBLIC_ORIGIN: "http://127.0.0.1:8080",
      SESSION_SECRET: "browser-test-secret-0123456789-abcdef",
      NODE_ENV: "development",
    },
  },
  // CI installs the pinned Chromium for this runner version. Environments that
  // already ship a Chromium build (sandboxes, offline machines, distro
  // packages) can point at it instead of downloading a second copy.
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
});
