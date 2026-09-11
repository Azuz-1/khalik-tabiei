import { test, expect } from "@playwright/test";

const PHASE_TIMEOUT = 75_000;
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

async function newPhone(browser, width = 390, height = 844) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  await quietExternalFonts(context);
  await context.addInitScript(RECORD_FRAMES);
  const page = await context.newPage();
  return { context, page };
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

async function identifyRoles(players) {
  const rows = [];
  for (const player of players) {
    await expect(player.page.locator(".q-card")).toBeVisible({ timeout: PHASE_TIMEOUT });
    rows.push({ player, isImpostor: await player.page.getByText("أنت المتخفي").isVisible() });
  }
  const impostors = rows.filter((row) => row.isImpostor);
  expect(impostors).toHaveLength(1);
  return {
    impostor: impostors[0].player,
    normals: rows.filter((row) => !row.isImpostor).map((row) => row.player),
  };
}

async function readyToDiscussion(players) {
  const roles = await identifyRoles(players);
  for (const player of players) await player.page.getByRole("button", { name: "جاهز", exact: true }).click();
  await Promise.all(players.map((player) =>
    expect(player.page.getByRole("heading", { name: "مين تصرفه مو طبيعي؟" })).toBeVisible({ timeout: PHASE_TIMEOUT }),
  ));
  return roles;
}

async function castVote(voter, targetName) {
  const option = voter.page.locator(".vote-opt", { hasText: targetName });
  await expect(option).toHaveCount(1);
  await option.click();
  const confirm = voter.page.getByRole("button", { name: `أكّد التصويت على ${targetName}`, exact: true });
  await expect(confirm).toBeVisible();
  await confirm.click();
}

async function latestView(page) {
  return page.evaluate(() => {
    const frames = window.__frames ?? [];
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      try {
        const message = JSON.parse(frames[index]);
        if (message?.t === "STATE") return message.view;
      } catch {
        // Ignore any future non-JSON transport frame.
      }
    }
    return null;
  });
}

test("real phones: 30s offline rejoins before voting; 60s owner offline transfers authority without kicking the player", async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await createOwner(browser);
  const first = await joinPlayer(browser, owner.code, "لاعب 2");
  const sleeper = await joinPlayer(browser, owner.code, "لاعب 3");
  const players = [owner, first, sleeper];

  try {
    await owner.page.getByRole("button", { name: "ابدأ اللعبة", exact: true }).click();

    // Challenge 1: a normal transport outage for a full 30 real seconds during
    // the 45-second discussion must not remove the player's seat or pause time.
    const firstRoles = await readyToDiscussion(players);
    await sleeper.context.setOffline(true);
    await expect(sleeper.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeVisible({ timeout: PHASE_TIMEOUT });
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await expect(owner.page.getByRole("heading", { name: "مين تصرفه مو طبيعي؟" })).toBeVisible();

    await sleeper.context.setOffline(false);
    await expect(sleeper.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeHidden({ timeout: PHASE_TIMEOUT });
    await expect(sleeper.page.getByRole("heading", { name: "مين تصرفه مو طبيعي؟" })).toBeVisible({ timeout: PHASE_TIMEOUT });

    await Promise.all(players.map((player) =>
      expect(player.page.getByRole("heading", { name: "مين تحس إنه المتخفي؟" })).toBeVisible({ timeout: PHASE_TIMEOUT }),
    ));
    await castVote(firstRoles.impostor, firstRoles.normals[0].name);
    for (const normal of firstRoles.normals) await castVote(normal, firstRoles.impostor.name);
    await expect(owner.page.locator(".host-result-stage")).toBeVisible({ timeout: PHASE_TIMEOUT });
    await owner.page.locator(".host-result-stage .btn-primary").click();

    // Challenge 2: the named owner goes offline at discussion start and stays
    // away through 45s discussion + 15s voting. Gameplay must continue. Around
    // the 60s authority deadline management transfers, but the old owner stays
    // a player and reconnects without reclaiming ownership.
    const secondRoles = await readyToDiscussion(players);
    await owner.context.setOffline(true);
    await expect(owner.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeVisible({ timeout: PHASE_TIMEOUT });

    for (const peer of [first, sleeper]) {
      await expect(peer.page.getByRole("heading", { name: "مين تحس إنه المتخفي؟" })).toBeVisible({ timeout: PHASE_TIMEOUT });
    }

    if (secondRoles.impostor.name === owner.name) {
      await castVote(first, owner.name);
      await castVote(sleeper, owner.name);
    } else {
      const connectedImpostor = [first, sleeper].find((player) => player.name === secondRoles.impostor.name);
      const connectedNormal = [first, sleeper].find((player) => player.name !== secondRoles.impostor.name);
      expect(connectedImpostor).toBeTruthy();
      expect(connectedNormal).toBeTruthy();
      await castVote(connectedNormal, connectedImpostor.name);
      await castVote(connectedImpostor, connectedNormal.name);
    }

    await expect.poll(
      async () => (await latestView(first.page))?.room?.phase,
      { timeout: PHASE_TIMEOUT, message: "game never reached RESULT while owner phone was offline" },
    ).toBe("RESULT");
    await expect.poll(
      async () => Boolean((await latestView(first.page))?.self?.isOwner),
      { timeout: PHASE_TIMEOUT, message: "authority did not transfer after owner stayed offline for 60 seconds" },
    ).toBe(true);

    const successorView = await latestView(first.page);
    expect(successorView.players.find((player) => player.name === owner.name)).toMatchObject({ connected: false });

    await owner.context.setOffline(false);
    await expect(owner.page.getByText("الاتصال انقطع، قاعدين نحاول نرجعك…")).toBeHidden({ timeout: PHASE_TIMEOUT });
    await expect.poll(
      async () => Boolean((await latestView(owner.page))?.self?.isOwner),
      { timeout: PHASE_TIMEOUT },
    ).toBe(false);
    const oldOwnerView = await latestView(owner.page);
    expect(oldOwnerView.self.role).toBe("player");
    expect(oldOwnerView.players.find((player) => player.name === owner.name)).toMatchObject({ connected: true });
    expect(oldOwnerView.players.find((player) => player.name === first.name)).toMatchObject({ isHost: true });
  } finally {
    await Promise.allSettled(players.map((player) => player.context.close()));
  }
});
