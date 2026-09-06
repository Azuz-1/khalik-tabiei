import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClientView } from "../../shared/types.js";
import {
  HostAudioEventController,
  visibleCountdownSecond,
  type HostAudioEvent,
  type HostAudioSnapshot,
} from "../../client/src/audio/hostAudioEvents.js";
import { RoomManager } from "../src/game/roomManager.js";
import { authenticatedConnection, createRoom, joinPlayer, testUid } from "./helpers.js";

/** Mirrors the production snapshotFromView in useHostGameAudio.ts. */
function snapshotFromView(view: ClientView): HostAudioSnapshot {
  return {
    roomCode: view.room.code,
    phase: view.room.phase,
    currentRound: view.room.currentRound,
    challengeIndex: view.challenge?.index,
    submittedVotes: view.votesProgress?.submitted,
    totalVotes: view.votesProgress?.total,
    phaseEndsAt: view.room.phaseEndsAt,
    playerUids: view.players.map((player) => player.uid),
    result: view.result
      ? {
          groupFound: view.result.groupFound,
          roundComplete: view.result.roundComplete,
          challengeIndex: view.result.challengeIndex,
        }
      : undefined,
  };
}

function snapshot(overrides: Partial<HostAudioSnapshot> = {}): HostAudioSnapshot {
  return {
    roomCode: "ABCDE",
    phase: "LOBBY",
    currentRound: 1,
    challengeIndex: 1,
    submittedVotes: 0,
    totalVotes: 3,
    playerUids: ["p1", "p2", "p3"],
    ...overrides,
  };
}

const ticks = (events: HostAudioEvent[]) =>
  events.filter((event) => event.type === "countdownTick");

// --- 1..4: a restarted countdown is a new audio attempt -----------------------

test("restarted COUNTDOWN re-emits step 5 exactly once and stays de-duplicated", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "QUESTION" }));

  // 1. First attempt emits step 5.
  controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: 5_000 }));
  assert.deepEqual(controller.observeCountdown(5), [{ type: "countdownTick", step: 5 }]);
  assert.deepEqual(controller.observeCountdown(5), [], "same attempt does not repeat step 5");

  // 2. Host drops: the paused countdown publishes no authoritative deadline.
  controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: undefined }));
  assert.deepEqual(controller.observeCountdown(null), [], "paused countdown is silent");

  // 3. Host returns: same phase, new authoritative deadline, new attempt.
  controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: 9_000 }));
  assert.deepEqual(
    controller.observeCountdown(5),
    [{ type: "countdownTick", step: 5 }],
    "restarted attempt emits its own step 5",
  );

  // 4. Repeated snapshots carrying the same new deadline do not duplicate it.
  controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: 9_000 }));
  controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: 9_000 }));
  assert.deepEqual(controller.observeCountdown(5), [], "repeat snapshots do not re-tick");
  assert.deepEqual(controller.observeCountdown(4), [{ type: "countdownTick", step: 4 }]);
});

test("COUNTDOWN restart without an observed pause snapshot still re-emits", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "QUESTION" }));
  controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: 5_000 }));
  assert.equal(ticks(controller.observeCountdown(5)).length, 1);

  // A fast reconnect can deliver the restarted deadline with no pause snapshot.
  controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: 12_000 }));
  assert.equal(ticks(controller.observeCountdown(5)).length, 1);
});

test("a countdown restart resets step dedupe only, never result join or voting dedupe", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "VOTING", submittedVotes: 0, totalVotes: 3 }));

  // Bank a result so its dedupe key is recorded.
  const resultSnapshot = {
    phase: "RESULT" as const,
    result: { groupFound: false, roundComplete: false, challengeIndex: 1 },
  };
  const first = controller.update(snapshot(resultSnapshot));
  assert.ok(
    first.some((event) => event.type === "challengeSurvived"),
    "the result sound plays once when it first happens",
  );

  controller.update(snapshot({ phase: "QUESTION", currentRound: 1, challengeIndex: 2 }));
  controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: 5_000 }));
  controller.observeCountdown(5);
  controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: undefined }));
  const restart = controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: 9_000 }));

  assert.deepEqual(restart, [], "the restart snapshot itself makes no sound");
  assert.equal(ticks(controller.observeCountdown(5)).length, 1, "but the tick returns");

  // Result dedupe survived: replaying the identical result stays silent.
  const replay = controller.update(snapshot(resultSnapshot));
  assert.ok(
    !replay.some((event) =>
      ["caught", "escaped", "challengeSurvived"].includes(event.type),
    ),
    "the already-heard result must not replay after a countdown restart",
  );
  // Join dedupe survived: the same players do not re-announce themselves.
  const lobby = controller.update(snapshot({ phase: "LOBBY" }));
  assert.ok(!lobby.some((event) => event.type === "join"), "known players do not rejoin");
});

