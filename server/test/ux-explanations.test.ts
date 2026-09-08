import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as engine from "../src/game/engine.js";
import { buildView } from "../src/game/view.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";

const deps = { rng: () => 0, now: () => 1_000 };

function roomWithPlayers(count = 4): RoomState {
  const room = createRoomState("UX001", "host", 1_000);
  for (let index = 1; index <= count; index += 1) {
    const player: InternalPlayer = {
      uid: `p${index}`,
      name: `لاعب${index}`,
      normalizedName: `لاعب${index}`,
      seatNumber: index,
      score: 0,
      connected: true,
      joinedAt: index,
      lastSeen: index,
      disconnectGeneration: 0,
      isHost: false,
    };
    room.players.set(player.uid, player);
  }
  return room;
}

function toVoting(room: RoomState): void {
  for (const uid of room.round!.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 2_000, deps);
  engine.toAction(room, 2_100, deps);
  engine.toHold(room, 2_200, deps);
  engine.revealPrompt(room, 2_300, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
}

function resolveChallenge(room: RoomState, correctNormals: Set<string>): void {
  toVoting(room);
  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);
  for (const normal of normals) {
    const wrongTarget = normals.find((candidate) => candidate !== normal) ?? impostor;
    engine.submitVote(room, normal, correctNormals.has(normal) ? impostor : wrongTarget, deps);
  }
  engine.submitVote(room, impostor, normals[0]!, deps);
  engine.computeResult(room, deps);
}

test("completed stint exposes a public reason for every scoreboard row, including zero", () => {
  const room = roomWithPlayers(4);
  engine.startGame(room, "host", deps);
  const impostor = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostor);

  resolveChallenge(room, new Set(normals));
  const view = buildView(room, "host", "https://game.test/join/UX001");

  assert.equal(view.result?.completionReason, "CAUGHT");
  assert.ok(view.scoreboard);
  for (const normal of normals) {
    const row = view.scoreboard!.find((entry) => entry.uid === normal)!;
    assert.equal(row.roundDelta, 1);
    assert.deepEqual(row.roundReason, { kind: "NORMAL_CORRECT_STREAK", count: 1 });
  }
  const impostorRow = view.scoreboard!.find((entry) => entry.uid === impostor)!;
  assert.equal(impostorRow.roundDelta, 0);
  assert.deepEqual(impostorRow.roundReason, { kind: "IMPOSTOR_SURVIVAL", count: 0 });
});

test("score reasons remain absent while the same impostor stint is still active", () => {
  const room = roomWithPlayers(4);
  engine.startGame(room, "host", deps);
  resolveChallenge(room, new Set());

  assert.equal(room.round?.roundComplete, false);
  const view = buildView(room, "host", "https://game.test/join/UX001");
  const wire = JSON.stringify(view);
  assert.equal(view.scoreboard, undefined);
  assert.equal(view.result?.impostorUid, undefined);
  assert.equal(wire.includes("roundReason"), false);
  assert.equal(wire.includes("NORMAL_CORRECT_STREAK"), false);
  assert.equal(wire.includes("IMPOSTOR_SURVIVAL"), false);
});

test("exact match boundary distinguishes a partial final stint from a full three-Challenge escape", () => {
  const partial = roomWithPlayers(4);
  engine.setSettings(partial, "host", { totalRounds: 3 }, deps);
  engine.startGame(partial, "host", deps);

  for (let completed = 0; completed < 2; completed += 1) {
    const impostor = partial.round!.impostorUid;
    const normals = partial.round!.participantUids.filter((uid) => uid !== impostor);
    resolveChallenge(partial, new Set(normals));
    engine.nextRound(partial, "host", deps);
  }
  resolveChallenge(partial, new Set());
  const partialResult = buildView(partial, "host", "https://game.test/join/UX001");
  assert.equal(partial.round?.challengeIndex, 1);
  assert.equal(partialResult.result?.completionReason, "MATCH_END");
  const partialImpostor = partialResult.scoreboard!.find((row) => row.uid === partial.round!.impostorUid)!;
  assert.deepEqual(partialImpostor.roundReason, { kind: "IMPOSTOR_SURVIVAL", count: 1 });
  engine.nextRound(partial, "host", deps);
  const partialGameOver = buildView(partial, "host", "https://game.test/join/UX001").gameOver!;
  assert.equal(partialGameOver.completedEscapeRounds, 0);
  assert.equal(partialGameOver.matchEndedUncaughtRounds, 1);

  const full = roomWithPlayers(4);
  engine.setSettings(full, "host", { totalRounds: 3 }, deps);
  engine.startGame(full, "host", deps);
  for (let challenge = 1; challenge <= 3; challenge += 1) {
    resolveChallenge(full, new Set());
    if (challenge < 3) engine.nextRound(full, "host", deps);
  }
  const fullResult = buildView(full, "host", "https://game.test/join/UX001");
  assert.equal(fullResult.result?.completionReason, "MAX_CHALLENGES");
  const fullImpostor = fullResult.scoreboard!.find((row) => row.uid === full.round!.impostorUid)!;
  assert.deepEqual(fullImpostor.roundReason, { kind: "IMPOSTOR_SURVIVAL", count: 3 });
  engine.nextRound(full, "host", deps);
  const fullGameOver = buildView(full, "host", "https://game.test/join/UX001").gameOver!;
  assert.equal(fullGameOver.completedEscapeRounds, 1);
  assert.equal(fullGameOver.matchEndedUncaughtRounds, 0);
});

test("user-facing source locks the explainability and Arabic copy improvements", () => {
  const home = readFileSync(new URL("../../client/src/screens/Home.tsx", import.meta.url), "utf8");
  const host = readFileSync(new URL("../../client/src/screens/Host.tsx", import.meta.url), "utf8");
  const player = readFileSync(new URL("../../client/src/screens/Player.tsx", import.meta.url), "utf8");
  const errors = readFileSync(new URL("../../client/src/i18n/errors.ts", import.meta.url), "utf8");
  const counts = readFileSync(new URL("../../client/src/i18n/counts.ts", import.meta.url), "utf8");

  assert.match(home, /points-table/);
  assert.match(home, /آخر تصويتين ورا بعض صح/);
  assert.match(player, /كيف تجمع نقاط/);
  assert.match(player, /أكّد التصويت على \$\{pickedName\}/);
  assert.match(player, /vote-confirm-bar/);
  assert.match(host, /scoreReasonText/);
  assert.match(player, /scoreReasonText/);
  assert.match(counts, /count === 2.*صوتين/s);
  assert.match(counts, /count === 2.*ننتظر لاعبين/s);
  assert.match(errors, /بين 2 و16 حرف/);
  assert.equal(/[١٢٣٤٥٦٧٨٩٠]/u.test(home + errors), false, "mixed Arabic-Indic digits returned in primary onboarding/error copy");
});
