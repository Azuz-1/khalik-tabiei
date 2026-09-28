/**
 * Genuine-gameplay capture for the promo.
 *
 * Boots the real, unmodified خلك طبيعي server, then plays a full 5-player
 * match with Playwright: one owner phone, four player phones and a paired TV.
 * Every phase is screenshotted from the real UI into promo/assets/capture.
 *
 * The only nudge is the client's own advisory prompt history
 * (localStorage "kt_prompt_novelty"): every prompt is marked as already seen
 * except the three we want to feature, so the server's normal freshness rules
 * deal exactly those. Impostor choice and mode order stay random; we simply
 * retry fresh rooms until the dealt story matches the storyboard.
 *
 * Usage (from repo root, after `npm run build`):
 *   node promo/capture/capture.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const out = resolve(here, "../assets/capture");
mkdirSync(out, { recursive: true });

const PORT = 8090;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** Featured prompts: the only ones left "unseen" in each browser's history. */
const FEATURED = ["H02", "P01", "N01"];
const OWNER = "فهد";
const PLAYERS = ["نورة", "سعود", "ريم", "خالد"];
const WANT_IMPOSTOR = "سعود";
const WANT_FIRST_MODE = "HANDS";

// ---- prompt-history seed (mirrors shared/promptNovelty.ts slot scheme) -------
function slotOf(id) {
  const m = /^([HPN])(\d{2,3})$/.exec(id);
  const base = { H: 0, P: 512, N: 1024 }[m[1]];
  const n = Number.parseInt(m[2], 10);
  return base + (m[2].length === 2 ? n - 1 : 10 + n - 1);
}
function seedBits() {
  const bytes = new Uint8Array(192).fill(0xff);
  for (const id of FEATURED) {
    const s = slotOf(id);
    bytes[s >>> 3] &= ~(1 << (s & 7));
  }
  return Buffer.from(bytes).toString("base64url");
}
const SEED = JSON.stringify({ version: 2, bits: seedBits() });

