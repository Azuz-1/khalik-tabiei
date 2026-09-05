import { test, expect } from "@playwright/test";

test("production-facing browser uses local Tajawal assets with normal readiness", async ({ page }) => {
  const externalFontRequests = [];
  const localFontRequests = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) externalFontRequests.push(url);
    if (request.resourceType() === "font") localFontRequests.push(url);
  });

  const readiness = await page.request.get("/readyz");
  expect(readiness.status()).toBe(200);

  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const pageOrigin = new URL(page.url()).origin;
  expect(externalFontRequests).toEqual([]);
  expect(localFontRequests.length).toBeGreaterThan(0);
  expect(localFontRequests.every((url) => new URL(url).origin === pageOrigin)).toBe(true);

  const family = await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily);
  expect(family).toContain("Tajawal");
  expect(await page.evaluate(() => document.fonts.check('400 16px "Tajawal"'))).toBe(true);
});
