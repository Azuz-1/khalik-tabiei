import { test, expect } from "@playwright/test";

const PHASE_TIMEOUT = 75_000;

async function newPhone(browser, width = 390, height = 844) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
  return { context, page: await context.newPage() };
}

async function createOwner(browser) {
  const phone = await newPhone(browser, 430, 932);
  await phone.page.goto("/");
  await phone.page.getByRole("button", { name: "سوّ غرفة والعب معنا", exact: true }).click();
  await phone.page.getByLabel("اسمك").fill("المالك");
  await phone.page.getByRole("button", { name: "إنشاء الغرفة", exact: true }).click();
  const code = (await phone.page.locator(".code-value").textContent())?.trim();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  return { ...phone, code };
}

async function joinPlayer(browser, code, name) {
  const phone = await newPhone(browser);
  await phone.page.goto(`/join/${code}`);
  await phone.page.getByLabel("اسمك").fill(name);
  await phone.page.getByRole("button", { name: "دخول الغرفة" }).click();
  await expect(phone.page.getByRole("heading", { name: "أنت داخل 🎉" })).toBeVisible();
  return phone;
}

async function openEndGame(page) {
  await page.getByRole("button", { name: "المزيد", exact: true }).click();
  await page.getByRole("dialog", { name: "خيارات اللعبة" }).getByRole("button", { name: "إنهاء اللعبة" }).click();
  const dialog = page.getByRole("dialog", { name: "إنهاء اللعبة الحالية؟" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("owner ends a running game and everyone returns to the same room's lobby", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await createOwner(browser);
  const players = [await joinPlayer(browser, owner.code, "لاعب 2"), await joinPlayer(browser, owner.code, "لاعب 3")];
  const phones = [owner, ...players];

  try {
    await owner.page.getByRole("button", { name: "ابدأ اللعبة", exact: true }).click();
    for (const phone of phones) {
      await expect(phone.page.getByRole("button", { name: "اعرض دوري", exact: true })).toBeVisible({ timeout: PHASE_TIMEOUT });
    }

    // Cancelling keeps the game running.
    const first = await openEndGame(owner.page);
    await expect(first).toContainText("نفس الغرفة");
    await first.getByRole("button", { name: "إلغاء", exact: true }).click();
    await expect(first).toBeHidden();
    await expect(owner.page.getByRole("button", { name: "اعرض دوري", exact: true })).toBeVisible();

    // Confirming returns every phone to the lobby of the same room.
    const second = await openEndGame(owner.page);
    await second.getByRole("button", { name: "إنهاء والرجوع للانتظار", exact: true }).click();
    await expect(second).toBeHidden({ timeout: PHASE_TIMEOUT });
    await expect(owner.page.locator(".code-value")).toHaveText(owner.code);
    await expect(owner.page.getByRole("button", { name: "ابدأ اللعبة", exact: true })).toBeVisible();
    for (const player of players) {
      await expect(player.page.getByRole("heading", { name: "أنت داخل 🎉" })).toBeVisible({ timeout: PHASE_TIMEOUT });
      await expect(player.page.getByRole("button", { name: "اعرض دوري", exact: true })).toHaveCount(0);
    }
    await expect(owner.page.getByText("لاعب 2")).toBeVisible();
    await expect(owner.page.getByText("لاعب 3")).toBeVisible();

    // Nobody rejoined, and a fresh game starts from the same lobby.
    await owner.page.getByRole("button", { name: "ابدأ اللعبة", exact: true }).click();
    for (const phone of phones) {
      await expect(phone.page.getByRole("button", { name: "اعرض دوري", exact: true })).toBeVisible({ timeout: PHASE_TIMEOUT });
    }
  } finally {
    await Promise.allSettled(phones.map((phone) => phone.context.close()));
  }
});
