import { test, expect } from "@playwright/test";

/**
 * A real Chromium journey through an actual competitive game: four isolated
 * browser contexts join, one genuinely goes offline and recovers to the same
 * signed seat, the Host kicks a different player, and the remaining three play
 * nine real Challenges to GAME_OVER under the production timers.
 *
 * Every phase wait is on rendered UI or authoritative state; no fixed sleeps
 * stand in for gameplay correctness.
 */

const PHASE_TIMEOUT = 40_000;

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

async function hostSeatFor(hostPage, name) {
  const chip = hostPage.locator(".chip", { hasText: name });
  await expect(chip).toHaveCount(1);
  return (await chip.locator(".seat-badge").textContent())?.trim();
}

async function identifyRoles(players) {
  const seen = [];
  for (const player of players) {
    await expect(player.page.locator(".q-card")).toBeVisible({ timeout: PHASE_TIMEOUT });
    const isImpostor = await player.page.getByText("أنت المتخفي").isVisible();
    seen.push({ ...player, isImpostor });
  }
  const impostors = seen.filter((player) => player.isImpostor);
  expect(impostors, "exactly one impostor per stint").toHaveLength(1);
  return { impostor: impostors[0], normals: seen.filter((player) => !player.isImpostor) };
}

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

function assertNoVoterMapping(frames, label) {
  const violations = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (/voter|ballot|votedFor|votesByUid|correctVoteStreakStart|pendingRoundScores/i.test(key)) {
        violations.push(`${path}: private key ${key}`);
      }
      if (key === "liveVoteTally") violations.push(`${path}: live target totals serialized`);
      if (key === "voteTally" && Array.isArray(value)) {
        for (const entry of value) {
          const keys = Object.keys(entry).sort().join(",");
          if (keys !== "name,uid,votes") violations.push(`${path}.voteTally: non-aggregate entry keys ${keys}`);
        }
      }
      walk(value, `${path}.${key}`);
    }
  };

  for (const [index, raw] of frames.entries()) {
    try {
      walk(JSON.parse(raw), `frame#${index}`);
    } catch {
      // Ignore non-JSON frames if any future transport metadata is introduced.
    }
  }

  expect(violations, `${label}: WebSocket privacy violations`).toEqual([]);
}

async function playCaughtChallenge(host, players, globalChallenge) {
  await expect(host.page.getByRole("heading", { name: "شوفوا جوالاتكم" })).toBeVisible({
    timeout: PHASE_TIMEOUT,
  });
  await expect(host.page.getByText(new RegExp(`التحدّي ${globalChallenge} من 9`))).toBeVisible();

  const { impostor, normals } = await identifyRoles(players);
  expect(normals).toHaveLength(2);

  for (const player of [impostor, ...normals]) {
    await player.page.getByRole("button", { name: "جاهز" }).click();
  }

  await expect(host.page.locator(".host-countdown-number")).toBeVisible({ timeout: PHASE_TIMEOUT });
  if (globalChallenge === 1) {
    for (const player of players) {
      await expect(player.page.locator(".player-countdown-number")).toBeVisible({ timeout: PHASE_TIMEOUT });
    }
    await expect(players[0].page.locator(".player-action-title")).toBeVisible({ timeout: PHASE_TIMEOUT });
  }

  await expect(host.page.locator(".host-prompt-reveal")).toBeVisible({ timeout: PHASE_TIMEOUT });
  await expect(host.page.getByRole("heading", { name: "مين تصرفه مو طبيعي؟" })).toBeVisible({
    timeout: PHASE_TIMEOUT,
  });

  await host.page.getByRole("button", { name: "ابدأ التصويت" }).click();
  await expect(host.page.getByRole("heading", { name: "صوّتوا" })).toBeVisible({ timeout: PHASE_TIMEOUT });
  await expect(host.page.getByText("الأصوات مخفية للحين")).toBeVisible();
  await expect(host.page.locator(".vote-board")).toHaveCount(0);

  await castVote(impostor, normals[0].name);
  await castVote(normals[0], impostor.name);
  await castVote(normals[1], impostor.name);

  await expect(host.page.locator(".host-result-stage")).toBeVisible({ timeout: PHASE_TIMEOUT });
  await expect(host.page.getByText("مسكتوا المتخفي")).toBeVisible();
  await expect(host.page.locator(".impostor-name")).toHaveText(impostor.name);
  await expect(host.page.getByText("النقاط بعد دور المتخفي")).toBeVisible();

  return { impostor, normals };
}

