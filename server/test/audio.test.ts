import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  HostAudioEventController,
  visibleCountdownSecond,
  type HostAudioSnapshot,
} from "../../client/src/audio/hostAudioEvents.js";
import {
  AUDIO_MUTE_STORAGE_KEY,
  createGameAudioRuntime,
  type AudioContextConstructorLike,
  type AudioContextLike,
  type AudioParamLike,
  type GainNodeLike,
  type OscillatorNodeLike,
  type StorageLike,
} from "../../client/src/audio/gameAudio.js";

function snapshot(overrides: Partial<HostAudioSnapshot> = {}): HostAudioSnapshot {
  return {
    roomCode: "ABCDE",
    phase: "LOBBY",
    currentRound: 1,
    challengeIndex: 1,
    submittedVotes: 0,
    playerUids: ["p1", "p2"],
    ...overrides,
  };
}

function eventTypes(controller: HostAudioEventController, value: HostAudioSnapshot): string[] {
  return controller.update(value).map((event) => event.type);
}

test("countdown tick follows the visible phaseEndsAt number and never repeats on rerender", () => {
  assert.equal(visibleCountdownSecond(6_000, 1_000), 5);
  assert.equal(visibleCountdownSecond(5_001, 1_000), 5);
  assert.equal(visibleCountdownSecond(4_999, 1_000), 4);

  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "COUNTDOWN" }));

  assert.deepEqual(controller.observeCountdown(5), [{ type: "countdownTick", step: 5 }]);
  assert.deepEqual(controller.observeCountdown(5), []);
  assert.deepEqual(controller.observeCountdown(4), [{ type: "countdownTick", step: 4 }]);
  assert.deepEqual(controller.observeCountdown(4), []);
});

test("ACTION plays once on a real phase transition", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "COUNTDOWN" }));
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "ACTION" })), ["action"]);
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "ACTION" })), []);
});

test("PROMPT_REVEAL plays once and DISCUSSION is silent", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "HOLD" }));
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "PROMPT_REVEAL" })), ["promptReveal"]);
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "PROMPT_REVEAL" })), []);
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "DISCUSSION" })), []);
});

test("HOLD gets one soft entry cue only", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "ACTION" }));
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "HOLD" })), ["hold"]);
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "HOLD" })), []);
});

test("VOTING start cue plays once", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "DISCUSSION" }));
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "VOTING", submittedVotes: 0 })), [
    "votingStart",
  ]);
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "VOTING", submittedVotes: 0 })), []);
});

test("submitted vote increments make one anonymous pop and duplicate states stay silent", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "VOTING", submittedVotes: 1 }));

  assert.deepEqual(controller.update(snapshot({ phase: "VOTING", submittedVotes: 2 })), [
    { type: "voteReceived", count: 1 },
  ]);
  assert.deepEqual(controller.update(snapshot({ phase: "VOTING", submittedVotes: 2 })), []);
  assert.deepEqual(controller.update(snapshot({ phase: "VOTING", submittedVotes: 4 })), [
    { type: "voteReceived", count: 2 },
  ]);
});

test("caught completed result gets caught sting once", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "VOTING", submittedVotes: 2 }));
  const result = { groupFound: true, roundComplete: true, challengeIndex: 1 };
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "RESULT", result })), ["caught"]);
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "RESULT", result })), []);
});

test("escaped completed result gets escaped sting", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "VOTING" }));
  assert.deepEqual(
    eventTypes(
      controller,
      snapshot({
        phase: "RESULT",
        result: { groupFound: false, roundComplete: true, challengeIndex: 3 },
      }),
    ),
    ["escaped"],
  );
});

test("intermediate survival never uses full escaped sting", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "VOTING" }));
  const events = controller.update(
    snapshot({
      phase: "RESULT",
      result: { groupFound: false, roundComplete: false, challengeIndex: 1 },
    }),
  );
  assert.deepEqual(events, [{ type: "challengeSurvived" }]);
  assert.equal(events.some((event) => event.type === "escaped"), false);
});

test("refresh/reconnect into RESULT does not replay a historical result sting", () => {
  const controller = new HostAudioEventController();
  const result = { groupFound: true, roundComplete: true, challengeIndex: 2 };
  assert.deepEqual(controller.update(snapshot({ phase: "RESULT", result })), []);
  assert.deepEqual(controller.update(snapshot({ phase: "RESULT", result })), []);
});

