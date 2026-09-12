import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameMode } from "../../shared/types.js";
import {
  createRoomState,
  type InternalPlayer,
  type RoomState,
} from "../src/game/state.js";
import * as engine from "../src/game/engine.js";
import { buildView } from "../src/game/view.js";
import { IMITATION_PROMPTS } from "../src/game/imitationPrompts.data.js";

const NOW = () => 1_000;
const deps = { rng: () => 0, now: NOW };

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

function roomWith(count = 3): RoomState {
  const room = createRoomState("ABCDE", "host", NOW());
  for (let index = 1; index <= count; index += 1) {
    addPlayer(room, `p${index}`, `لاعب${index}`);
  }
  return room;
}

function forceRematchToLobby(room: RoomState): void {
  // Match completion itself is already covered by the engine/integration suites.
  // These regressions isolate the lifetime of prompt history across REMATCH.
  room.phase = "GAME_OVER";
  engine.rematch(room, "host", deps);
  assert.equal(room.phase, "LOBBY");
}

test("REMATCH preserves exact room-session prompt history", () => {
  const room = roomWith();
  engine.setSettings(room, "host", { selectedModes: ["HANDS"] }, deps);

  engine.startGame(room, "host", deps);
  const firstPromptId = room.round!.promptId;
  assert.ok(room.usedPromptIds.has(firstPromptId));

  forceRematchToLobby(room);
  assert.ok(room.usedPromptIds.has(firstPromptId));

  engine.startGame(room, "host", deps);
  const secondPromptId = room.round!.promptId;

  assert.notEqual(secondPromptId, firstPromptId);
  assert.ok(room.usedPromptIds.has(firstPromptId));
  assert.ok(room.usedPromptIds.has(secondPromptId));
});

test("switching modes between rematches preserves old-mode history", () => {
  const room = roomWith();

  engine.setSettings(room, "host", { selectedModes: ["HANDS"] }, deps);
  engine.startGame(room, "host", deps);
  const firstHandsId = room.round!.promptId;

  forceRematchToLobby(room);
  engine.setSettings(room, "host", { selectedModes: ["POINT"] }, deps);
  engine.startGame(room, "host", deps);
  const firstPointId = room.round!.promptId;
  assert.equal(room.round!.mode, "POINT");

  forceRematchToLobby(room);
  engine.setSettings(room, "host", { selectedModes: ["HANDS"] }, deps);
  engine.startGame(room, "host", deps);
  const secondHandsId = room.round!.promptId;

  assert.notEqual(secondHandsId, firstHandsId);
  assert.ok(room.usedPromptIds.has(firstHandsId));
  assert.ok(room.usedPromptIds.has(firstPointId));
});

test("roster changes do not reset room-session prompt history", () => {
  const room = roomWith();
  engine.setSettings(room, "host", { selectedModes: ["NUMBER"] }, deps);

  engine.startGame(room, "host", deps);
  const firstId = room.round!.promptId;

  forceRematchToLobby(room);
  addPlayer(room, "p4", "لاعب4");

  engine.startGame(room, "host", deps);
  assert.notEqual(room.round!.promptId, firstId);
  assert.ok(room.usedPromptIds.has(firstId));
});

test("exhausting one mode resets only that mode prompt cycle", () => {
  const room = roomWith();
  engine.setSettings(room, "host", { selectedModes: ["HANDS"] }, deps);

  const handsIds = IMITATION_PROMPTS
    .filter((prompt) => prompt.mode === "HANDS")
    .map((prompt) => prompt.id);
  const pointMarker = IMITATION_PROMPTS.find((prompt) => prompt.mode === "POINT")!.id;

  assert.equal(handsIds.length, 300);
  room.usedPromptIds.add(pointMarker);
  for (const id of handsIds) room.usedPromptIds.add(id);

  engine.startGame(room, "host", deps);

  assert.equal(room.round!.mode, "HANDS");
  assert.ok(room.usedPromptIds.has(room.round!.promptId));
  assert.ok(room.usedPromptIds.has(pointMarker), "POINT history must survive HANDS exhaustion reset");
  assert.ok(
    handsIds.some((id) => !room.usedPromptIds.has(id)),
    "HANDS cycle should reset before selecting the new-cycle prompt",
  );
});

test("a new room starts with fresh exact prompt history", () => {
  const first = roomWith();
  first.usedPromptIds.add("H01");

  const second = createRoomState("FGHIJ", "host2", NOW());
  assert.equal(second.usedPromptIds.size, 0);
});

test("room-session prompt history is never exposed in the client view", () => {
  const room = roomWith();
  engine.startGame(room, "host", deps);

  const viewJson = JSON.stringify(buildView(room, "p1", "https://example.test/join/ABCDE"));
  assert.ok(!viewJson.includes("usedPromptIds"));
});

test("expanded active bank is exactly 900 with 300 prompts per mode", () => {
  assert.equal(IMITATION_PROMPTS.length, 900);
  for (const mode of ["HANDS", "POINT", "NUMBER"] as GameMode[]) {
    assert.equal(
      IMITATION_PROMPTS.filter((prompt) => prompt.mode === mode).length,
      300,
      `${mode} bank size`,
    );
  }
});
