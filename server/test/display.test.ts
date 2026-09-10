import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { buildDisplayView, createDisplayToken, verifyDisplayToken } from "../src/game/display.js";
import { buildView } from "../src/game/view.js";
import { createRoomState, type InternalPlayer } from "../src/game/state.js";

const UIDS = [
  "u_111111111111111111111111",
  "u_222222222222222222222222",
  "u_333333333333333333333333",
] as const;

function addPlayer(room: ReturnType<typeof createRoomState>, uid: string, name: string, isHost = false) {
  const player: InternalPlayer = {
    uid,
    name,
    normalizedName: name,
    score: 0,
    connected: true,
    joinedAt: room.createdAt,
    lastSeen: room.createdAt,
    disconnectGeneration: 0,
    isHost,
  };
  room.players.set(uid, player);
}

function seededRoom(createdAt = 1000) {
  const room = createRoomState("ABCDE", UIDS[0], createdAt);
  addPlayer(room, UIDS[0], "المالك", true);
  addPlayer(room, UIDS[1], "لاعب2");
  addPlayer(room, UIDS[2], "لاعب3");
  return room;
}

test("display capability is signed, room-bound, owner-bound, and epoch-revocable", () => {
  const secret = "test-secret-with-enough-entropy";
  const room = seededRoom(1234);
  const token = createDisplayToken(room, secret, 7);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(verifyDisplayToken(room, secret, token, 7), true);
  assert.equal(verifyDisplayToken(room, secret, token, 8), false, "epoch rotation revokes the old capability");
  assert.equal(verifyDisplayToken({ ...room, createdAt: 1235 }, secret, token, 7), false);
  assert.equal(verifyDisplayToken({ ...room, hostUid: UIDS[1] }, secret, token, 7), false);
  assert.equal(verifyDisplayToken({ ...room, code: "FGHJK" }, secret, token, 7), false);
  assert.equal(verifyDisplayToken(room, `${secret}-wrong`, token, 7), false);
  assert.equal(verifyDisplayToken(room, secret, `${token.slice(0, -1)}!`, 7), false);
});

test("display projection is public-only and never serializes real participant UIDs", () => {
  const secret = "display-alias-secret";
  const room = seededRoom();
  engine.startGame(room, UIDS[0], { now: () => 1000, rng: () => 0 });
  assert.equal(room.phase, "QUESTION");

  const ownerView = buildView(room, UIDS[0], "https://game.test/join/ABCDE");
  const displayView = buildDisplayView(room, "https://game.test/join/ABCDE", secret);
  const json = JSON.stringify(displayView);

  assert.equal(ownerView.self.role, "player");
  assert.equal(ownerView.self.isOwner, true);
  assert.equal(displayView.self.role, "spectator");
  assert.equal(displayView.self.isOwner, false);
  assert.equal(displayView.self.uid, "display");
  assert.equal(displayView.isImpostor, undefined);
  assert.equal(displayView.myPrompt, undefined);
  assert.equal(displayView.myReady, undefined);
  assert.equal(displayView.voteTargets, undefined);
  assert.equal(displayView.myVoteSubmitted, undefined);
  assert.equal(displayView.settingsEditable, undefined);
  assert.equal(displayView.blockedPlayers, undefined);
  assert.equal(displayView.nextRoundWarning, undefined);
  assert.equal(displayView.readyRecovery, undefined);
  assert.deepEqual(displayView.readyProgress, { submitted: 0, total: 3 });
  assert.deepEqual(displayView.players.map((player) => player.seatNumber), [1, 2, 3]);
  for (const uid of UIDS) assert.equal(json.includes(uid), false, `display leaked real uid ${uid}`);
  assert.match(displayView.room.hostUid, /^d_[A-Za-z0-9_-]{16}$/);
  assert.ok(displayView.players.every((player) => /^d_[A-Za-z0-9_-]{16}$/.test(player.uid)));
});

test("same participant receives different display aliases in different room incarnations", () => {
  const secret = "display-alias-secret";
  const first = seededRoom(1000);
  const second = seededRoom(2000);
  const firstView = buildDisplayView(first, "https://game.test/join/ABCDE", secret);
  const secondView = buildDisplayView(second, "https://game.test/join/ABCDE", secret);
  assert.notEqual(firstView.players[0]?.uid, secondView.players[0]?.uid);
});

test("full result and scoreboard identifiers are also remapped before serialization", () => {
  const secret = "display-alias-secret";
  const room = seededRoom();
  engine.startGame(room, UIDS[0], { now: () => 1000, rng: () => 0 });
  const round = room.round!;
  round.roundComplete = true;
  round.resultComputed = true;
  round.groupFound = true;
  round.resultRequiredVotes = 2;
  round.resultImpostorName = room.players.get(round.impostorUid)?.name ?? "—";
  round.resultVoteTally = UIDS.map((uid, index) => ({ uid, name: room.players.get(uid)!.name, votes: index === 0 ? 2 : 0 }));
  round.roundScores = new Map(UIDS.map((uid, index) => [uid, index]));
  room.players.get(UIDS[0])!.score = 3;
  room.players.get(UIDS[1])!.score = 2;
  room.players.get(UIDS[2])!.score = 1;
  room.phase = "RESULT";

  const displayView = buildDisplayView(room, "https://game.test/join/ABCDE", secret);
  const json = JSON.stringify(displayView);
  for (const uid of UIDS) assert.equal(json.includes(uid), false, `full result leaked real uid ${uid}`);
  assert.ok(displayView.result?.impostorUid?.startsWith("d_"));
  assert.ok(displayView.result?.voteTally?.every((entry) => entry.uid.startsWith("d_")));
  assert.ok(displayView.scoreboard?.every((entry) => entry.uid.startsWith("d_")));
});
