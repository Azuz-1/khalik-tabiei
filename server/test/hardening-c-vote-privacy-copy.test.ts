import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { buildView } from "../src/game/view.js";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoom, joinPlayer } from "./helpers.js";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

/** The player-facing voting screen copy, isolated from the rest of the file. */
function votingHelperCopy(): string {
  const player = source("client/src/screens/Player.tsx");
  const start = player.indexOf("أكّد التصويت");
  assert.ok(start > 0, "the vote confirm button should still exist");
  const helper = player.slice(start).match(/<p className="helper">([^<]*)<\/p>/);
  assert.ok(helper, "the voting screen should still carry a helper line");
  return helper![1]!;
}

function reachVoting() {
  const manager = new RoomManager({ rng: () => 0 });
  const host = createRoom(manager);
  [2, 3, 4].forEach((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, { t: "START_GAME" });
  const deps = { now: () => Date.now(), rng: () => 0 };
  engine.startCountdown(room, Date.now() + 1, deps);
  engine.toAction(room, Date.now() + 1, deps);
  engine.toHold(room, Date.now() + 1, deps);
  engine.revealPrompt(room, Date.now() + 1, deps);
  engine.toDiscussion(room, deps);
  manager.handle(host.conn, { t: "START_VOTING" });
  assert.equal(room.phase, "VOTING");
  return { manager, room, host };
}

test("Host sees vote progress but no live target tally", () => {
  const { manager, room, host } = reachVoting();
  try {
    const hostView = buildView(room, host.uid, "http://localhost/join");
    assert.equal(hostView.liveVoteTally, undefined);
    assert.equal(hostView.votesProgress?.submitted, 0);
    assert.equal(hostView.votesProgress?.total, room.round?.participantUids.length);
  } finally {
    manager.dispose();
  }
});

test("player voting copy explains progress-only visibility without overstating secrecy", () => {
  const copy = votingHelperCopy();
  assert.ok(copy.includes("كم شخص صوّت"), `copy should explain progress-only visibility — got: ${copy}`);
  assert.ok(copy.includes("مين صوّت لمين"), `copy should retain the no voter-to-target mapping promise — got: ${copy}`);
  assert.ok(!copy.includes("مجمّع"), `live target aggregates are no longer shown during voting — got: ${copy}`);
});

test("the accurate copy keeps the still-true no-revote fact", () => {
  const copy = votingHelperCopy();
  assert.ok(copy.includes("تغيّر صوتك"), `expected the no-revote fact — got: ${copy}`);
});

test("no voter-to-target mapping or live target totals reach any recipient during VOTING", () => {
  const { manager, room, host } = reachVoting();
  try {
    const participants = [...room.players.values()];
    const voter = participants[0]!;
    const target = participants[1]!;
    engine.submitVote(room, voter.uid, target.uid, { now: () => Date.now(), rng: () => 0 });

    for (const uid of [host.uid, ...participants.map((player) => player.uid)]) {
      const view = buildView(room, uid, "http://localhost/join");
      const wire = JSON.stringify(view);
      assert.ok(!wire.includes("voterUid"), "no voter identity field");
      assert.ok(!wire.includes(`\"${voter.uid}\",\"${target.uid}\"`), "no voter->target pair is serialized");
      assert.equal(view.liveVoteTally, undefined, "live target totals stay hidden for every recipient");
    }

    const hostView = buildView(room, host.uid, "http://localhost/join");
    assert.equal(hostView.votesProgress?.submitted, 1, "Host still sees anonymous submission progress");
  } finally {
    manager.dispose();
  }
});