// --- 5: reconnecting onto history stays silent -------------------------------

test("a Host reconnecting straight onto a historical RESULT stays silent", () => {
  const controller = new HostAudioEventController();
  const events = controller.update(
    snapshot({
      phase: "RESULT",
      result: { groupFound: true, roundComplete: true, challengeIndex: 2 },
    }),
  );
  assert.deepEqual(events, [], "priming on history replays nothing");
  const again = controller.update(
    snapshot({
      phase: "RESULT",
      result: { groupFound: true, roundComplete: true, challengeIndex: 2 },
    }),
  );
  assert.deepEqual(again, [], "and it stays silent on the next snapshot");
});

test("a Host reconnecting mid-COUNTDOWN primes without replaying the attempt", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "COUNTDOWN", phaseEndsAt: 5_000 }));
  assert.deepEqual(controller.observeCountdown(5), [{ type: "countdownTick", step: 5 }]);
  assert.deepEqual(controller.observeCountdown(5), []);
});

// --- end-to-end: the real server really does publish a new deadline ----------

test("real Host disconnect/reconnect in COUNTDOWN drives a fresh audible attempt", () => {
  let now = 1_000_000;
  const manager = new RoomManager({ rng: () => 0, countdownMs: 5_000, now: () => now });
  const host = createRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;

  const controller = new HostAudioEventController();
  const feed = (socket: { messages: unknown[] }, from = 0): HostAudioEvent[] => {
    const events: HostAudioEvent[] = [];
    for (const message of socket.messages.slice(from) as Array<{ t: string; view: ClientView }>) {
      if (message.t === "STATE") events.push(...controller.update(snapshotFromView(message.view)));
    }
    return events;
  };

  feed(host.socket);
  manager.handle(host.conn, { t: "START_GAME" });
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  feed(host.socket);

  assert.equal(room.phase, "COUNTDOWN");
  const firstDeadline = room.phaseEndsAt;
  assert.equal(firstDeadline, now + 5_000);
  const before = {
    promptId: room.round!.promptId,
    mode: room.round!.mode,
    impostor: room.round!.impostorUid,
    participants: [...room.round!.participantUids],
  };

  const step = visibleCountdownSecond(firstDeadline, now);
  assert.equal(step, 5);
  assert.deepEqual(controller.observeCountdown(step), [{ type: "countdownTick", step: 5 }]);
  assert.deepEqual(controller.observeCountdown(step), [], "no duplicate inside one attempt");

  // The Host really disconnects, real time passes, the Host really returns.
  manager.disconnect(host.conn);
  assert.equal(room.pause?.originalPhase, "COUNTDOWN");
  now += 4_321;
  const rejoined = authenticatedConnection(manager, testUid(1));

  assert.equal(room.phase, "COUNTDOWN", "the same Challenge restarts at COUNTDOWN");
  assert.notEqual(room.phaseEndsAt, firstDeadline, "the server issues a new deadline");
  assert.deepEqual(
    {
      promptId: room.round!.promptId,
      mode: room.round!.mode,
      impostor: room.round!.impostorUid,
      participants: room.round!.participantUids,
    },
    before,
    "prompt, mode, impostor and participants are preserved across the restart",
  );

  const restartEvents = feed(rejoined.socket);
  assert.ok(
    !restartEvents.some((event) =>
      ["caught", "escaped", "challengeSurvived", "gameOver"].includes(event.type),
    ),
    "reconnecting replays no historical result sounds",
  );

  const restartStep = visibleCountdownSecond(room.phaseEndsAt, now);
  assert.equal(restartStep, 5);
  assert.deepEqual(
    controller.observeCountdown(restartStep),
    [{ type: "countdownTick", step: 5 }],
    "the restarted attempt's first tick is audible again",
  );
  assert.deepEqual(controller.observeCountdown(restartStep), [], "and only once");

  manager.dispose();
});
