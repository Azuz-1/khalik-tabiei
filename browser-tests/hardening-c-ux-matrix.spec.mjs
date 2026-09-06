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

    // The whole ten-player roster must be laid out inside the viewport.
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

      // The primary exit affordance must be reachable inside the viewport.
      const exit = player.page.getByRole("button", { name: "الخروج من الغرفة" });
      await expect(exit).toBeVisible();
      const box = await exit.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
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

    // Rendered intact on the player's own device and on the shared Host screen.
    await expect(player.page.locator(".chip", { hasText: `${longName} (أنت)` })).toBeVisible();
    await expect(host.page.locator(".chip", { hasText: longName })).toHaveCount(1);

    await expectRtlAndNoOverflow(player.page, "small phone with a long Arabic name");
    await expectRtlAndNoOverflow(host.page, "Host roster with a long Arabic name");

    // One character past the ceiling must be refused before it can be sent.
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

test("a real network loss shows Arabic reconnect UI, disables game actions, and surfaces visible failure feedback", async ({
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

    // 1. Genuinely lose the network at the browser-context level.
    await player.context.setOffline(true);
    await expect(banner, "Arabic reconnect UI").toBeVisible({ timeout: 30_000 });
    // Game actions really are unavailable, not merely styled as unavailable.
    await expect(surface).toHaveAttribute("disabled", "");
    await expect(exit, "in-game actions are disabled while offline").toBeDisabled();

    // 2. Recover, then open a real confirmation while online.
    await player.context.setOffline(false);
    await expect(banner).toBeHidden({ timeout: 30_000 });
    await expect(exit).toBeEnabled();
    await exit.click();
    const dialog = player.page.getByRole("dialog", { name: "الخروج من الغرفة؟" });
    await expect(dialog).toBeVisible();

    // 3. Lose the network again with the request still unsent. The dialog is
    //    outside the inert app content, so it stays operable by design — the
    //    exit button below is queried by CSS because inert hides it from
    //    role-based queries while a dialog is open.
    await player.context.setOffline(true);
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(surface).toHaveAttribute("disabled", "");
    await expect(player.page.locator("button.floating-exit")).toBeDisabled();

    // Confirming an action that cannot reach the server must fail visibly.
    await dialog.getByRole("button", { name: "اخرج" }).click();
    await expect(player.page.locator(".confirm-error")).toBeVisible();
    await expect(player.page.locator(".confirm-error")).toHaveText(
      "الاتصال مو جاهز، لذلك ما أرسلنا الطلب.",
    );
    // The player is still in the room: a failed request changed nothing.
    await expect(player.page.getByRole("button", { name: "سوّ غرفة" })).toHaveCount(0);

    // Recovery restores the UI once the dialog is dismissed.
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