test("new Lobby UID makes one join cue while reconnecting a seen UID stays silent", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ playerUids: ["p1", "p2"] }));

  assert.deepEqual(controller.update(snapshot({ playerUids: ["p1", "p2", "p3"] })), [
    { type: "join", count: 1 },
  ]);
  assert.deepEqual(controller.update(snapshot({ playerUids: ["p1", "p2", "p3"] })), []);
  assert.deepEqual(controller.update(snapshot({ playerUids: ["p1", "p2"] })), []);
  assert.deepEqual(controller.update(snapshot({ playerUids: ["p1", "p2", "p3"] })), []);
});

test("GAME_OVER gets one neutral completion cue", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "RESULT" }));
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "GAME_OVER" })), ["gameOver"]);
  assert.deepEqual(eventTypes(controller, snapshot({ phase: "GAME_OVER" })), []);
});

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class FakeParam implements AudioParamLike {
  value = 0;

  setValueAtTime(value: number): void {
    this.value = value;
  }

  linearRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeGain implements GainNodeLike {
  gain = new FakeParam();

  connect(): unknown {
    return this;
  }

  disconnect(): void {}
}

class FakeOscillator implements OscillatorNodeLike {
  type = "sine";
  frequency = new FakeParam();
  onended: (() => void) | null = null;

  constructor(private readonly metrics: { starts: number }) {}

  connect(): unknown {
    return this;
  }

  disconnect(): void {}

  start(): void {
    this.metrics.starts += 1;
  }

  stop(): void {
    this.onended?.();
  }
}

function fakeAudioContextConstructor(metrics: {
  starts: number;
  resumes: number;
  closes: number;
}): AudioContextConstructorLike {
  return class FakeAudioContext implements AudioContextLike {
    currentTime = 1;
    state = "suspended";
    destination = {};

    createGain(): GainNodeLike {
      return new FakeGain();
    }

    createOscillator(): OscillatorNodeLike {
      return new FakeOscillator(metrics);
    }

    async resume(): Promise<void> {
      metrics.resumes += 1;
      this.state = "running";
    }

    async close(): Promise<void> {
      metrics.closes += 1;
      this.state = "closed";
    }
  };
}

test("muted runtime suppresses every synthesized effect after unlock", async () => {
  const metrics = { starts: 0, resumes: 0, closes: 0 };
  const runtime = createGameAudioRuntime({
    getAudioContextConstructor: () => fakeAudioContextConstructor(metrics),
    getStorage: () => new MemoryStorage(),
  });

  assert.equal(await runtime.unlockAudio(), true);
  runtime.playAction();
  assert.equal(metrics.starts, 2);

  runtime.setMuted(true);
  runtime.playAction();
  runtime.playCountdownTick(5);
  runtime.playCaught();
  assert.equal(metrics.starts, 2);

  await runtime.disposeAudio();
  assert.equal(metrics.closes, 1);
});

test("mute preference persists through the localStorage adapter", () => {
  const storage = new MemoryStorage();
  const first = createGameAudioRuntime({
    getAudioContextConstructor: () => undefined,
    getStorage: () => storage,
  });
  first.setMuted(true);
  assert.equal(storage.getItem(AUDIO_MUTE_STORAGE_KEY), "1");

  const second = createGameAudioRuntime({
    getAudioContextConstructor: () => undefined,
    getStorage: () => storage,
  });
  assert.equal(second.isMuted(), true);

  second.setMuted(false);
  const third = createGameAudioRuntime({
    getAudioContextConstructor: () => undefined,
    getStorage: () => storage,
  });
  assert.equal(third.isMuted(), false);
});

test("unsupported AudioContext fails gracefully and gameplay-facing calls remain safe", async () => {
  const runtime = createGameAudioRuntime({
    getAudioContextConstructor: () => undefined,
    getStorage: () => undefined,
  });

  assert.equal(await runtime.unlockAudio(), false);
  assert.doesNotThrow(() => {
    runtime.playCountdownTick(5);
    runtime.playAction();
    runtime.playHold();
    runtime.playPromptReveal();
    runtime.playVotingStart();
    runtime.playVoteReceived(3);
    runtime.playCaught();
    runtime.playEscaped();
    runtime.playChallengeSurvived();
    runtime.playGameOver();
    runtime.playJoin();
  });
});

test("Player phone has no audio integration", async () => {
  const playerSource = await readFile(
    new URL("../../client/src/screens/Player.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(playerSource.includes("/audio/"), false);
  assert.equal(playerSource.includes("gameAudio"), false);
  assert.equal(playerSource.includes("AudioContext"), false);
});
