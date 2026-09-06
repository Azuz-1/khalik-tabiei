import { test, expect } from "@playwright/test";

/**
 * A real Chromium journey through an actual game: four isolated browser
 * contexts join, one genuinely goes offline and comes back to the same signed
 * seat, the Host kicks a different player, and the remaining three play a full
 * three-round TEAM match to a real GAME_OVER.
 *
 * Every wait is on observable UI or authoritative state. There are no fixed
 * sleeps standing in for phase progress, so the test tracks the production
 * timings (~5s countdown + 1s action + 2s hold + 2.5s reveal per challenge)
 * rather than racing them.
 */

const PHASE_TIMEOUT = 40_000;

/** Records every inbound WebSocket frame so public state can be inspected. */
const RECORD_FRAMES = `
window.__frames = [];
(function () {
  const Native = window.WebSocket;
  function Patched(url, protocols) {
    const socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') window.__frames.push(event.data);
    });
    return socket;
  }
  Patched.prototype = Native.prototype;
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Patched[key] = Native[key];
  window.WebSocket = Patched;
})();
`;

async function quietExternalFonts(context) {
  await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) => route.abort());
}

async function newRecordedContext(browser, options) {
  const context = await browser.newContext(options);
  await quietExternalFonts(context);
  await context.addInitScript(RECORD_FRAMES);
  return context;
}

async function createHost(browser) {
  const context = await newRecordedContext(browser, { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "سوّ غرفة" }).click();
  const code = (await page.locator(".code-value").textContent())?.trim();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  return { context, page, code, name: "HOST" };
}

async function joinPlayer(browser, code, name) {
  const context = await newRecordedContext(browser, {
    viewport: { width: 390, height: 844 },
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

/** The seat number the Host roster shows for a given player name. */
async function hostSeatFor(hostPage, name) {
  const chip = hostPage.locator(".chip", { hasText: name });
  await expect(chip).toHaveCount(1);
  return (await chip.locator(".seat-badge").textContent())?.trim();
}

/**
 * Reads each player's private screen to find this round's impostor. Impostor
 * selection is weighted-random, so this is re-derived every round and never
 * assumes the role moved.
 */
async function identifyRoles(players) {
  const seen = [];
  for (const player of players) {
    await expect(player.page.locator(".q-card")).toBeVisible({ timeout: PHASE_TIMEOUT });
    const isImpostor = await player.page.getByText("أنت المتخفي").isVisible();
    seen.push({ ...player, isImpostor });
  }
  const impostors = seen.filter((player) => player.isImpostor);
  expect(impostors, "exactly one impostor per challenge").toHaveLength(1);
  return { impostor: impostors[0], normals: seen.filter((player) => !player.isImpostor) };
}

/**
 * Votes and waits for the vote to be observably registered. The final vote of a
 * challenge resolves the round server-side, so that voter can move straight to
 * the result screen without ever rendering the confirmation badge; both are
 * valid evidence that the vote landed.
 */
async function castVote(voter, targetName) {
  const option = voter.page.locator(".vote-opt", { hasText: targetName });
  await expect(option).toHaveCount(1);
  await option.click();
  await voter.page.getByRole("button", { name: "أكّد التصويت" }).click();
  await expect
    .poll(
      async () => {
        const rendered = await voter.page.locator("body").innerText();
        return /تم تسجيل صوتك|مسكتوا المتخفي|ما مسكتوه|المتخفي نجا/.test(rendered);
      },
      { timeout: PHASE_TIMEOUT, message: `${voter.name}'s vote was never registered` },
    )
    .toBe(true);
}

/** Recursively asserts no frame ever carries a voter-to-target mapping. */
function assertNoVoterMapping(frames, label) {
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      expect(
        /voter|ballot|votedFor|votesByUid/i.test(key),
        `${label}: frame at ${path} exposed a voter-identifying key "${key}"`,
      ).toBe(false);
      if ((key === "voteTally" || key === "liveVoteTally") && Array.isArray(value)) {
        for (const entry of value) {
          expect(
            Object.keys(entry).sort(),
            `${label}: ${key} entries must stay aggregate-only`,
          ).toEqual(["name", "uid", "votes"]);
        }
      }
      walk(value, `${path}.${key}`);
    }
  };

  for (const [index, raw] of frames.entries()) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    walk(parsed, `frame#${index}`);
  }
}

