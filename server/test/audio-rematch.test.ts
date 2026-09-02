import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HostAudioEventController,
  type HostAudioSnapshot,
} from "../../client/src/audio/hostAudioEvents.js";

function snapshot(overrides: Partial<HostAudioSnapshot> = {}): HostAudioSnapshot {
  return {
    roomCode: "ABCDE",
    phase: "LOBBY",
    currentRound: 1,
    challengeIndex: 1,
    submittedVotes: 0,
    playerUids: ["p1", "p2", "p3"],
    ...overrides,
  };
}

function eventTypes(controller: HostAudioEventController, value: HostAudioSnapshot): string[] {
  return controller.update(value).map((event) => event.type);
}

test("rematch resets per-game result dedupe so the same caught result can sound again", () => {
  const controller = new HostAudioEventController();
  const caught = { groupFound: true, roundComplete: true, challengeIndex: 1 };

  // Game 1, round 1, challenge 1.
  controller.update(snapshot({ phase: "VOTING", currentRound: 1 }));
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "RESULT", currentRound: 1, result: caught })), [
    "caught",
  ]);
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "RESULT", currentRound: 1, result: caught })), []);

  // Rematch returns the same room and players to Lobby, then starts Game 2.
  controller.update(snapshot({ phase: "GAME_OVER", currentRound: 1 }));
  controller.update(snapshot({ phase: "LOBBY", currentRound: 1 }));
  controller.update(snapshot({ phase: "QUESTION", currentRound: 1 }));
  controller.update(snapshot({ phase: "VOTING", currentRound: 1 }));

  // Game 2 has the same round/challenge/outcome identity, but it is a new game.
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "RESULT", currentRound: 1, result: caught })), [
    "caught",
  ]);
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "RESULT", currentRound: 1, result: caught })), []);
});

test("escaped result still de-duplicates within one game", () => {
  const controller = new HostAudioEventController();
  const escaped = { groupFound: false, roundComplete: true, challengeIndex: 3 };

  controller.update(snapshot({ phase: "VOTING" }));
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "RESULT", result: escaped })), ["escaped"]);
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "RESULT", result: escaped })), []);
});

test("intermediate survival still de-duplicates and never becomes a full escaped result", () => {
  const controller = new HostAudioEventController();
  const survived = { groupFound: false, roundComplete: false, challengeIndex: 1 };

  controller.update(snapshot({ phase: "VOTING" }));
  const first = controller.update(snapshot({ phase: "RESULT", result: survived }));
  assert.deepEqual(first, [{ type: "challengeSurvived" }]);
  assert.equal(first.some((event) => event.type === "escaped"), false);
  assert.deepEqual(controller.update(snapshot({ phase: "RESULT", result: survived })), []);
});
