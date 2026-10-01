import { test, expect } from "@playwright/test";

test("unsupported UUID API and denied session storage do not prevent Home boot", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true });
    Object.defineProperty(window, "sessionStorage", { get() { throw new DOMException("blocked", "SecurityError"); }, configurable: true });
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const telemetry = [];
  await page.route("**/api/telemetry", async (route) => {
    telemetry.push(...route.request().postDataJSON().events);
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "سوّ غرفة والعب معنا" })).toBeEnabled();
  await expect.poll(() => telemetry.some((item) => item.event === "client_started"), { timeout: 10_000 }).toBe(true);
  expect(telemetry.find((item) => item.event === "client_started").props.clientSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(errors).toEqual([]);
});

test("a render failure shows recoverable Arabic UI and reload restores Home", async ({ page }) => {
  const telemetry = [];
  await page.route("**/api/telemetry", async (route) => {
    telemetry.push(...route.request().postDataJSON().events);
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "سوّ غرفة والعب معنا" })).toBeEnabled();
  await page.evaluate(() => {
    Intl.Segmenter = class { constructor() { throw new TypeError("SECRET_ROOM private player private prompt"); } };
  });
  await page.getByRole("button", { name: "سوّ غرفة والعب معنا" }).click();
  await expect(page.getByRole("heading", { name: "صار خطأ في عرض اللعبة" })).toBeVisible();
  await expect.poll(() => telemetry.some((item) => item.event === "client_error" && item.props.kind === "react"), { timeout: 10_000 }).toBe(true);
  const errors = telemetry.filter((item) => item.event === "client_error");
  expect(errors.find((item) => item.props.kind === "react").props.errorClass).toBe("TypeError");
  expect(JSON.stringify(errors)).not.toMatch(/SECRET_ROOM|private player|private prompt|message|stack/);
  await page.getByRole("button", { name: "تحديث الصفحة" }).click();
  await expect(page.getByRole("heading", { name: "خلك طبيعي" })).toBeVisible();
  await expect(page.getByRole("button", { name: "سوّ غرفة والعب معنا" })).toBeEnabled();
});

test("a failed participant chunk import shows startup recovery and can be retried", async ({ page }) => {
  const telemetry = [];
  await page.route("**/api/telemetry", async (route) => {
    telemetry.push(...route.request().postDataJSON().events);
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  const chunkPattern = /\/assets\/App-[A-Za-z0-9_-]+\.js(?:\?|$)/;
  await page.route(chunkPattern, (route) => route.abort("failed"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "صار خطأ في عرض اللعبة" })).toBeVisible();
  await expect.poll(() => telemetry.some((item) => item.event === "client_error" && item.props.kind === "bootstrap"), { timeout: 10_000 }).toBe(true);
  await expect(page.getByText("سكّر الصفحة وافتح رابط اللعبة من جديد")).toBeVisible();
  await page.unroute(chunkPattern);
  await page.getByRole("button", { name: "تحديث الصفحة" }).click();
  await expect(page.getByRole("heading", { name: "خلك طبيعي" })).toBeVisible();
});

test("runtime diagnostics stay bounded and strip private URLs and exception names", async ({ page }) => {
  const telemetry = [];
  await page.route("**/api/telemetry", async (route) => {
    telemetry.push(...route.request().postDataJSON().events);
    await route.fulfill({ status: 200, json: { ok: true } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "خلك طبيعي" })).toBeVisible();
  await page.evaluate(() => {
    for (let index = 0; index < 20; index += 1) window.dispatchEvent(new ErrorEvent("error", {
      error: { name: "SECRET_PLAYER", message: "SECRET_PROMPT", stack: "SECRET_VOTE" },
      filename: `${location.origin}/assets/App-AbCdEf12.js?room=SECRET_ROOM`, lineno: 32, colno: 17,
    }));
  });
  await expect.poll(() => telemetry.filter((item) => item.event === "client_error").length, { timeout: 10_000 }).toBe(10);
  const errors = telemetry.filter((item) => item.event === "client_error");
  for (const item of errors) expect(item.props).toMatchObject({ kind: "runtime", errorClass: "unknown", sourceAsset: "App-AbCdEf12.js", line: 32, column: 17 });
  expect(JSON.stringify(errors)).not.toMatch(/SECRET_|filename|message|stack|https?:/);
});