test("full game journey: join, offline/online, kick, three TEAM rounds, real GAME_OVER", async ({
  browser,
}) => {
  // Real production phase timings, three rounds, six browser contexts.
  test.setTimeout(240_000);
  const startedAt = Date.now();

  const host = await createHost(browser);
  const joined = [];
  try {
    // 1-2. Four real players join from separate session contexts.
    for (let index = 1; index <= 4; index += 1) {
      joined.push(await joinPlayer(browser, host.code, `لاعب${index}`));
    }
    await expect(host.page.locator(".seat-badge")).toHaveCount(4);

    // 3. Take one player genuinely offline at the browser-context level.
    const flaky = joined[3];
    const seatBefore = await hostSeatFor(host.page, flaky.name);
    await flaky.context.setOffline(true);

    // 4. Arabic connection feedback, and game actions really are unavailable.
    await expect(flaky.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeVisible({
      timeout: PHASE_TIMEOUT,
    });
    await expect(flaky.page.locator("[data-game-surface]")).toHaveAttribute("disabled", "");
    await expect(flaky.page.locator("[data-game-surface]")).toHaveAttribute("aria-busy", "true");
    await expect(flaky.page.getByRole("button", { name: "الخروج من الغرفة" })).toBeDisabled();

    // 5-6. Back online, reconnecting to the same signed identity and seat.
    await flaky.context.setOffline(false);
    await expect(flaky.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeHidden({
      timeout: PHASE_TIMEOUT,
    });
    await expect(flaky.page.locator("[data-game-surface]")).not.toHaveAttribute("disabled", "");
    await expect(flaky.page.getByRole("button", { name: "الخروج من الغرفة" })).toBeEnabled();
    await expect(flaky.page.locator(".chip", { hasText: `${flaky.name} (أنت)` })).toBeVisible();
    await expect(host.page.locator(".seat-badge")).toHaveCount(4);
    expect(await hostSeatFor(host.page, flaky.name)).toBe(seatBefore);

    // 7-8. The Host kicks a different player; three remain.
    const kicked = joined[1];
    await host.page
      .locator(".chip", { hasText: kicked.name })
      .getByRole("button", { name: new RegExp(`^إخراج ${kicked.name}`) })
      .click();
    const kickDialog = host.page.getByRole("dialog", { name: `إخراج ${kicked.name}؟` });
    await expect(kickDialog).toBeVisible();
    await kickDialog.getByRole("button", { name: "إخراج", exact: true }).click();
    await expect(kickDialog).toBeHidden();
    await expect(host.page.locator(".seat-badge")).toHaveCount(3);

    const players = [joined[0], joined[2], joined[3]];

    // 9. A real TEAM game over three configured rounds.
    const teamCard = host.page.locator(".mode-select-card", {
      has: host.page.locator("strong", { hasText: /^جماعي$/ }),
    });
    await teamCard.click();
    await expect(teamCard).toHaveAttribute("aria-pressed", "true");

    const threeRounds = host.page.locator(".round-opt").filter({ hasText: /^3$/ });
    await threeRounds.click();
    await expect(threeRounds).toHaveAttribute("aria-pressed", "true");

    await host.page.getByRole("button", { name: "ابدأ اللعبة" }).click();

    // 10. Play every round through the real physical sequence.
    for (let round = 1; round <= 3; round += 1) {
      await expect(
        host.page.getByRole("heading", { name: "شوفوا جوالاتكم" }),
      ).toBeVisible({ timeout: PHASE_TIMEOUT });
      await expect(host.page.getByText(`جولة ${round} من 3`)).toBeVisible();

      const { impostor, normals } = await identifyRoles(players);
      expect(normals).toHaveLength(2);

      for (const player of [impostor, ...normals]) {
        await player.page.getByRole("button", { name: "جاهز" }).click();
      }

      // Countdown -> action -> hold -> prompt reveal -> discussion, awaited on
      // the Host's own rendered state rather than a timer.
      await expect(host.page.locator(".host-countdown-number")).toBeVisible({
        timeout: PHASE_TIMEOUT,
      });
      await expect(host.page.locator(".host-prompt-reveal")).toBeVisible({
        timeout: PHASE_TIMEOUT,
      });
      await expect(
        host.page.getByRole("heading", { name: "مين تصرفه مو طبيعي؟" }),
      ).toBeVisible({ timeout: PHASE_TIMEOUT });

      await host.page.getByRole("button", { name: "ابدأ التصويت" }).click();
      await expect(host.page.getByRole("heading", { name: "صوّتوا" })).toBeVisible({
        timeout: PHASE_TIMEOUT,
      });

      // The impostor votes for a normal; both normals converge on the impostor.
      await castVote(impostor, normals[0].name);
      await castVote(normals[0], impostor.name);
      await castVote(normals[1], impostor.name);

      await expect(host.page.locator(".host-result-stage")).toBeVisible({
        timeout: PHASE_TIMEOUT,
      });
      await expect(host.page.getByText("مسكتوا المتخفي")).toBeVisible();
      await expect(host.page.locator(".impostor-name")).toHaveText(impostor.name);

      await host.page.locator(".host-result-stage .btn-primary").click();
    }

    // 11. A real GAME_OVER, not a synthesized end state.
    await expect(host.page.getByRole("heading", { name: "خلصت اللعبة 🎉" })).toBeVisible({
      timeout: PHASE_TIMEOUT,
    });
    await expect(host.page.getByText("مسكتوا المتخفي في 3 من 3 جولات")).toBeVisible();

    // 12. No voter-to-target mapping in any rendered or public state.
    for (const client of [host, ...players]) {
      const frames = await client.page.evaluate(() => window.__frames ?? []);
      expect(frames.length, `${client.name} received real server frames`).toBeGreaterThan(0);
      assertNoVoterMapping(frames, client.name);

      const rendered = await client.page.locator("body").innerText();
      expect(rendered).not.toMatch(/صوّت\s+(على|لـ)\s*\S+\s*→/);
    }

    // 13. Reported for the record; asserted structurally in the server suite.
    const durationMs = Date.now() - startedAt;
    expect(durationMs).toBeGreaterThan(0);
    test.info().annotations.push({
      type: "journey-duration-ms",
      description: String(durationMs),
    });
  } finally {
    await Promise.allSettled(joined.map((player) => player.context.close()));
    await host.context.close();
  }
});
