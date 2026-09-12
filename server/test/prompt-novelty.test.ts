import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROMPT_NOVELTY_ENCODED_LENGTH,
  PROMPT_NOVELTY_FILTER_BYTES,
  PROMPT_NOVELTY_HASH_COUNT,
  PROMPT_NOVELTY_VERSION,
  addPromptNovelty,
  hasPromptNovelty,
  isPromptNoveltyFilter,
  promptNoveltyFalsePositiveProbability,
  unionPromptNovelty,
  type PromptNoveltyFilter,
} from "../../shared/promptNovelty.js";
import { readConfig } from "../src/config.js";
import * as engine from "../src/game/engine.js";
import { IMITATION_PROMPTS } from "../src/game/imitationPrompts.data.js";
import { decodePromptNoveltyFilter, promptNoveltyToken } from "../src/game/promptNovelty.js";
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

test("Bloom v1 has fixed dimensions and strict version/encoding validation", () => {
  const valid = filter();
  assert.equal(valid.bits.length, PROMPT_NOVELTY_ENCODED_LENGTH);
  assert.equal(PROMPT_NOVELTY_FILTER_BYTES, 3_072);
  assert.equal(PROMPT_NOVELTY_HASH_COUNT, 18);
  assert.equal(isPromptNoveltyFilter(valid), true);
  assert.ok(decodePromptNoveltyFilter(valid));

  assert.equal(isPromptNoveltyFilter({ version: 0, bits: valid.bits }), false);
  assert.equal(isPromptNoveltyFilter({ version: 2, bits: valid.bits }), false);
  assert.equal(isPromptNoveltyFilter({ version: 1, bits: valid.bits.slice(1) }), false);
  assert.equal(isPromptNoveltyFilter({ version: 1, bits: `${valid.bits.slice(0, -1)}!` }), false);
  assert.equal(isPromptNoveltyFilter({ ...valid, extra: true }), false);
  assert.equal(decodePromptNoveltyFilter({ version: 2, bits: valid.bits }), null);
});

test("900-item Bloom false-positive probability stays below one in 100,000", () => {
  const probability = promptNoveltyFalsePositiveProbability(900);
  assert.ok(probability > 0);
  assert.ok(probability < 0.00001, `FP probability too high: ${probability}`);
});

test("Bloom has no false negatives for all 900 stable prompt novelty tokens", () => {
  assert.equal(IMITATION_PROMPTS.length, 900);
  const bytes = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
  for (const prompt of IMITATION_PROMPTS) addPromptNovelty(bytes, promptNoveltyToken(prompt.id));
  for (const prompt of IMITATION_PROMPTS) {
    assert.equal(hasPromptNovelty(bytes, promptNoveltyToken(prompt.id)), true, `false negative for ${prompt.id}`);
  }
});

test("stable novelty tokens depend on prompt identity, not prompt wording", () => {
  assert.equal(promptNoveltyToken("H101"), promptNoveltyToken("H101"));
  assert.notEqual(promptNoveltyToken("H101"), promptNoveltyToken("H102"));
  assert.match(promptNoveltyToken("H101"), /^[a-f0-9]{32}$/);
});

test("union combines very different participant histories", () => {
  const a = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
  const b = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
  const tokenA = promptNoveltyToken("H101");
  const tokenB = promptNoveltyToken("P205");
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
  addPromptNovelty(history, promptNoveltyToken(seenPromptId));

  const second = roomWithPlayers("BBBBB");
  engine.setSettings(second, "host", { selectedModes: ["HANDS"] }, deps);
  second.promptNoveltyByUid.set("p2", history);
  engine.startGame(second, "host", deps);

  assert.notEqual(second.round!.promptId, seenPromptId);
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
    addPromptNovelty(history, promptNoveltyToken(prompt.id));
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
    name: "ع".repeat(128),
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
