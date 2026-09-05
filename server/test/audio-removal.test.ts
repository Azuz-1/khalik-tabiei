import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HostAudioEventController,
  type HostAudioSnapshot,
} from "../../client/src/audio/hostAudioEvents.js";

function voting(overrides: Partial<HostAudioSnapshot> = {}): HostAudioSnapshot {
  return {
    roomCode: "ABCDE",
    phase: "VOTING",
    currentRound: 1,
    challengeIndex: 1,
    submittedVotes: 3,
    totalVotes: 4,
    playerUids: ["p1", "p2", "p3", "p4"],
    ...overrides,
  };
}

function result(playerUids = ["p1", "p2", "p3", "p4"]): HostAudioSnapshot {
  return {
    roomCode: "ABCDE",
    phase: "RESULT",
    currentRound: 1,
    challengeIndex: 1,
    playerUids,
    result: { groupFound: true, roundComplete: true, challengeIndex: 1 },
  };
}

test("3/4 to RESULT with unchanged participants recovers exactly one real final vote cue", () => {
  const controller = new HostAudioEventController();
  controller.update(voting());

  const events = controller.update(result());

  assert.deepEqual(events, [
    { type: "voteReceived", count: 1 },
    { type: "caught" },
  ]);
});

test("3/4 to RESULT after missing participant removal emits no fake final vote cue", () => {
  const controller = new HostAudioEventController();
  controller.update(voting());

  const events = controller.update(result(["p1", "p2", "p3"]));

  assert.deepEqual(events, [{ type: "caught" }]);
  assert.equal(events.some((event) => event.type === "voteReceived"), false);
});

test("participant removal after an already-received ballot never creates revote or duplicate vote sounds", () => {
  const controller = new HostAudioEventController();
  controller.update(voting({ submittedVotes: 2 }));

  // One real vote arrives. The controller intentionally sees only aggregate
  // progress, never whether this committed ballot targeted the player who will
  // be removed next.
  assert.deepEqual(controller.update(voting({ submittedVotes: 3 })), [
    { type: "voteReceived", count: 1 },
  ]);

  // The missing fourth player is removed and the server immediately computes
  // RESULT for the three remaining submitted voters. No additional ballot was
  // cast, so only the result sting is valid.
  const afterRemoval = controller.update(result(["p1", "p2", "p3"]));
  assert.deepEqual(afterRemoval, [{ type: "caught" }]);
  assert.equal(afterRemoval.some((event) => event.type === "voteReceived"), false);
});
