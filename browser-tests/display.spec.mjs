import { test, expect } from "@playwright/test";

async function quietExternalFonts(context) {
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
}

async function createOwner(browser) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    hasTouch: true,
  });
  await quietExternalFonts(context);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "سوّ غرفة والعب معنا", exact: true }).click();
  await page.getByLabel("اسمك").fill("المالك");
  await page.getByRole("button", { name: "إنشاء الغرفة", exact: true }).click();
  const code = (await page.locator(".code-value").textContent())?.trim();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  return { context, page, code };
}

async function joinPlayer(browser, code, name) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await quietExternalFonts(context);
  const page = await context.newPage();
  await page.goto(`/join/${code}`);
  await page.getByLabel("اسمك").fill(name);
  await page.getByRole("button", { name: "دخول الغرفة" }).click();
  await expect(page.getByRole("heading", { name: "أنت داخل 🎉" })).toBeVisible();
  return { context, page };
}

test("owner can attach, refresh, and revoke a public Display after the game starts", async ({ browser }) => {
  const owner = await createOwner(browser);
  const first = await joinPlayer(browser, owner.code, "لاعب 2");
  const second = await joinPlayer(browser, owner.code, "لاعب 3");
  let displayContext;

  try {
    const start = owner.page.getByRole("button", { name: "ابدأ اللعبة", exact: true });
    await expect(start).toBeEnabled();
    await start.click();

    // The owner remains a real player during private gameplay. Display
    // management is now a secondary action inside the compact gameplay HUD.
    await expect(owner.page.getByRole("button", { name: "جاهز", exact: true })).toBeVisible();
    await owner.page.getByRole("button", { name: "المزيد", exact: true }).click();
    const gameOptions = owner.page.getByRole("dialog", { name: "خيارات اللعبة" });
    await expect(gameOptions).toBeVisible();
    await gameOptions.getByRole("button", { name: "📺 شاشة العرض", exact: true }).click();
    await expect(owner.page.getByRole("dialog", { name: "إدارة شاشة العرض" })).toBeVisible();

    await owner.page.getByRole("button", { name: "جهّز رابط شاشة العرض", exact: true }).click();
    const link = owner.page.getByTestId("active-display-link");
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toContain(`/display/${owner.code}#token=`);

    displayContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await quietExternalFonts(displayContext);
    const displayPage = await displayContext.newPage();
    await displayPage.goto(href);

    await expect(displayPage.getByText("شاشة عرض · بدون تحكم", { exact: true })).toBeVisible();
    await expect(displayPage.getByRole("heading", { name: "شوفوا جوالاتكم", exact: true })).toBeVisible();
    await expect(displayPage.getByText("أنت المتخفي", { exact: true })).toHaveCount(0);
    await expect.poll(() => displayPage.url()).not.toContain("#token=");

    // Refresh must keep this same physical Display identity and reclaim the one
    // active slot rather than rejecting itself as a second screen.
    await displayPage.reload();
    await expect(displayPage.getByText("شاشة عرض · بدون تحكم", { exact: true })).toBeVisible();
    await expect(displayPage.getByRole("heading", { name: "شوفوا جوالاتكم", exact: true })).toBeVisible();

    // Revocation remains available mid-game and must disconnect the public
    // screen while leaving the owner's private gameplay surface intact.
    await owner.page.getByRole("button", { name: "إيقاف أي شاشة عرض وإبطال الرابط", exact: true }).click();
    await expect(displayPage.getByText("تم إيقاف رابط شاشة العرض من مالك الغرفة.", { exact: true })).toBeVisible();
    await expect(owner.page.getByRole("button", { name: "جاهز", exact: true })).toBeVisible();
    await expect(owner.page.getByRole("button", { name: "جهّز رابط شاشة العرض", exact: true })).toBeVisible();
  } finally {
    await displayContext?.close();
    await second.context.close();
    await first.context.close();
    await owner.context.close();
  }
});
