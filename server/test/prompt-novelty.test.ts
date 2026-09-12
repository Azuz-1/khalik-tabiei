import { test } from "node:test";
import assert from "node:assert/strict";
import { NAME_MAX } from "../../shared/constants.js";
import {
  PROMPT_NOVELTY_ENCODED_LENGTH,
  PROMPT_NOVELTY_FILTER_BYTES,
  PROMPT_NOVELTY_SLOTS_PER_MODE,
  PROMPT_NOVELTY_VERSION,
  addPromptNovelty,
  hasPromptNovelty,
  isPromptNoveltyFilter,
  promptNoveltySlot,
  unionPromptNovelty,
  type PromptNoveltyFilter,
} from "../../shared/promptNovelty.js";
import { readConfig } from "../src/config.js";
import * as engine from "../src/game/engine.js";
import { IMITATION_PROMPTS } from "../src/game/imitationPrompts.data.js";
import { decodePromptNoveltyFilter, promptNoveltyToken } from "../src/game/promptNovelty.js";
import { markSessionPromptSeen } from "../src/game/sessionPromptHistory.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";
import { parseClientMessage } from "../src/security/messages.js";

const deps = { rng: () => 0, now: () => 1_000 };

function encoded(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function filter(bytes = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES)): PromptNoveltyFilter {
  return { version: PROMPT_NOVELTY_VERSION, bits: encoded(bytes) };
}

function addPlayer(room: RoomState, uid: string, index: number): void {
  const player: InternalPlayer = {
    uid,
    name: `لاعب${index}`,
    normalizedName: `لاعب${index}`,
    score: 0,
    connected: true,
    joinedAt: index,
    lastSeen: 1,
    disconnectGeneration: 0,
    isHost: false,
  };
  room.players.set(uid, player);
}

function roomWithPlayers(code = "ABCDE"): RoomState {
  const room = createRoomState(code, "host", 1_000);
  addPlayer(room, "p1", 1);
  addPlayer(room, "p2", 2);
  addPlayer(room, "p3", 3);
  addPlayer(room, "p4", 4);
  return room;
}

test("exact history v2 has fixed dimensions and strict version/encoding validation", () => {
  const valid = filter();
  assert.equal(valid.bits.length, PROMPT_NOVELTY_ENCODED_LENGTH);
  assert.equal(PROMPT_NOVELTY_FILTER_BYTES, 192);
  assert.equal(PROMPT_NOVELTY_SLOTS_PER_MODE, 512);
  assert.equal(isPromptNoveltyFilter(valid), true);
  assert.ok(decodePromptNoveltyFilter(valid));

  assert.equal(isPromptNoveltyFilter({ version: 0, bits: valid.bits }), false);
  assert.equal(isPromptNoveltyFilter({ version: 1, bits: valid.bits }), false);
  assert.equal(isPromptNoveltyFilter({ version: 2, bits: valid.bits.slice(1) }), false);
  assert.equal(isPromptNoveltyFilter({ version: 2, bits: `${valid.bits.slice(0, -1)}!` }), false);
  assert.equal(isPromptNoveltyFilter({ ...valid, extra: true }), false);
  assert.equal(
    decodePromptNoveltyFilter({ version: 1, bits: valid.bits } as unknown as PromptNoveltyFilter),
    undefined,
  );
});

test("every prompt owns a distinct immutable history slot", () => {
  assert.equal(IMITATION_PROMPTS.length, 900);
  const slots = new Map<number, string>();
  for (const prompt of IMITATION_PROMPTS) {
    const slot = promptNoveltySlot(prompt.id);
    assert.ok(slot !== undefined, `${prompt.id} has no history slot`);
    assert.equal(slots.has(slot), false, `slot ${slot} collides: ${slots.get(slot)} vs ${prompt.id}`);
    slots.set(slot, prompt.id);
  }
  // Slots are a pure function of the id, so the data-file order cannot move them.
  assert.equal(promptNoveltySlot("H01"), 0);
  assert.equal(promptNoveltySlot("H001"), 10);
  assert.equal(promptNoveltySlot("P01"), PROMPT_NOVELTY_SLOTS_PER_MODE);
  assert.equal(promptNoveltySlot("N290"), 2 * PROMPT_NOVELTY_SLOTS_PER_MODE + 299);
  assert.equal(promptNoveltySlot("X01"), undefined);
});

test("exact history is exact: no false positives and no false negatives across the 900 bank", () => {
  const bytes = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
  const half = IMITATION_PROMPTS.filter((_, index) => index % 2 === 0);
  for (const prompt of half) addPromptNovelty(bytes, promptNoveltyToken(prompt.id)!);
  for (const prompt of IMITATION_PROMPTS) {
    const expected = half.includes(prompt);
    assert.equal(
      hasPromptNovelty(bytes, promptNoveltyToken(prompt.id)!),
      expected,
      `${prompt.id} should read back as ${expected}`,
    );
  }
});

