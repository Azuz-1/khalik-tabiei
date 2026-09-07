import { test, expect } from "@playwright/test";
import { NAME_MAX } from "../shared/constants.js";

/**
 * Rendered browser UX matrix. Every assertion here runs against real rendered
 * layout in Chromium — viewport sizes, computed direction, real scroll widths,
 * real disabled state and real transport failures. None of it is satisfied by
 * inspecting source strings.
 */

const DESKTOP = { width: 1920, height: 1080 };
const PHONE_SMALL = { width: 320, height: 568 };
const PHONE_LARGE = { width: 430, height: 932 };

async function quietExternalFonts(context) {
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
}

async function newContext(browser, options) {
  const context = await browser.newContext(options);
  await quietExternalFonts(context);
  return context;
}

async function createHost(browser, viewport = DESKTOP) {
  const context = await newContext(browser, { viewport });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "سوّ غرفة" }).click();
  const code = (await page.locator(".code-value").textContent())?.trim();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  return { context, page, code };
}

async function joinPlayer(browser, code, name, viewport = PHONE_LARGE) {
  const context = await newContext(browser, {
    viewport,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(`/join/${code}`);
  await page.getByLabel("اسمك").fill(name);
  await page.getByRole("button", { name: "دخول الغرفة" }).click();
  await expect(page.getByRole("heading", { name: "أنت داخل 🎉" })).toBeVisible();
  return { context, page, name };
}

/** Real measured overflow of the rendered document, not a style assertion. */
async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function expectRtlAndNoOverflow(page, label) {
  const direction = await page.evaluate(() => getComputedStyle(document.documentElement).direction);
  expect(direction, `${label} must render right-to-left`).toBe("rtl");
  expect(await horizontalOverflow(page), `${label} must not scroll horizontally`).toBeLessThanOrEqual(1);
}

test("Host challenge selector offers 3, 6, 9, and 12 and synchronizes the chosen target to Player Lobby", async ({
  browser,
}) => {
  const host = await createHost(browser);
  const players = [];
  try {
    const selector = host.page.getByRole("radiogroup", { name: "عدد التحديات" });
    const options = selector.getByRole("radio");
    await expect(options).toHaveCount(4);
    await expect(options.nth(0)).toHaveText("3");
    await expect(options.nth(1)).toHaveText("6");
    await expect(options.nth(2)).toHaveText("9");
    await expect(options.nth(3)).toHaveText("12");
    await expect(selector.getByRole("radio", { name: "9" })).toHaveAttribute("aria-checked", "true");

    const player = await joinPlayer(browser, host.code, "سالم", PHONE_SMALL);
    players.push(player);
    await expect(player.page.getByText(/9 تحديات بالضبط/)).toBeVisible();

    await selector.getByRole("radio", { name: "3" }).click();
    await expect(selector.getByRole("radio", { name: "3" })).toHaveAttribute("aria-checked", "true");
    await expect(host.page.getByText("🏅 3 تحديات")).toBeVisible();
    await expect(player.page.getByText(/3 تحديات بالضبط/)).toBeVisible();

    await selector.getByRole("radio", { name: "12" }).click();
    await expect(selector.getByRole("radio", { name: "12" })).toHaveAttribute("aria-checked", "true");
    await expect(host.page.getByText("🏅 12 تحديات")).toBeVisible();
    await expect(player.page.getByText(/12 تحديات بالضبط/)).toBeVisible();
    await expectRtlAndNoOverflow(host.page, "Host challenge selector");
    await expectRtlAndNoOverflow(player.page, "Player selected challenge target");
  } finally {
    await Promise.allSettled(players.map((player) => player.context.close()));
    await host.context.close();
  }
});

test("Host at 1920x1080 renders a full ten-player roster in RTL without horizontal overflow", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const host = await createHost(browser, DESKTOP);
  const players = [];
  try {
    const viewportSize = host.page.viewportSize();
    expect(viewportSize).toEqual(DESKTOP);

    for (let index = 1; index <= 10; index += 1) {
      players.push(await joinPlayer(browser, host.code, `لاعب${index}`, PHONE_SMALL));
    }

    await expect(host.page.locator(".seat-badge")).toHaveCount(10);
    await expect(host.page.locator(".count-pill")).toContainText("10");
    const seats = await host.page.locator(".seat-badge").allTextContents();
    expect(new Set(seats).size, "every seat number is distinct").toBe(10);

    await expectRtlAndNoOverflow(host.page, "Host 1920x1080 with 10 players");
    for (const chip of await host.page.locator(".chip").all()) {
      const box = await chip.boundingBox();
      expect(box, "every player chip is actually rendered").not.toBeNull();
      expect(box.width).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(DESKTOP.width + 1);
    }
  } finally {
    await Promise.allSettled(players.map((player) => player.context.close()));
    await host.context.close();
  }
});

test("small and large phone viewports render the Player UI in RTL without horizontal overflow", async ({
  browser,
}) => {
  const host = await createHost(browser);
  const players = [];
  try {
    for (const [label, viewport] of [
      ["small phone", PHONE_SMALL],
      ["large phone", PHONE_LARGE],
    ]) {
      const player = await joinPlayer(browser, host.code, `لاعب${players.length + 1}`, viewport);
      players.push(player);
      expect(player.page.viewportSize()).toEqual(viewport);
      await expectRtlAndNoOverflow(player.page, `${label} player lobby`);

      const exit = player.page.getByRole("button", { name: "الخروج من الغرفة" });
      await expect(exit).toBeVisible();
      const box = await exit.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(-1);
      expect(box.y, `${label} Exit should live in the top utility area`).toBeLessThan(120);
      expect(box.height, `${label} Exit touch target`).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await Promise.allSettled(players.map((player) => player.context.close()));
    await host.context.close();
  }
});

test("a valid near-NAME_MAX Arabic display name is accepted and rendered intact", async ({
  browser,
}) => {
  const host = await createHost(browser);
  const players = [];
  try {
    const longName = "عبدالرحمن الشمري";
    expect([...longName].length, "the fixture should sit at the documented ceiling").toBe(NAME_MAX);

    const player = await joinPlayer(browser, host.code, longName, PHONE_SMALL);
    players.push(player);

    await expect(player.page.locator(".chip", { hasText: `${longName} (أنت)` })).toBeVisible();
    await expect(host.page.locator(".chip", { hasText: longName })).toHaveCount(1);

    await expectRtlAndNoOverflow(player.page, "small phone with a long Arabic name");
    await expectRtlAndNoOverflow(host.page, "Host roster with a long Arabic name");

    const rejected = await newContext(browser, { viewport: PHONE_SMALL });
    try {
      const page = await rejected.newPage();
      await page.goto(`/join/${host.code}`);
      const field = page.getByLabel("اسمك");
      const join = page.getByRole("button", { name: "دخول الغرفة" });

      await field.fill(longName);
      await expect(join, "a name at the ceiling is accepted").toBeEnabled();

      await field.fill(`${longName}ي`);
      await expect(join, "one grapheme past the ceiling is refused").toBeDisabled();
    } finally {
      await rejected.close();
    }
  } finally {
    await Promise.allSettled(players.map((player) => player.context.close()));
    await host.context.close();
  }
});

test("network loss disables gameplay but keeps Exit reachable and reports unsent leave visibly", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const host = await createHost(browser);
  const players = [];
  try {
    const player = await joinPlayer(browser, host.code, "سالم", PHONE_LARGE);
    players.push(player);

    const exit = player.page.getByRole("button", { name: "الخروج من الغرفة" });
    const banner = player.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…");
    const surface = player.page.locator("[data-game-surface]");

    await player.context.setOffline(true);
    await expect(banner, "Arabic reconnect UI").toBeVisible({ timeout: 30_000 });
    await expect(surface).toHaveAttribute("disabled", "");
    await expect(surface).toHaveAttribute("aria-busy", "true");

    // Exit intentionally sits outside the disabled game fieldset so a stranded
    // player can still understand their options while offline.
    await expect(exit, "Exit remains reachable while gameplay is offline").toBeEnabled();
    await exit.click();
    const dialog = player.page.getByRole("dialog", { name: "الخروج من الغرفة؟" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("الاتصال");

    // We never fake a successful server leave. Confirming while offline must
    // report that the request was not sent and keep the player in-room locally.
    await dialog.getByRole("button", { name: "اخرج" }).click();
    await expect(player.page.locator(".confirm-error")).toBeVisible();
    await expect(player.page.locator(".confirm-error")).toHaveText(
      "الاتصال مو جاهز، لذلك ما أرسلنا الطلب.",
    );
    await expect(player.page.getByRole("button", { name: "سوّ غرفة" })).toHaveCount(0);

    await dialog.getByRole("button", { name: "إلغاء" }).click();
    await expect(dialog).toBeHidden();
    await player.context.setOffline(false);
    await expect(banner).toBeHidden({ timeout: 30_000 });
    await expect(surface).not.toHaveAttribute("disabled", "");
    await expect(exit).toBeEnabled();
    await expect(host.page.locator(".seat-badge")).toHaveCount(1);
  } finally {
    await Promise.allSettled(players.map((player) => player.context.close()));
    await host.context.close();
  }
});
