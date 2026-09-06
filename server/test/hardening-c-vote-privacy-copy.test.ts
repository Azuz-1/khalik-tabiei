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

test("the live aggregate vote board is still enabled for the Host", () => {
  const { manager, room, host } = reachVoting();
  try {
    const hostView = buildView(room, host.uid, "http://localhost/join");
    assert.ok(
      Array.isArray(hostView.liveVoteTally),
      "the shared TV keeps its live aggregate board; if this is ever removed, revisit the player copy below",
    );
  } finally {
    manager.dispose();
  }
});

test("player voting copy never claims absolute secrecy while the live board is live", () => {
  const { manager, room, host } = reachVoting();
  try {
    const hostView = buildView(room, host.uid, "http://localhost/join");
    if (!Array.isArray(hostView.liveVoteTally)) return; // board disabled: claim would be fair

    const copy = votingHelperCopy();

    // An absolute claim is false while the TV shows running totals.
    const overclaims = ["سرّي", "سري", "سرية", "سريّة", "مجهول", "مخفي تمامًا", "ما أحد يشوف"];
    for (const phrase of overclaims) {
      assert.ok(
        !copy.includes(phrase),
        `voting copy must not claim "${phrase}" while the Host board shows live aggregate counts — got: ${copy}`,
      );
    }

    // And it must actually disclose what the shared screen reveals.
    assert.ok(
      copy.includes("مين صوّت لمين"),
      `voting copy should say the voter-to-target mapping is hidden — got: ${copy}`,
    );
    assert.ok(
      copy.includes("مجمّع"),
      `voting copy should disclose that counts are shown in aggregate — got: ${copy}`,
    );
  } finally {
    manager.dispose();
  }
});

test("the accurate copy keeps the still-true no-revote fact", () => {
  const copy = votingHelperCopy();
  assert.ok(copy.includes("تغيّر صوتك"), `expected the no-revote fact — got: ${copy}`);
});

test("no voter-to-target mapping reaches any recipient during VOTING", () => {
  const { manager, room, host } = reachVoting();
  try {
    const participants = [...room.players.values()];
    const voter = participants[0]!;
    const target = participants[1]!;
    engine.submitVote(room, voter.uid, target.uid, { now: () => Date.now(), rng: () => 0 });

    for (const uid of [host.uid, ...participants.map((player) => player.uid)]) {
      const wire = JSON.stringify(buildView(room, uid, "http://localhost/join"));
      assert.ok(!wire.includes("voterUid"), "no voter identity field");
      assert.ok(
        !wire.includes(`"${voter.uid}","${target.uid}"`),
        "no voter->target pair is serialized",
      );
    }

    const hostView = buildView(room, host.uid, "http://localhost/join");
    const total = (hostView.liveVoteTally ?? []).reduce((sum, row) => sum + row.votes, 0);
    assert.equal(total, 1, "the Host board is aggregate-only, and it is genuinely live");
  } finally {
    manager.dispose();
  }
});