test("stable novelty tokens depend on prompt identity, not prompt wording", () => {
  assert.equal(promptNoveltyToken("H101"), promptNoveltyToken("H101"));
  assert.notEqual(promptNoveltyToken("H101"), promptNoveltyToken("H102"));
  assert.match(promptNoveltyToken("H101")!, /^[a-f0-9]{4}$/);
});

test("union combines very different participant histories", () => {
  const a = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
  const b = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
  const tokenA = promptNoveltyToken("H101")!;
  const tokenB = promptNoveltyToken("P205")!;
  addPromptNovelty(a, tokenA);
  addPromptNovelty(b, tokenB);
  const merged = unionPromptNovelty([a, b]);
  assert.equal(hasPromptNovelty(merged, tokenA), true);
  assert.equal(hasPromptNovelty(merged, tokenB), true);
});

test("cross-room novelty avoids a prompt seen by any current participant", () => {
  const first = roomWithPlayers("AAAAA");
  engine.setSettings(first, "host", { selectedModes: ["HANDS"] }, deps);
  engine.startGame(first, "host", deps);
  const seenPromptId = first.round!.promptId;

  const history = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
  addPromptNovelty(history, promptNoveltyToken(seenPromptId)!);

  const second = roomWithPlayers("BBBBB");
  engine.setSettings(second, "host", { selectedModes: ["HANDS"] }, deps);
  second.promptNoveltyByUid.set("p2", history);
  engine.startGame(second, "host", deps);

  assert.notEqual(second.round!.promptId, seenPromptId);
});

test("current-player exact history outranks room-session preference", () => {
  const hands = IMITATION_PROMPTS.filter((prompt) => prompt.mode === "HANDS");
  assert.equal(hands.length, 300);
  const seenByCurrentPlayers = hands[hands.length - 1]!;

  const history = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
  addPromptNovelty(history, promptNoveltyToken(seenByCurrentPlayers.id)!);

  const room = roomWithPlayers();
  engine.setSettings(room, "host", { selectedModes: ["HANDS"] }, deps);
  room.promptNoveltyByUid.set("p1", history);
  for (const prompt of hands) {
    if (prompt.id !== seenByCurrentPlayers.id) markSessionPromptSeen(room, prompt.id);
  }

  engine.startGame(room, "host", deps);

  assert.notEqual(
    room.round!.promptId,
    seenByCurrentPlayers.id,
    "room-session preference must never force a repeat while exact-unseen prompts exist",
  );
  assert.equal(hasPromptNovelty(history, promptNoveltyToken(room.round!.promptId)!), false);
});

test("malicious all-ones history degrades only novelty and never blocks gameplay", () => {
  const room = roomWithPlayers();
  engine.setSettings(room, "host", { selectedModes: ["HANDS"] }, deps);
  room.promptNoveltyByUid.set("p1", new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES).fill(0xff));
  assert.doesNotThrow(() => engine.startGame(room, "host", deps));
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.round?.mode, "HANDS");
  assert.ok(room.round?.promptId);
});

test("all-seen HANDS history does not consume or reset another mode", () => {
  const history = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
  for (const prompt of IMITATION_PROMPTS.filter((candidate) => candidate.mode === "HANDS")) {
    addPromptNovelty(history, promptNoveltyToken(prompt.id)!);
  }

  const room = roomWithPlayers();
  engine.setSettings(room, "host", { selectedModes: ["POINT"] }, deps);
  room.promptNoveltyByUid.set("p1", history);
  engine.startGame(room, "host", deps);
  assert.equal(room.round?.mode, "POINT");
  assert.equal(room.usedPromptIds.size, 1);
  assert.ok(room.round?.promptId.startsWith("P"));
  assert.equal(room.promptNoveltyByUid.get("p1"), history, "browser history must not be reset server-side");
});

test("full JOIN_ROOM novelty envelope fits the shipped WebSocket max and parses", () => {
  const maxBytes = readConfig({
    NODE_ENV: "development",
    SESSION_SECRET: "prompt-novelty-test-secret-0123456789-abcdef",
  }).maxMessageBytes;
  const novelty = filter(new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES).fill(0xff));
  const message = {
    t: "JOIN_ROOM",
    code: "ABCDE",
    name: "ع".repeat(NAME_MAX),
    novelty,
    rid: "r".repeat(32),
  };
  const json = JSON.stringify(message);
  const byteLength = Buffer.byteLength(json, "utf8");
  assert.equal(maxBytes, 8 * 1024);
  assert.ok(byteLength < maxBytes, `JOIN novelty envelope is ${byteLength} bytes vs ${maxBytes}`);
  assert.ok(parseClientMessage(Buffer.from(json), maxBytes));
  assert.equal(parseClientMessage(Buffer.from(json), byteLength - 1), null);
});
