import { test, expect } from "@playwright/test";

async function quietExternalFonts(context) {
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
}

async function createHost(browser) {
  const context = await browser.newContext({ viewport: { width: 1365, height: 768 } });
  await quietExternalFonts(context);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "سوّ غرفة" }).click();
  const code = (await page.locator(".code-value").textContent())?.trim();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  return { context, page, code };
}

async function joinPlayer(browser, code, name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await quietExternalFonts(context);
  const page = await context.newPage();
  await page.goto(`/join/${code}`);
  await page.getByLabel("اسمك").fill(name);
  await page.getByRole("button", { name: "دخول الغرفة" }).click();
  await expect(page.getByRole("heading", { name: "أنت داخل 🎉" })).toBeVisible();
  return { context, page, name };
}

async function expectRosterSize(hostPage, size) {
  await expect(hostPage.locator(".count-pill")).toContainText(String(size));
  await expect(hostPage.locator(".seat-badge")).toHaveCount(size);
  const seats = await hostPage.locator(".seat-badge").allTextContents();
  expect(new Set(seats).size).toBe(size);
}

test("Host and Player rendered flows stay accessible at 3, 6, and 10 players", async ({ browser }) => {
  const host = await createHost(browser);
  const players = [];
  try {
    for (let index = 1; index <= 10; index += 1) {
      players.push(await joinPlayer(browser, host.code, `لاعب${index}`));
      if ([3, 6, 10].includes(index)) await expectRosterSize(host.page, index);
    }

    const mobileOverflow = await players[0].page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(mobileOverflow).toBeLessThanOrEqual(1);

    const viewport = await host.page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).not.toContain("maximum-scale");

    const closeRoom = host.page.getByRole("button", { name: "إغلاق الغرفة" });
    await closeRoom.click();
    const closeDialog = host.page.getByRole("dialog", { name: "إغلاق الغرفة؟" });
    await expect(closeDialog).toBeVisible();
    await expect(host.page.locator("[data-app-content]")).toHaveAttribute("inert", "");
    await expect(host.page.getByRole("button", { name: "إلغاء" })).toBeFocused();
    expect(await host.page.getByRole("dialog").count()).toBe(1);
    await host.page.keyboard.press("Tab");
    await expect(host.page.getByRole("button", { name: "إغلاق الغرفة", exact: true }).last()).toBeFocused();
    await host.page.keyboard.press("Escape");
    await expect(closeDialog).toBeHidden();
    await expect(closeRoom).toBeFocused();

    const stablePlayerName = "لاعب6";
    const stableChip = host.page.locator(".chip", { hasText: stablePlayerName });
    const stableSeat = (await stableChip.locator(".seat-badge").textContent())?.trim();

    await players[4].context.close();
    await expect(host.page.locator(".offline-player-banner")).toContainText("لاعب5");
    await host.page.locator("button.floating-players").click();
    const manager = host.page.getByRole("dialog", { name: "اللاعبين" });
    await expect(manager).toBeVisible();
    await expect(manager.locator(".manager-player-row").first()).toContainText("لاعب5");
    await expect(host.page.locator("[data-game-surface]")).toHaveAttribute("inert", "");

    const offlineRow = manager.locator(".manager-player-row", { hasText: "لاعب5" });
    await offlineRow.getByRole("button", { name: "إخراج" }).click();
    const kickDialog = host.page.getByRole("dialog", { name: "إخراج لاعب5؟" });
    await expect(kickDialog).toBeVisible();
    await kickDialog.getByRole("button", { name: "إخراج", exact: true }).click();
    await expect(kickDialog).toBeHidden();
    await expect(manager.locator(".manager-player-row", { hasText: "لاعب5" })).toHaveCount(0);
    await expect(manager).toContainText("هويات ممنوعة من الرجوع");
    await expect(manager).toContainText("لاعب5");

    await manager.getByRole("button", { name: "إغلاق" }).click();
    await expect(manager).toBeHidden();
    const stableSeatAfter = (await host.page.locator(".chip", { hasText: stablePlayerName }).locator(".seat-badge").textContent())?.trim();
    expect(stableSeatAfter).toBe(stableSeat);
  } finally {
    await Promise.allSettled(players.map((player) => player.context.close()));
    await host.context.close();
  }
});

