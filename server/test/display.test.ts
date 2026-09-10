import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { createDisplayToken, verifyDisplayToken } from "../src/game/display.js";
import { buildView } from "../src/game/view.js";
import { createRoomState, type InternalPlayer } from "../src/game/state.js";

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

test("display capability is signed and bound to one concrete room instance", () => {
  const secret = "test-secret-with-enough-entropy";
  const room = createRoomState("ABCDE", "owner", 1234);
  const token = createDisplayToken(room, secret);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(verifyDisplayToken(room, secret, token), true);
  assert.equal(verifyDisplayToken({ ...room, createdAt: 1235 }, secret, token), false);
  assert.equal(verifyDisplayToken({ ...room, hostUid: "other" }, secret, token), false);
  assert.equal(verifyDisplayToken({ ...room, code: "FGHJK" }, secret, token), false);
  assert.equal(verifyDisplayToken(room, `${secret}-wrong`, token), false);
  assert.equal(verifyDisplayToken(room, secret, `${token.slice(0, -1)}!`), false);
});

test("synthetic display projection never receives participant secrets or management capabilities", () => {
  const room = createRoomState("ABCDE", "owner", 1000);
  addPlayer(room, "owner", "المالك", true);
  addPlayer(room, "p2", "لاعب2");
  addPlayer(room, "p3", "لاعب3");
  engine.startGame(room, "owner", { now: () => 1000, rng: () => 0 });
  assert.equal(room.phase, "QUESTION");

  const ownerView = buildView(room, "owner", "https://game.test/join/ABCDE");
  const displayView = buildView(room, "display:test", "https://game.test/join/ABCDE");

  assert.equal(ownerView.self.role, "player");
  assert.equal(ownerView.self.isOwner, true);
  assert.equal(displayView.self.role, "spectator");
  assert.equal(displayView.self.isOwner, false);
  assert.equal(displayView.isImpostor, undefined);
  assert.equal(displayView.myPrompt, undefined);
  assert.equal(displayView.myReady, undefined);
  assert.equal(displayView.voteTargets, undefined);
  assert.equal(displayView.myVoteSubmitted, undefined);
  assert.equal(displayView.settingsEditable, undefined);
  assert.equal(displayView.blockedPlayers, undefined);
  assert.equal(displayView.nextRoundWarning, undefined);
  assert.deepEqual(displayView.readyProgress, { submitted: 0, total: 3 });
});