// ---- server -------------------------------------------------------------------
function startServer() {
  const proc = spawn(process.execPath, ["server/dist/server/src/index.js"], {
    cwd: repo,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      PUBLIC_ORIGIN: ORIGIN,
      SESSION_SECRET: "promo-capture-secret-0123456789-abcdefgh",
      NODE_ENV: "development",
      // Capture retries create many rooms/pairings from one IP; lift the
      // operational abuse shields for this local run only.
      ...Object.fromEntries([
        "CONNECTION_IP", "CONNECTION_IDENTITY", "SESSION_IP", "SESSION_IDENTITY",
        "ROOM_CREATION_IP", "ROOM_CREATION_IDENTITY", "DISPLAY_PAIRING_CREATE_IP",
        "DISPLAY_PAIRING_CLAIM_IP", "DISPLAY_PAIRING_CLAIM_IDENTITY",
        "DISPLAY_PAIRING_STATUS_IP", "DISPLAY_PAIRING_STATUS_PAIRING",
      ].map((key) => [`RATE_LIMIT_${key}_LIMIT`, "100000"])),
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return proc;
}
async function waitHealthy() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${ORIGIN}/healthz`);
      if (res.ok) return;
    } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not become healthy");
}

// ---- helpers ------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = [];
async function shot(page, name) {
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file, animations: "allow" });
  shots.push(name);
  console.log("  shot", name);
}
async function phoneContext(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: "ar-SA",
  });
  await context.addInitScript((seed) => {
    try {
      if (!localStorage.getItem("kt_prompt_novelty")) localStorage.setItem("kt_prompt_novelty", seed);
    } catch { /* ignore */ }
  }, SEED);
  return context;
}
async function phase(page) {
  return page.evaluate(() => document.querySelector(".tv")?.getAttribute("data-phase") ?? null);
}
async function waitPhase(tv, target, timeout = 90_000) {
  await tv.waitForFunction((p) => document.querySelector(".tv")?.getAttribute("data-phase") === p, target, { timeout, polling: 50 });
}
async function tvMode(tv) {
  return tv.evaluate(() => document.querySelector(".tv")?.getAttribute("data-mode") ?? null);
}

// ---- one attempt ----------------------------------------------------------------
async function setupRoom(browser, final) {
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: "ar-SA" });
  const tv = await tvContext.newPage();
  const ownerCtx = await phoneContext(browser);
  const owner = await ownerCtx.newPage();

  await owner.goto(ORIGIN + "/");
  await owner.getByRole("button", { name: "سوّ غرفة والعب معنا", exact: true }).waitFor();
  await sleep(600);
  if (final) await shot(owner, "01_home");
  if (final) {
    await owner.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(400);
    await shot(owner, "01b_home_rules");
    await owner.getByRole("tab", { name: "النقاط" }).click();
    await owner.getByRole("tab", { name: "النقاط" }).scrollIntoViewIfNeeded();
    await sleep(400);
    await shot(owner, "01c_home_points");
    await owner.getByRole("tab", { name: "طرق اللعب" }).click();
    await sleep(400);
    await shot(owner, "01d_home_modes");
    await owner.evaluate(() => window.scrollTo(0, 0));
  }
  await owner.getByRole("button", { name: "سوّ غرفة والعب معنا", exact: true }).click();
  await owner.getByLabel("اسمك").fill(OWNER);
  if (final) { await sleep(300); await shot(owner, "02_create_name"); }
  await owner.getByRole("button", { name: "إنشاء الغرفة", exact: true }).click();
  await owner.locator(".code-value").waitFor();
  const code = (await owner.locator(".code-value").textContent()).trim();
  // Shortest real match: 3 challenges.
  await owner.getByRole("radio", { name: "3", exact: true }).click();
  await sleep(300);
  if (final) await shot(owner, "03_owner_lobby_empty");

  // Pair the TV exactly like a real host would.
  await tv.goto(ORIGIN + "/tv");
  await tv.locator(".tv-pairing-code").waitFor();
  await sleep(500);
  if (final) await shot(tv, "tv_00_pairing");
  const pairing = (await tv.locator(".tv-pairing-code").textContent()).replace(/\D/g, "");
  await owner.getByRole("button", { name: "📺 العب على التلفزيون", exact: true }).click();
  const panel = owner.getByRole("dialog", { name: "إدارة شاشة العرض" });
  await panel.getByLabel("رمز التلفزيون").fill(pairing);
  if (final) { await sleep(300); await shot(owner, "03b_owner_pair_tv"); }
  await panel.getByRole("button", { name: "ربط التلفزيون", exact: true }).click();
  await tv.waitForURL(new RegExp(`/display/${code}`), { timeout: 20_000 });
  await panel.getByRole("button", { name: "إغلاق", exact: true }).click();

  const players = [{ name: OWNER, page: owner, ctx: ownerCtx }];
  for (const [index, name] of PLAYERS.entries()) {
    const ctx = await phoneContext(browser);
    const page = await ctx.newPage();
    if (final && index === 0) {
      await page.goto(ORIGIN + "/");
      await page.getByRole("button", { name: "ادخل غرفة" }).click();
      await page.getByLabel("كود الغرفة").fill(code);
      await sleep(300);
      await shot(page, "04_join_code");
      await page.getByRole("button", { name: "التالي" }).click();
    } else {
      await page.goto(`${ORIGIN}/join/${code}`);
    }
    await page.getByLabel("اسمك").fill(name);
    if (final && index === 0) { await sleep(200); await shot(page, "04b_join_name"); }
    await page.getByRole("button", { name: "دخول الغرفة" }).click();
    await page.getByRole("heading", { name: "أنت داخل 🎉" }).waitFor();
    players.push({ name, page, ctx });
    if (final && index === 1) { await sleep(700); await shot(tv, "tv_01_lobby_filling"); }
  }
  await sleep(900);
  if (final) {
    await shot(players[1].page, "05_player_lobby");
    await shot(owner, "05_owner_lobby_full");
    await owner.evaluate(() => document.querySelector(".settings-panel")?.scrollIntoView());
    await sleep(300);
    await shot(owner, "05b_owner_settings");
    await owner.evaluate(() => window.scrollTo(0, 0));
    await shot(tv, "tv_02_lobby_full");
  }
  return { tv, tvContext, owner, players, code };
}

async function teardown(room) {
  for (const p of room.players) await p.ctx.close().catch(() => {});
  await room.tvContext.close().catch(() => {});
}

async function whoIsImpostor(room) {
  // Reveal every private screen, then read which phone says "أنت المتخفي".
  let impostor = null;
  for (const p of room.players) {
    const reveal = p.page.getByRole("button", { name: "اعرض دوري" });
    await reveal.waitFor({ timeout: 15_000 });
  }
  for (const p of room.players) {
    await p.page.getByRole("button", { name: "اعرض دوري" }).click();
    await p.page.getByRole("button", { name: "جاهز" }).waitFor();
    if (await p.page.locator(".impostor-word").count()) impostor = p.name;
  }
  return impostor;
}

// ---- a full challenge -------------------------------------------------------------
async function playChallenge(room, n, votes, { firstAlreadyRevealed = false } = {}) {
  const { tv, players } = room;
  const tag = `c${n}`;
  const byName = Object.fromEntries(players.map((p) => [p.name, p]));
  await waitPhase(tv, "QUESTION");
  await sleep(600);
  await shot(tv, `tv_${tag}_1_question`);

  if (!firstAlreadyRevealed) {
    for (const p of players) await p.page.getByRole("button", { name: "اعرض دوري" }).waitFor({ timeout: 15_000 });
    await shot(byName["نورة"].page, `${tag}_1_curtain`);
    for (const p of players) {
      await p.page.getByRole("button", { name: "اعرض دوري" }).click();
      await p.page.getByRole("button", { name: "جاهز" }).waitFor();
    }
  }
  await sleep(500);
  let impostor = null;
  for (const p of players) {
    if (await p.page.locator(".impostor-word").count()) impostor = p.name;
    await shot(p.page, `${tag}_2_prompt_${p.name === impostor ? "IMPOSTOR" : "normal"}_${p.name}`);
  }
  // Ready one at a time so the TV ready meter fills.
  for (const [i, p] of players.entries()) {
    await p.page.getByRole("button", { name: "جاهز" }).click();
    await sleep(350);
    if (i === 0) await shot(p.page, `${tag}_3_ready_waiting`);
    if (i === 2) await shot(tv, `tv_${tag}_2_ready_progress`);
    if (i === players.length - 1) break;
  }

  // Countdown 5..1: grab each visible second on TV + one phone.
  await waitPhase(tv, "COUNTDOWN", 10_000);
  const seen = new Set();
  const phone = byName["نورة"].page;
  while ((await phase(tv)) === "COUNTDOWN") {
    const num = await tv.evaluate(() => document.querySelector(".host-countdown-number")?.textContent?.trim() ?? "");
    if (num && !seen.has(num)) {
      seen.add(num);
      await Promise.all([shot(tv, `tv_${tag}_3_count_${num}`), shot(phone, `${tag}_4_count_${num}`)]);
    }
    await sleep(60);
  }
  await waitPhase(tv, "ACTION", 5_000);
  await Promise.all([shot(tv, `tv_${tag}_4_action`), shot(phone, `${tag}_5_action`)]);
  await waitPhase(tv, "HOLD", 5_000);
  await sleep(400);
  await Promise.all([shot(tv, `tv_${tag}_5_hold`), shot(phone, `${tag}_6_hold`)]);
  await waitPhase(tv, "PROMPT_REVEAL", 10_000);
  await sleep(700);
  await Promise.all([shot(tv, `tv_${tag}_6_reveal`), shot(phone, `${tag}_7_reveal`)]);
  await waitPhase(tv, "DISCUSSION", 10_000);
  await sleep(1200);
  await Promise.all([shot(tv, `tv_${tag}_7_discussion`), shot(phone, `${tag}_8_discussion`)]);

  // Voting opens automatically after the real 45 s discussion window.
  await waitPhase(tv, "VOTING", 70_000);
  await sleep(700);
  await shot(tv, `tv_${tag}_8_voting_0`);
  let cast = 0;
  for (const [voter, target] of votes) {
    const page = byName[voter].page;
    await page.getByRole("radio", { name: target }).click();
    await sleep(200);
    if (cast === 0) await shot(page, `${tag}_9_vote_picked`);
    await page.getByRole("button", { name: `أكّد التصويت على ${target}` }).click();
    cast += 1;
    await sleep(450);
    if (cast === 1) await shot(page, `${tag}_9b_voted_waiting`);
    if (cast < votes.length) await shot(tv, `tv_${tag}_8_voting_${cast}`);
  }
  await waitPhase(tv, "RESULT", 20_000);
  await sleep(1200);
  await shot(tv, `tv_${tag}_9_result`);
  for (const p of players) {
    await shot(p.page, `${tag}_10_result_${p.name === impostor ? "IMPOSTOR" : "normal"}_${p.name}`);
  }
  return impostor;
}

async function advance(room) {
  const next = room.owner.getByRole("button", { name: /^(التالي|التحدّي التالي)$/ });
  await next.click();
}

// ---- main -------------------------------------------------------------------------
const server = startServer();
let browser;
try {
  await waitHealthy();
  browser = await chromium.launch({ executablePath: CHROME, args: ["--font-render-hinting=none"] });

  let room;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    // Shots are cheap; each attempt overwrites the lobby shots with its own.
    room = await setupRoom(browser, true);
    await room.owner.getByRole("button", { name: "ابدأ اللعبة", exact: true }).click();
    await waitPhase(room.tv, "QUESTION", 15_000);
    const mode = await tvMode(room.tv);
    // Curtain shot needs the covered state, so capture it before revealing.
    await room.players[1].page.getByRole("button", { name: "اعرض دوري" }).waitFor();
    await sleep(400);
    await shot(room.players[1].page, "c1_1_curtain");
    await shot(room.tv, "tv_c1_1_question");
    const impostor = await whoIsImpostor(room);
    console.log(`attempt ${attempt}: mode=${mode} impostor=${impostor}`);
    if (mode === WANT_FIRST_MODE && impostor === WANT_IMPOSTOR) break;
    await teardown(room);
    room = null;
  }
  if (!room) throw new Error("could not deal the storyboard");

  // Challenge 1 — HANDS. The group splits; سعود survives with 2 of 5.
  await playChallenge(room, 1, [
    ["نورة", "سعود"], ["فهد", "ريم"], ["سعود", "خالد"], ["ريم", "سعود"], ["خالد", "ريم"],
  ], { firstAlreadyRevealed: true });
  await advance(room);

  // Challenge 2 — same impostor, next mode. Now the majority lands on him.
  await playChallenge(room, 2, [
    ["نورة", "سعود"], ["فهد", "سعود"], ["ريم", "سعود"], ["سعود", "نورة"], ["خالد", "فهد"],
  ]);
  await advance(room);

  // Challenge 3 — a fresh impostor; the room is fooled and the match ends.
  await waitPhase(room.tv, "QUESTION");
  const names = room.players.map((p) => p.name);
  await sleep(300);
  // Votes are decided after we know who the new impostor is (read from their phone).
  const byName = Object.fromEntries(room.players.map((p) => [p.name, p]));
  for (const p of room.players) await p.page.getByRole("button", { name: "اعرض دوري" }).waitFor({ timeout: 15_000 });
  let impostor3 = null;
  await shot(byName["نورة"].page, "c3_1_curtain");
  for (const p of room.players) {
    await p.page.getByRole("button", { name: "اعرض دوري" }).click();
    await p.page.getByRole("button", { name: "جاهز" }).waitFor();
    if (await p.page.locator(".impostor-word").count()) impostor3 = p.name;
  }
  console.log("challenge 3 impostor:", impostor3);
  // Everyone piles onto an innocent scapegoat → the impostor slips away.
  const scapegoat = names.find((n) => n !== impostor3 && n !== "نورة");
  const fallback = names.find((n) => n !== impostor3 && n !== scapegoat);
  const votes3 = names.map((voter) => [voter, voter === scapegoat ? fallback : scapegoat]);
  await playChallenge(room, 3, votes3, { firstAlreadyRevealed: true });
  await advance(room);

  await room.tv.waitForFunction(() => document.querySelector(".tv")?.getAttribute("data-phase") === "GAME_OVER", null, { timeout: 20_000 });
  await sleep(1500);
  await shot(room.tv, "tv_99_gameover");
  for (const p of room.players) await shot(p.page, `99_gameover_${p.name}`);
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ shots, impostor3, scapegoat }, null, 2));
  await teardown(room);
  console.log("done:", shots.length, "shots");
} finally {
  await browser?.close().catch(() => {});
  server.kill("SIGTERM");
}
