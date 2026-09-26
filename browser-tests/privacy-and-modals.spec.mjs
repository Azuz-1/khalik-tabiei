import { test, expect } from "@playwright/test";

const PHASE_TIMEOUT = 75_000;

async function quietExternalFonts(context) {
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
}

async function newPhone(browser, width = 390, height = 844) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  await quietExternalFonts(context);
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
  return { ...phone, code, name: "المالك" };
}

async function joinPlayer(browser, code, name) {
  const phone = await newPhone(browser);
  await phone.page.goto(`/join/${code}`);
  await phone.page.getByLabel("اسمك").fill(name);
  await phone.page.getByRole("button", { name: "دخول الغرفة" }).click();
  await expect(phone.page.getByRole("heading", { name: "أنت داخل 🎉" })).toBeVisible();
  return { ...phone, name };
}

/** The private screen is covered: the curtain action is showing and no role, prompt or Ready leaks. */
async function expectCovered(page, label) {
  await expect(page.getByRole("button", { name: "اعرض دوري", exact: true }), `${label} curtain`).toBeVisible({ timeout: PHASE_TIMEOUT });
  await expect(page.locator(".player-stage-main"), `${label} private stage`).toHaveCount(0);
  await expect(page.getByText("أنت المتخفي"), `${label} role`).toHaveCount(0);
  await expect(page.getByRole("button", { name: "جاهز", exact: true }), `${label} ready`).toHaveCount(0);
}

async function reveal(page) {
  await page.getByRole("button", { name: "اعرض دوري", exact: true }).click();
  await expect(page.locator(".player-stage-main")).toBeVisible();
}

async function isInert(locator) {
  return locator.evaluate((element) => element.closest("[inert]") !== null);
}

test("a role-blind challenge redeal puts every remaining phone back behind the privacy curtain", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await createOwner(browser);
  const readyPeer = await joinPlayer(browser, owner.code, "لاعب 2");
  const revealedPeer = await joinPlayer(browser, owner.code, "لاعب 3");
  const dropped = await joinPlayer(browser, owner.code, "لاعب 4");
  const survivors = [owner, readyPeer, revealedPeer];

  try {
    await owner.page.getByRole("button", { name: "ابدأ اللعبة", exact: true }).click();
    for (const player of [...survivors, dropped]) {
      await expectCovered(player.page, player.name);
      await reveal(player.page);
    }
    // Two phones get ready; one keeps its private role on screen without readying.
    await owner.page.getByRole("button", { name: "جاهز", exact: true }).click();
    await readyPeer.page.getByRole("button", { name: "جاهز", exact: true }).click();
    await expect(revealedPeer.page.locator(".player-stage-main")).toBeVisible();

    // An unready participant disappears; after the server grace the owner redeals.
    await dropped.context.close();
    const recover = owner.page.getByRole("button", { name: "إعادة توزيع التحدي", exact: true });
    await expect(recover).toBeEnabled({ timeout: PHASE_TIMEOUT });
    await recover.click();
    const dialog = owner.page.getByRole("dialog", { name: "إعادة توزيع التحدي؟" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "إعادة توزيع التحدي", exact: true }).click();

    // Same phase, same challenge index, a new private deal: every phone is covered again,
    // including the one that never left its revealed screen.
    for (const player of survivors) await expectCovered(player.page, `${player.name} after redeal`);
    await reveal(revealedPeer.page);
    await expect(revealedPeer.page.getByRole("button", { name: "جاهز", exact: true })).toBeVisible();
  } finally {
    await Promise.allSettled(survivors.map((player) => player.context.close()));
  }
});

test("open sheets and dialogs make every background layer inert, nest safely, and restore focus", async ({ browser }) => {
  test.setTimeout(120_000);
  const owner = await createOwner(browser);
  const second = await joinPlayer(browser, owner.code, "لاعب 2");
  const third = await joinPlayer(browser, owner.code, "لاعب 3");
  const page = owner.page;

  try {
    // Lobby: player manager sheet, then a nested kick confirmation.
    const openPlayers = page.locator("button.floating-players");
    await openPlayers.click();
    const manager = page.getByRole("dialog", { name: "اللاعبين" });
    await expect(manager).toBeVisible();
    expect(await isInert(page.locator("[data-game-surface]"))).toBe(true);
    expect(await isInert(page.locator(".privacy-link"))).toBe(true);
    expect(await isInert(manager)).toBe(false);

    await manager.locator(".manager-player-row", { hasText: "لاعب 3" }).getByRole("button", { name: "إخراج" }).click();
    const kick = page.getByRole("dialog", { name: "إخراج لاعب 3؟" });
    await expect(kick).toBeVisible();
    await expect(kick.getByRole("button", { name: "إلغاء" })).toBeFocused();
    // Hidden from assistive tech now, so address the sheet by its element, not its role.
    const managerPanel = page.locator(".player-manager-panel");
    expect(await isInert(managerPanel), "the sheet under a nested confirm is inert").toBe(true);
    expect(await managerPanel.getAttribute("aria-hidden")).toBe(null);
    expect(await managerPanel.evaluate((element) => element.closest('[aria-hidden="true"]') !== null)).toBe(true);
    expect(await isInert(kick)).toBe(false);

    await page.keyboard.press("Escape");
    await expect(kick).toBeHidden();
    expect(await isInert(managerPanel), "closing the confirm releases only its own lock").toBe(false);
    expect(await isInert(page.locator("[data-game-surface]")), "the sheet keeps the game locked").toBe(true);
    expect(await isInert(page.locator(".privacy-link"))).toBe(true);

    await manager.getByRole("button", { name: "إغلاق", exact: true }).click();
    await expect(manager).toBeHidden();
    await expect(openPlayers).toBeFocused();
    expect(await isInert(page.locator("[data-game-surface]"))).toBe(false);
    expect(await isInert(page.locator(".privacy-link"))).toBe(false);

    // Gameplay: the options sheet and the end-game confirmation lock the HUD rail too.
    await page.getByRole("button", { name: "ابدأ اللعبة", exact: true }).click();
    const menu = page.getByRole("button", { name: "المزيد", exact: true });
    await expect(menu).toBeVisible({ timeout: PHASE_TIMEOUT });
    await menu.click();
    const sheet = page.getByRole("dialog", { name: "خيارات اللعبة" });
    await expect(sheet).toBeVisible();
    expect(await isInert(page.locator(".game-hud")), "the HUD rail behind its own sheet is inert").toBe(true);
    expect(await isInert(page.locator("[data-app-content]"))).toBe(true);

    // Tab stays inside the sheet.
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute("aria-label"))).toBe("خيارات اللعبة");
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(menu).toBeFocused();
    expect(await isInert(page.locator(".game-hud"))).toBe(false);

    await menu.click();
    await sheet.getByRole("button", { name: "إنهاء اللعبة" }).click();
    const end = page.getByRole("dialog", { name: "إنهاء اللعبة؟" });
    await expect(end).toBeVisible();
    expect(await isInert(page.locator(".game-hud")), "the HUD rail is not reachable behind the confirm").toBe(true);
    expect(await isInert(page.locator("[data-app-content]"))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(end).toBeHidden();
    expect(await isInert(page.locator(".game-hud"))).toBe(false);
    expect(await isInert(page.locator("[data-app-content]"))).toBe(false);
  } finally {
    await Promise.allSettled([second.context.close(), third.context.close(), owner.context.close()]);
  }
});
