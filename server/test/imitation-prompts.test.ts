import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameMode } from "../../shared/types.js";
import { GAME_MODE_IDS } from "../../shared/constants.js";
import * as engine from "../src/game/engine.js";
import {
  BASE_IMITATION_PROMPTS,
  IMITATION_PROMPTS,
  type ImitationPrompt,
} from "../src/game/imitationPrompts.data.js";
import { EXTRA_IMITATION_PROMPTS } from "../src/game/imitationPrompts.extra.js";
import {
  createRoomState,
  type InternalPlayer,
  type RoomState,
} from "../src/game/state.js";

const MODES: GameMode[] = ["HANDS", "POINT", "NUMBER"];
const NOW = () => 1_000;
const deps = { rng: () => 0, now: NOW };

function countMode(prompts: ImitationPrompt[], mode: GameMode): number {
  return prompts.filter((prompt) => prompt.mode === mode).length;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function addPlayer(room: RoomState, uid: string, name: string): void {
  const player: InternalPlayer = {
    uid,
    name,
    normalizedName: name,
    score: 0,
    connected: true,
    joinedAt: 1,
    lastSeen: 1,
    disconnectGeneration: 0,
    isHost: false,
  };
  room.players.set(uid, player);
}

function roomWithThreePlayers(): RoomState {
  const room = createRoomState("ABCDE", "host", NOW());
  addPlayer(room, "p1", "لاعب1");
  addPlayer(room, "p2", "لاعب2");
  addPlayer(room, "p3", "لاعب3");
  room.totalRounds = 3;
  return room;
}

function completeSurvivedChallenge(room: RoomState): void {
  const participants = room.round!.participantUids;
  for (const uid of participants) engine.markReady(room, uid, deps);
  engine.startCountdown(room, NOW() + 5_000, deps);
  engine.toAction(room, NOW() + 1_000, deps);
  engine.toHold(room, NOW() + 2_000, deps);
  engine.revealPrompt(room, NOW() + 2_500, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);

  for (let index = 0; index < participants.length; index += 1) {
    engine.submitVote(
      room,
      participants[index],
      participants[(index + 1) % participants.length],
      deps,
    );
  }
  engine.computeResult(room, deps);
  assert.equal(room.round!.groupFound, false);
}

test("curated extra pack loads all 300 prompts with +100 per mode", () => {
  assert.equal(BASE_IMITATION_PROMPTS.length, 30);
  assert.equal(EXTRA_IMITATION_PROMPTS.length, 300);
  assert.equal(IMITATION_PROMPTS.length, 330);

  for (const mode of MODES) {
    const baseCount = countMode(BASE_IMITATION_PROMPTS, mode);
    const extraCount = countMode(EXTRA_IMITATION_PROMPTS, mode);
    const combinedCount = countMode(IMITATION_PROMPTS, mode);

    assert.equal(extraCount, 100, `${mode} extra count`);
    assert.equal(combinedCount, baseCount + 100, `${mode} combined count`);
    assert.equal(baseCount, 10, `${mode} base prompts were retained`);
  }
});

test("combined prompt IDs are unique, texts are non-empty, and modes are valid", () => {
  const ids = IMITATION_PROMPTS.map((prompt) => prompt.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate prompt ID found");

  const validModes = new Set<GameMode>(GAME_MODE_IDS);
  for (const prompt of IMITATION_PROMPTS) {
    assert.ok(prompt.id.trim().length > 0, "empty prompt ID");
    assert.ok(prompt.text.trim().length > 0, `empty prompt text: ${prompt.id}`);
    assert.ok(validModes.has(prompt.mode), `invalid mode on ${prompt.id}: ${prompt.mode}`);
  }
});

test("combined bank has no duplicate text after trim/whitespace normalization", () => {
  const seen = new Map<string, string>();

  for (const prompt of IMITATION_PROMPTS) {
    const normalized = normalizeText(prompt.text);
    const existing = seen.get(normalized);
    assert.equal(existing, undefined, `duplicate prompt text: ${existing} / ${prompt.id}`);
    seen.set(normalized, prompt.id);
  }
});

test("H001-H100, P001-P100, and N001-N100 map to the required modes", () => {
  const byId = new Map(EXTRA_IMITATION_PROMPTS.map((prompt) => [prompt.id, prompt]));
  const groups: Array<[string, GameMode]> = [
    ["H", "HANDS"],
    ["P", "POINT"],
    ["N", "NUMBER"],
  ];

  for (const [prefix, mode] of groups) {
    for (let index = 1; index <= 100; index += 1) {
      const id = `${prefix}${String(index).padStart(3, "0")}`;
      const prompt = byId.get(id);
      assert.ok(prompt, `missing ${id}`);
      assert.equal(prompt.mode, mode, `${id} has wrong mode`);
    }
  }
});

test("new HANDS and POINT prompts preserve their physical response domains", () => {
  for (const prompt of EXTRA_IMITATION_PROMPTS) {
    if (prompt.mode === "HANDS") {
      assert.ok(prompt.text.startsWith("ارفع يدك إذا"), `${prompt.id} is not binary HANDS copy`);
    }
    if (prompt.mode === "POINT") {
      assert.ok(prompt.text.startsWith("أشر على "), `${prompt.id} is not POINT copy`);
    }
  }
});

test("all new NUMBER prompts have an explicit 0-5 response domain", () => {
  const numberPrompts = EXTRA_IMITATION_PROMPTS.filter((prompt) => prompt.mode === "NUMBER");
  assert.equal(numberPrompts.length, 100);

  for (const prompt of numberPrompts) {
    const isFiveItemCount = prompt.text.startsWith("من آخر 5 ");
    const isZeroToFiveScale = prompt.text.startsWith("من 0 إلى 5،");
    assert.ok(isFiveItemCount || isZeroToFiveScale, `${prompt.id} is not constrained to 0-5`);
  }
});

test("new prompt copy excludes retired Saudi wording", () => {
  for (const prompt of EXTRA_IMITATION_PROMPTS) {
    const words = prompt.text.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/);
    assert.equal(words.includes("مب"), false, `${prompt.id} contains retired word مب`);
    assert.equal(prompt.text.includes("ورّونا"), false, `${prompt.id} contains retired wording ورّونا`);
    assert.equal(prompt.text.includes("طلّع أصابعك"), false, `${prompt.id} contains retired NUMBER copy`);
    assert.equal(prompt.text.includes("طلّعوا أصابعكم"), false, `${prompt.id} contains retired NUMBER copy`);
  }
});

test("prompt picker uses the combined bank and resets only after full mode exhaustion", () => {
  const room = roomWithThreePlayers();
  engine.setSettings(room, "host", { selectedModes: ["HANDS"] }, deps);
  engine.startGame(room, "host", deps);

  const handsPool = IMITATION_PROMPTS.filter((prompt) => prompt.mode === "HANDS");
  assert.equal(handsPool.length, 110);
  const finalPrompt = handsPool[handsPool.length - 1];
  assert.match(finalPrompt.id, /^H\d{3}$/, "expected final HANDS prompt to come from extra pack");

  room.usedPromptIds = new Set(handsPool.slice(0, -1).map((prompt) => prompt.id));
  completeSurvivedChallenge(room);
  engine.nextRound(room, "host", deps);

  assert.equal(room.round!.challengeIndex, 2);
  assert.equal(room.round!.promptId, finalPrompt.id);
  assert.equal(room.round!.prompt, finalPrompt.text);
  assert.ok(
    EXTRA_IMITATION_PROMPTS.some((prompt) => prompt.id === room.round!.promptId),
    "picker did not reach the extra prompt pack",
  );

  room.usedPromptIds = new Set(handsPool.map((prompt) => prompt.id));
  completeSurvivedChallenge(room);
  engine.nextRound(room, "host", deps);

  assert.equal(room.round!.challengeIndex, 3);
  assert.equal(room.round!.promptId, handsPool[0].id);
  assert.equal(room.round!.prompt, handsPool[0].text);

  const handsIds = new Set(handsPool.map((prompt) => prompt.id));
  const usedHandsAfterRefill = [...room.usedPromptIds].filter((id) => handsIds.has(id));
  assert.deepEqual(usedHandsAfterRefill, [handsPool[0].id]);
});
