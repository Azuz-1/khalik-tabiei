import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { promptNoveltyToken } from "../src/game/promptNovelty.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";
import { buildView } from "../src/game/view.js";

const deps = { rng: () => 0, now: () => 1_000 };

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

function startedRoom(): RoomState {
  const room = createRoomState("ABCDE", "legacy-host", 1_000);
  addPlayer(room, "p1", 1);
  addPlayer(room, "p2", 2);
  addPlayer(room, "p3", 3);
  engine.startGame(room, room.hostUid, deps);
  return room;
}

function serialized(room: RoomState, uid: string): string {
  return JSON.stringify(buildView(room, uid, "https://example.test/join/ABCDE"));
}

test("novelty token is absent from every pre-reveal projection and promptId remains server-only", () => {
  const room = startedRoom();
  const round = room.round!;

  for (const phase of ["QUESTION", "COUNTDOWN", "ACTION", "HOLD"] as const) {
    if (phase === "COUNTDOWN") {
      for (const uid of round.participantUids) engine.markReady(room, uid, deps);
      engine.startCountdown(room, 6_000, deps);
    }
    if (phase === "ACTION") engine.toAction(room, 7_000, deps);
    if (phase === "HOLD") engine.toHold(room, 9_000, deps);

    for (const uid of [room.hostUid, ...round.participantUids, "spectator-outside-room"]) {
      const json = serialized(room, uid);
      assert.equal(json.includes("noveltyToken"), false, `${phase} leaked novelty token to ${uid}`);
      assert.equal(json.includes(round.promptId), false, `${phase} leaked promptId to ${uid}`);
    }
  }
});

test("public reveal exposes stable novelty token only to participating player views", () => {
  const room = startedRoom();
  const round = room.round!;
  for (const uid of round.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 6_000, deps);
  engine.toAction(room, 7_000, deps);
  engine.toHold(room, 9_000, deps);
  engine.revealPrompt(room, 11_500, deps);

  const expectedToken = promptNoveltyToken(round.promptId);
  for (const uid of round.participantUids) {
    const view = buildView(room, uid, "https://example.test/join/ABCDE");
    assert.equal(view.publicPrompt?.text, round.prompt);
    assert.equal(view.publicPrompt?.noveltyToken, expectedToken);
    assert.equal(JSON.stringify(view).includes(round.promptId), false);
  }

  const legacyHost = buildView(room, room.hostUid, "https://example.test/join/ABCDE");
  assert.equal(legacyHost.publicPrompt?.text, round.prompt);
  assert.equal(legacyHost.publicPrompt?.noveltyToken, undefined);

  const spectator = buildView(room, "spectator-outside-room", "https://example.test/join/ABCDE");
  assert.equal(spectator.publicPrompt?.text, round.prompt);
  assert.equal(spectator.publicPrompt?.noveltyToken, undefined);
});

test("reconnecting participant can record novelty only after the prompt is public", () => {
  const room = startedRoom();
  const round = room.round!;
  const uid = round.participantUids[0]!;

  assert.equal(buildView(room, uid, "https://example.test/join/ABCDE").publicPrompt, undefined);
  for (const participantUid of round.participantUids) engine.markReady(room, participantUid, deps);
  engine.startCountdown(room, 6_000, deps);
  engine.toAction(room, 7_000, deps);
  engine.toHold(room, 9_000, deps);
  assert.equal(buildView(room, uid, "https://example.test/join/ABCDE").publicPrompt, undefined);

  engine.revealPrompt(room, 11_500, deps);
  assert.equal(
    buildView(room, uid, "https://example.test/join/ABCDE").publicPrompt?.noveltyToken,
    promptNoveltyToken(round.promptId),
  );
});