test("full game journey: reconnect, kick, competitive scoring, nine Challenges, real GAME_OVER", async ({
  browser,
}) => {
  // Nine production-timed Challenges take roughly 7–8 minutes end-to-end.
  // Keep the real timers here so this journey validates the shipped physical cadence.
  test.setTimeout(600_000);
  const startedAt = Date.now();

  const host = await createHost(browser);
  const joined = [];
  try {
    for (let index = 1; index <= 4; index += 1) {
      joined.push(await joinPlayer(browser, host.code, `لاعب${index}`));
    }
    await expect(host.page.locator(".seat-badge")).toHaveCount(4);

    const flaky = joined[3];
    const seatBefore = await hostSeatFor(host.page, flaky.name);
    await flaky.context.setOffline(true);
    await expect(flaky.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeVisible({
      timeout: PHASE_TIMEOUT,
    });
    await expect(flaky.page.locator("[data-game-surface]")).toHaveAttribute("disabled", "");
    await expect(flaky.page.getByRole("button", { name: "الخروج من الغرفة" })).toBeEnabled();

    await flaky.context.setOffline(false);
    await expect(flaky.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeHidden({
      timeout: PHASE_TIMEOUT,
    });
    await expect(flaky.page.locator("[data-game-surface]")).not.toHaveAttribute("disabled", "");
    await expect(flaky.page.locator(".chip", { hasText: `${flaky.name} (أنت)` })).toBeVisible();
    expect(await hostSeatFor(host.page, flaky.name)).toBe(seatBefore);

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
    await expect(host.page.getByText("🏅 9 تحديات أساسية")).toBeVisible();
    await host.page.getByRole("button", { name: "ابدأ اللعبة" }).click();

    for (let challenge = 1; challenge <= 9; challenge += 1) {
      await playCaughtChallenge(host, players, challenge);
      const primary = host.page.locator(".host-result-stage .btn-primary");
      if (challenge < 9) {
        await expect(primary).toHaveText("متخفي جديد");
        await primary.click();
      } else {
        await expect(primary).toHaveText("شوفوا الترتيب النهائي");
        await primary.click();
      }
    }

    await expect(host.page.getByRole("heading", { name: "خلصت اللعبة 🎉" })).toBeVisible({
      timeout: PHASE_TIMEOUT,
    });
    await expect(host.page.getByText(/لعبتوا 9 تحديات/)).toBeVisible();
    await expect(host.page.getByText(/مسكتوا المتخفي في 9 من 9 أدوار/)).toBeVisible();
    await expect(host.page.getByText("الترتيب النهائي")).toBeVisible();

    for (const client of [host, ...players]) {
      const frames = await client.page.evaluate(() => window.__frames ?? []);
      expect(frames.length, `${client.name} received real server frames`).toBeGreaterThan(0);
      assertNoVoterMapping(frames, client.name);

      const rendered = await client.page.locator("body").innerText();
      expect(rendered).not.toMatch(/صوّت\s+(على|لـ)\s*\S+\s*→/);
    }

    test.info().annotations.push({
      type: "journey-duration-ms",
      description: String(Date.now() - startedAt),
    });
  } finally {
    await Promise.allSettled(joined.map((player) => player.context.close()));
    await host.context.close();
  }
});