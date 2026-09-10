import { test, expect } from "@playwright/test";

test("Home teaches the game before exposing the suggestion form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "خلك طبيعي" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "كل اللي تحتاجه قبل تبدأ" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "كيف نلعب؟" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("كل واحد يشوف المطلوب سرًا", { exact: false })).toBeVisible();

  const suggestionButton = page.getByRole("button", { name: "أرسل اقتراحًا" });
  await expect(suggestionButton).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "عندك فكرة أو ملاحظة؟" })).toHaveCount(0);

  const buttonBox = await suggestionButton.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox.x).toBeLessThan(32);
  expect(buttonBox.y).toBeLessThan(42);

  await suggestionButton.click();

  const dialog = page.getByRole("dialog", { name: "عندك فكرة أو ملاحظة؟" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("اقتراحك لتحسين اللعبة")).toBeVisible();
  await expect(page.locator("[data-app-content]")).toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "إغلاق الاقتراح" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-app-content]")).not.toHaveAttribute("inert", "");
  await expect(suggestionButton).toBeFocused();
});

test("Home suggestion dialog remains a centered utility on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const suggestionButton = page.getByRole("button", { name: "أرسل اقتراحًا" });
  await expect(suggestionButton).toBeVisible();
  await suggestionButton.click();

  const dialog = page.getByRole("dialog", { name: "عندك فكرة أو ملاحظة؟" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeLessThanOrEqual(570);
  expect(Math.abs((box.x + box.width / 2) - 640)).toBeLessThan(24);
});