test("Unicode names, stale confirmations, Player leave, focus restoration, and reduced motion work in browser", async ({ browser }) => {
  const host = await createHost(browser);
  const playerContexts = [];
  try {
    const salem = await joinPlayer(browser, host.code, "سالم");
    playerContexts.push(salem.context);

    const duplicateContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    playerContexts.push(duplicateContext);
    await quietExternalFonts(duplicateContext);
    const duplicate = await duplicateContext.newPage();
    await duplicate.goto(`/join/${host.code}`);
    await duplicate.getByLabel("اسمك").fill("سالم\u200b");
    await duplicate.getByRole("button", { name: "دخول الغرفة" }).click();
    await expect(duplicate.getByText("فيه لاعب بنفس الاسم، غيّره شوي")).toBeVisible();

    const invisibleContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    playerContexts.push(invisibleContext);
    await quietExternalFonts(invisibleContext);
    const invisible = await invisibleContext.newPage();
    await invisible.goto(`/join/${host.code}`);
    await invisible.getByLabel("اسمك").fill("\u200b\u2060");
    await expect(invisible.getByRole("button", { name: "دخول الغرفة" })).toBeDisabled();

    const emoji = await joinPlayer(browser, host.code, "👨‍👩‍👧‍👦👩‍💻");
    playerContexts.push(emoji.context);
    await expect(emoji.page.locator(".chip", { hasText: "👨‍👩‍👧‍👦👩‍💻" })).toBeVisible();

    const leaveButton = emoji.page.getByRole("button", { name: "الخروج من الغرفة" });
    await leaveButton.click();
    const leaveDialog = emoji.page.getByRole("dialog", { name: "الخروج من الغرفة؟" });
    await expect(leaveDialog).toBeVisible();
    await expect(emoji.page.getByRole("button", { name: "إلغاء" })).toBeFocused();
    await emoji.page.keyboard.press("Escape");
    await expect(leaveDialog).toBeHidden();
    await expect(leaveButton).toBeFocused();

    await host.page.locator("button.floating-players").click();
    const manager = host.page.getByRole("dialog", { name: "اللاعبين" });
    const salemRow = manager.locator(".manager-player-row", { hasText: "سالم" });
    await salemRow.getByRole("button", { name: "إخراج" }).click();
    const staleDialog = host.page.getByRole("dialog", { name: "إخراج سالم؟" });
    await expect(staleDialog).toBeVisible();

    await salem.page.getByRole("button", { name: "الخروج من الغرفة" }).click();
    await salem.page.getByRole("dialog", { name: "الخروج من الغرفة؟" }).getByRole("button", { name: "اخرج" }).click();
    await expect(salem.page.getByRole("button", { name: "سوّ غرفة" })).toBeVisible();
    await expect(staleDialog).toBeHidden();

    await manager.getByRole("button", { name: "إغلاق" }).click();

    await leaveButton.click();
    await emoji.page.getByRole("dialog", { name: "الخروج من الغرفة؟" }).getByRole("button", { name: "اخرج" }).click();
    await expect(emoji.page.getByRole("button", { name: "سوّ غرفة" })).toBeVisible();

    const reduced = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
    playerContexts.push(reduced);
    await quietExternalFonts(reduced);
    const reducedPage = await reduced.newPage();
    await reducedPage.goto("/");
    const animationDuration = await reducedPage.locator(".home-screen").evaluate((element) => getComputedStyle(element).animationDuration);
    expect(animationDuration).toBe("0.001ms");
  } finally {
    await Promise.allSettled(playerContexts.map((context) => context.close()));
    await host.context.close();
  }
});
