import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameMode } from "../../shared/types.js";
import { PROMPT_NOVELTY_FILTER_BYTES } from "../../shared/promptNovelty.js";
import * as engine from "../src/game/engine.js";
import { IMITATION_PROMPTS } from "../src/game/imitationPrompts.data.js";
import { sessionPromptIdsForTests } from "../src/game/sessionPromptHistory.js";
import {
  createRoomState,
  type InternalPlayer,
  type RoomState,
} from "../src/game/state.js";

const NOW = () => 1_000;
const deps = { rng: () => 0, now: NOW };
const MODES: GameMode[] = ["HANDS", "POINT", "NUMBER"];

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

function roomWithFourPlayers(mode: GameMode): RoomState {
  const room = createRoomState("ABCDE", "host", NOW());
  addPlayer(room, "p1", "لاعب1");
  addPlayer(room, "p2", "لاعب2");
  addPlayer(room, "p3", "لاعب3");
  addPlayer(room, "p4", "لاعب4");
  engine.setSettings(room, "host", { selectedModes: [mode] }, deps);
  return room;
}

function modeIds(mode: GameMode): Set<string> {
  return new Set(
    IMITATION_PROMPTS.filter((prompt) => prompt.mode === mode).map((prompt) => prompt.id),
  );
}

function collectPromptIds(room: RoomState, count: number): string[] {
  assert.ok(count >= 1);
  engine.startGame(room, "host", deps);
  const ids = [room.round!.promptId];

  for (let index = 1; index < count; index += 1) {
    engine.redealCurrentRound(room, deps);
    ids.push(room.round!.promptId);
  }

  return ids;
}

for (const mode of MODES) {
  test(`${mode}: 300 production selections are unique and selection 301 falls back safely`, () => {
    const room = roomWithFourPlayers(mode);
    const allowedIds = modeIds(mode);
    assert.equal(allowedIds.size, 300);

    const first300 = collectPromptIds(room, 300);
    assert.equal(first300.length, 300);
    assert.equal(new Set(first300).size, 300, `${mode} repeated before exhausting its 300 prompts`);
    assert.ok(first300.every((id) => allowedIds.has(id)), `${mode} selected a prompt from another mode`);
    assert.equal(room.usedPromptIds.size, 300);

    const sessionBeforeFallback = sessionPromptIdsForTests(room);
    assert.equal(
      [...sessionBeforeFallback].filter((id) => allowedIds.has(id)).length,
      300,
      `${mode} room-session history did not record all 300 prompts`,
    );

    engine.redealCurrentRound(room, deps);
    const fallbackId = room.round!.promptId;

    assert.ok(allowedIds.has(fallbackId), `${mode} fallback selected an invalid prompt`);
    assert.ok(new Set(first300).has(fallbackId), `${mode} fallback should only repeat after full exhaustion`);
    assert.deepEqual(
      [...room.usedPromptIds].filter((id) => allowedIds.has(id)),
      [fallbackId],
      `${mode} current-match usage should refill cleanly after exhaustion`,
    );
    assert.deepEqual(
      [...sessionPromptIdsForTests(room)].filter((id) => allowedIds.has(id)),
      [fallbackId],
      `${mode} room-session history should reset only after full mode exhaustion`,
    );
  });
}

test("all-ones participant novelty history cannot stall prompt selection", () => {
  const room = roomWithFourPlayers("HANDS");
  const allSeen = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES).fill(0xff);
  for (const uid of room.players.keys()) room.promptNoveltyByUid.set(uid, allSeen.slice());

  const ids = collectPromptIds(room, 25);
  assert.equal(ids.length, 25);
  assert.equal(new Set(ids).size, 25, "all-ones history caused an early room-session repeat");

  const handsIds = modeIds("HANDS");
  assert.ok(ids.every((id) => handsIds.has(id)), "all-ones fallback escaped the selected mode");
});
