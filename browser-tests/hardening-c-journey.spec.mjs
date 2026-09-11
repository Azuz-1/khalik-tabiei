import { test, expect } from "@playwright/test";

/**
 * A real Chromium journey through an actual competitive game. The room owner
 * occupies a real player seat, receives a private role, votes on the same
 * device, and retains management controls at safe control surfaces. Three
 * physical people (owner + two players after a kick) complete the match.
 */

const PHASE_TIMEOUT = 65_000;

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

async function createOwner(browser) {
  const context = await newRecordedContext(browser, {
    viewport: { width: 430, height: 932 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "سوّ غرفة والعب معنا", exact: true }).click();
  await page.getByLabel("اسمك").fill("المالك");
  await page.getByRole("button", { name: "إنشاء الغرفة", exact: true }).click();
  const code = (await page.locator(".code-value").textContent())?.trim();
  expect(code).toMatch(/^[A-Z2-9]{5}$/);
  await expect(page.locator(".chip", { hasText: "المالك" })).toContainText("مالك الغرفة");
  return { context, page, code, name: "المالك" };
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

async function ownerSeatFor(ownerPage, name) {
  const chip = ownerPage.locator(".chip", { hasText: name });
  await expect(chip).toHaveCount(1);
  return (await chip.locator(".seat-badge").textContent())?.trim();
}

async function identifyRoles(players) {
  const seen = [];
  for (const player of players) {
    await expect(player.page.locator(".player-stage-main")).toBeVisible({ timeout: PHASE_TIMEOUT });
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
  const confirm = voter.page.getByRole("button", { name: `أكّد التصويت على ${targetName}`, exact: true });
  await expect(confirm).toBeVisible();
  await expect(voter.page.locator(".vote-confirm-bar")).toBeVisible();
  await confirm.click();
  await expect
    .poll(
      async () => {
        const rendered = await voter.page.locator("body").innerText();
        return /تم تسجيل صوتك|مسكتوا المتخفي|المتخفي نجا|خلصت المباراة/.test(rendered);
      },
      { timeout: PHASE_TIMEOUT, message: `${voter.name}'s vote was never registered` },
    )
    .toBe(true);
}

function assertNoVoterMapping(frames, label) {
  const violations = [];
  const forbiddenKey = /voter|ballot|votedFor|votesByUid|correctVoteStreakStart|pendingRoundScores|abstainedUids|sealedVotes/i;
  const expectedTallyKeys = ["name", "uid", "votes"];

  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      if (forbiddenKey.test(key)) violations.push(`${path}: exposed private key "${key}"`);
      if (key === "liveVoteTally") violations.push(`${path}: exposed live target totals`);
      if (key === "voteTally" && Array.isArray(value)) {
        value.forEach((entry, index) => {
          const actual = entry && typeof entry === "object" ? Object.keys(entry).sort() : [];
          if (JSON.stringify(actual) !== JSON.stringify(expectedTallyKeys)) {
            violations.push(`${path}.voteTally[${index}]: expected aggregate-only keys, got ${actual.join(",")}`);
          }
        });
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

async function playCaughtChallenge(owner, players, globalChallenge) {
  const { impostor, normals } = await identifyRoles(players);
  expect(normals).toHaveLength(2);

  for (const player of [impostor, ...normals]) {
    await expect(player.page.getByText(new RegExp(`التحدّي ${globalChallenge} من 9`))).toBeVisible();
    await player.page.getByRole("button", { name: "جاهز" }).click();
  }

  await Promise.all(players.map((player) =>
    expect(player.page.locator(".player-countdown-number")).toBeVisible({ timeout: PHASE_TIMEOUT }),
  ));
  if (globalChallenge === 1) {
    await Promise.all(players.map((player) =>
      expect(player.page.locator(".player-action-title")).toBeVisible({ timeout: PHASE_TIMEOUT }),
    ));
  }

  await Promise.all(players.map((player) =>
    expect(player.page.getByText("طالعوا بعض")).toBeVisible({ timeout: PHASE_TIMEOUT }),
  ));
  await Promise.all(players.map((player) =>
    expect(player.page.getByText("المطلوب كان…")).toBeVisible({ timeout: PHASE_TIMEOUT }),
  ));
  await Promise.all(players.map(async (player) => {
    await expect(player.page.getByRole("heading", { name: "مين تصرفه مو طبيعي؟" })).toBeVisible({
      timeout: PHASE_TIMEOUT,
    });
    await expect(player.page.getByTestId("phase-countdown")).toBeVisible();
  }));

  if (globalChallenge === 1) {
    const peer = players.find((player) => player !== owner);
    expect(peer, "owner journey needs another connected player").toBeTruthy();
    const peerCountdown = peer.page.getByTestId("phase-countdown");
    const before = await peerCountdown.textContent();

    await owner.context.setOffline(true);
    await expect(owner.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeVisible({
      timeout: PHASE_TIMEOUT,
    });
    await expect.poll(
      () => peerCountdown.textContent(),
      { timeout: 5_000, message: "discussion countdown paused when the owner disconnected" },
    ).not.toBe(before);

    await owner.context.setOffline(false);
    await expect(owner.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeHidden({
      timeout: PHASE_TIMEOUT,
    });
    await expect(owner.page.getByRole("heading", { name: "مين تصرفه مو طبيعي؟" })).toBeVisible({
      timeout: PHASE_TIMEOUT,
    });
    await expect(owner.page.getByText("استعدوا للتصويت")).toBeVisible({ timeout: PHASE_TIMEOUT });
  }

  await Promise.all(players.map(async (player) => {
    await expect(player.page.getByRole("heading", { name: "مين تحس إنه المتخفي؟" })).toBeVisible({ timeout: PHASE_TIMEOUT });
    await expect(player.page.locator(".vote-board")).toHaveCount(0);
  }));

  await castVote(impostor, normals[0].name);
  await castVote(normals[0], impostor.name);
  await castVote(normals[1], impostor.name);

  await expect(owner.page.locator(".host-result-stage")).toBeVisible({ timeout: PHASE_TIMEOUT });
  await expect(owner.page.getByText("مسكتوا المتخفي!")).toBeVisible();
  await expect(owner.page.locator(".result-impostor-name")).toHaveText(impostor.name);
  await expect(owner.page.getByText("النقاط بعد دور المتخفي")).toBeVisible();
  await expect(owner.page.locator(".score-reason")).toHaveCount(3);
  await expect(owner.page.getByText("انمسك قبل ما ينجو من أي تحدّي · 0")).toBeVisible();
  await expect(owner.page.getByText("صح في آخر تصويت · +1")).toHaveCount(2);
  await expect(owner.page.getByRole("button", { name: "التالي", exact: true })).toBeVisible();

  return { impostor, normals };
}

test("three-person full game: owner plays, reconnect survives, kick preserves minimum roster, and match completes", async ({
  browser,
}) => {
  test.setTimeout(720_000);
  const startedAt = Date.now();

  const owner = await createOwner(browser);
  const joined = [];
  try {
    for (let index = 1; index <= 3; index += 1) {
      joined.push(await joinPlayer(browser, owner.code, `لاعب${index}`));
    }
    await expect(owner.page.locator(".seat-badge")).toHaveCount(4);

    const flaky = joined[2];
    const seatBefore = await ownerSeatFor(owner.page, flaky.name);
    await flaky.context.setOffline(true);
    await expect(flaky.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeVisible({ timeout: PHASE_TIMEOUT });
    await expect(flaky.page.locator("[data-game-surface]")).toHaveAttribute("disabled", "");
    await expect(flaky.page.getByRole("button", { name: "الخروج من الغرفة" })).toBeEnabled();

    await flaky.context.setOffline(false);
    await expect(flaky.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeHidden({ timeout: PHASE_TIMEOUT });
    await expect(flaky.page.locator("[data-game-surface]")).not.toHaveAttribute("disabled", "");
    await expect(flaky.page.locator(".chip", { hasText: `${flaky.name} (أنت)` })).toBeVisible();
    expect(await ownerSeatFor(owner.page, flaky.name)).toBe(seatBefore);

    const kicked = joined[1];
    await owner.page
      .locator(".chip", { hasText: kicked.name })
      .getByRole("button", { name: new RegExp(`^إخراج ${kicked.name}`) })
      .click();
    const kickDialog = owner.page.getByRole("dialog", { name: `إخراج ${kicked.name}؟` });
    await expect(kickDialog).toBeVisible();
    await kickDialog.getByRole("button", { name: "إخراج", exact: true }).click();
    await expect(kickDialog).toBeHidden();
    await expect(owner.page.locator(".seat-badge")).toHaveCount(3);

    const players = [owner, joined[0], joined[2]];
    await expect(owner.page.getByText("🏅 9 تحدّيات")).toBeVisible();
    await owner.page.getByRole("button", { name: "ابدأ اللعبة" }).click();

    for (let challenge = 1; challenge <= 9; challenge += 1) {
      await playCaughtChallenge(owner, players, challenge);
      const primary = owner.page.locator(".host-result-stage .btn-primary");
      await expect(primary).toHaveText("التالي");
      await primary.click();
    }

    await expect(owner.page.getByRole("heading", { name: "خلصت اللعبة 🎉" })).toBeVisible({
      timeout: PHASE_TIMEOUT,
    });
    await expect(owner.page.getByText(/لعبتوا 9 تحدّيات/)).toBeVisible();
    await expect(owner.page.getByText(/مسكتوا المتخفي في 9 من 9 أدوار متخفي/)).toBeVisible();
    await expect(owner.page.getByText("الترتيب النهائي")).toBeVisible();

    for (const client of players) {
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
    await owner.context.close();
  }
});
