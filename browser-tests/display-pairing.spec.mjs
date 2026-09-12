import { test, expect } from "@playwright/test";

async function quietExternalFonts(context) {
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
}

async function createOwner(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await quietExternalFonts(context);
  const page = await context.newPage();
  await page.goto(`/join/${code}`);
  await page.getByLabel("اسمك").fill(name);
  await page.getByRole("button", { name: "دخول الغرفة" }).click();
  await expect(page.getByRole("heading", { name: "أنت داخل 🎉" })).toBeVisible();
  return { context, page };
}

test("owner pairs /tv with six digits and TV hands off to the existing public Display", async ({ browser }) => {
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await quietExternalFonts(tvContext);
  const tv = await tvContext.newPage();
  const owner = await createOwner(browser);
  let first;
  let second;

  try {
    await tv.goto("/tv");
    await expect(tv.getByRole("heading", { name: "اربط التلفزيون" })).toBeVisible();
    const visibleCode = await tv.locator(".tv-pairing-code").textContent();
    const pairingCode = visibleCode?.replace(/\D/g, "") ?? "";
    expect(pairingCode).toMatch(/^\d{6}$/);
    await expect(tv.getByText("بانتظار الربط من جوال المضيف…", { exact: true })).toBeVisible();
    expect(tv.url()).toMatch(/\/tv$/);
    expect(tv.url()).not.toContain("secret");

    await owner.page.getByRole("button", { name: "📺 العب على التلفزيون", exact: true }).click();
    const panel = owner.page.getByRole("dialog", { name: "إدارة شاشة العرض" });
    await expect(panel).toBeVisible();
    const input = panel.getByLabel("رمز التلفزيون");
    await input.fill(`${pairingCode.slice(0, 3)}-${pairingCode.slice(3)}`);
    await expect(input).toHaveValue(`${pairingCode.slice(0, 3)} ${pairingCode.slice(3)}`);
    await panel.getByRole("button", { name: "ربط التلفزيون", exact: true }).click();
    await expect(panel.getByText("تم ربط التلفزيون ✓ التلفزيون راح يفتح شاشة اللعبة تلقائيًا.", { exact: true })).toBeVisible();

    await expect.poll(() => new URL(tv.url()).pathname).toBe(`/display/${owner.code}`);
    expect(tv.url()).not.toContain("#token=");
    expect(tv.url()).not.toContain("secret=");
    await expect(tv.getByText("شاشة العرض الاختيارية", { exact: true })).toBeVisible();
    await expect(tv.locator(".code-value")).toHaveText(owner.code);
    await expect(tv.getByText("امسح الرمز عشان تدخل كلاعب", { exact: true })).toBeVisible();
    await expect(tv.locator(".count-pill")).toContainText("1");

    first = await joinPlayer(browser, owner.code, "لاعب 2");
    second = await joinPlayer(browser, owner.code, "لاعب 3");
    await expect(tv.locator(".count-pill")).toContainText("3");
    await expect(tv.getByText("لاعب 2", { exact: true })).toBeVisible();
    await expect(tv.getByText("لاعب 3", { exact: true })).toBeVisible();

    const start = owner.page.getByRole("button", { name: "ابدأ اللعبة", exact: true });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(tv.getByText("شاشة عرض · بدون تحكم", { exact: true })).toBeVisible();
    await expect(tv.getByRole("heading", { name: "شوفوا جوالاتكم", exact: true })).toBeVisible();
    await expect(tv.getByText("أنت المتخفي", { exact: true })).toHaveCount(0);
    await expect(tv.getByRole("button", { name: "جاهز", exact: true })).toHaveCount(0);
  } finally {
    await second?.context.close();
    await first?.context.close();
    await owner.context.close();
    await tvContext.close();
  }
});
