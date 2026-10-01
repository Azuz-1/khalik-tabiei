import { defineConfig } from "@playwright/test";
import base from "./playwright.config.mjs";

const port = process.env.RELEASE_BROWSER_PORT ?? "8084";
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  ...base,
  outputDir: process.env.RELEASE_BROWSER_OUTPUT ?? `test-results/release-${port}`,
  use: { ...base.use, baseURL: origin, video: "off" },
  reporter: [["line"], ["json", { outputFile: process.env.RELEASE_BROWSER_REPORT ?? "test-results/release-browser.json" }]],
  webServer: {
    ...base.webServer,
    url: `${origin}/healthz`,
    env: { ...base.webServer.env, HOST: "127.0.0.1", PORT: port, PUBLIC_ORIGIN: origin },
  },
  projects: [{ name: "chromium", use: {
    browserName: "chromium",
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {}),
  } }],
});
