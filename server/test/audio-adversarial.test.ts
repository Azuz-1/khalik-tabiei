import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  HostAudioEventController,
  type HostAudioSnapshot,
} from "../../client/src/audio/hostAudioEvents.js";
import {
  createGameAudioRuntime,
  type AudioContextConstructorLike,
  type AudioContextLike,
  type AudioParamLike,
  type GainNodeLike,
  type OscillatorNodeLike,
} from "../../client/src/audio/gameAudio.js";

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

test("final vote still produces one anonymous vote cue before RESULT sound", () => {
  const controller = new HostAudioEventController();
  controller.update(snapshot({ phase: "VOTING", submittedVotes: 2, totalVotes: 3 }));

  const events = controller.update(
    snapshot({
      phase: "RESULT",
      submittedVotes: undefined,
      totalVotes: undefined,
      result: { groupFound: true, roundComplete: true, challengeIndex: 1 },
    }),
  );

  assert.deepEqual(events, [
    { type: "voteReceived", count: 1 },
    { type: "caught" },
  ]);
  assert.equal(JSON.stringify(events).includes("uid"), false);
});

test("batched last votes collapse to one aggregate cue instead of overlapping pops", () => {
  const controller = new HostAudioEventController();
  controller.update(
    snapshot({
      phase: "VOTING",
      challengeIndex: 3,
      submittedVotes: 1,
      totalVotes: 4,
      playerUids: ["p1", "p2", "p3", "p4"],
    }),
  );

  const events = controller.update(
    snapshot({
      phase: "RESULT",
      challengeIndex: 3,
      submittedVotes: undefined,
      totalVotes: undefined,
      playerUids: ["p1", "p2", "p3", "p4"],
      result: { groupFound: false, roundComplete: true, challengeIndex: 3 },
    }),
  );

  assert.deepEqual(events, [
    { type: "voteReceived", count: 3 },
    { type: "escaped" },
  ]);
});

test("create-room gesture unlocks audio before the HostAudioLayer exists", async () => {
  const homeSource = await readFile(
    new URL("../../client/src/screens/Home.tsx", import.meta.url),
    "utf8",
  );

  const createRoomIndex = homeSource.indexOf("actions.createRoom()");
  const unlockIndex = homeSource.lastIndexOf("void unlockAudio();", createRoomIndex);
  assert.ok(createRoomIndex > 0, "create-room action missing");
  assert.ok(unlockIndex > 0, "create-room gesture does not unlock audio");
  assert.ok(unlockIndex < createRoomIndex, "audio unlock must happen before CREATE_ROOM is sent");
});

test("Host gesture unlock is retryable after pagehide/BFCache-style audio disposal", async () => {
  const hookSource = await readFile(
    new URL("../../client/src/audio/useHostGameAudio.ts", import.meta.url),
    "utf8",
  );

  assert.equal(hookSource.includes("let unlocked = false"), false);
  assert.ok(hookSource.includes('document.addEventListener("pointerdown", tryUnlock, true)'));
  assert.ok(hookSource.includes("void unlockAudio();"));
});

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
  connect(): unknown {
    return this;
  }
  disconnect(): void {}
  start(): void {}
  stop(): void {
    this.onended?.();
  }
}

function contextConstructor(
  initialState: string,
  metrics: { instances: number; resumes: number; closes: number },
): AudioContextConstructorLike {
  return class FakeAudioContext implements AudioContextLike {
    currentTime = 1;
    state = initialState;
    destination = {};

    constructor() {
      metrics.instances += 1;
    }

    createGain(): GainNodeLike {
      return new FakeGain();
    }

    createOscillator(): OscillatorNodeLike {
      return new FakeOscillator();
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

test("unlockAudio resumes WebKit-style interrupted contexts", async () => {
  const metrics = { instances: 0, resumes: 0, closes: 0 };
  const runtime = createGameAudioRuntime({
    getAudioContextConstructor: () => contextConstructor("interrupted", metrics),
    getStorage: () => undefined,
  });

  assert.equal(await runtime.unlockAudio(), true);
  assert.equal(metrics.instances, 1);
  assert.equal(metrics.resumes, 1);
  await runtime.disposeAudio();
});

test("audio runtime can unlock again after disposal", async () => {
  const metrics = { instances: 0, resumes: 0, closes: 0 };
  const runtime = createGameAudioRuntime({
    getAudioContextConstructor: () => contextConstructor("suspended", metrics),
    getStorage: () => undefined,
  });

  assert.equal(await runtime.unlockAudio(), true);
  await runtime.disposeAudio();
  assert.equal(await runtime.unlockAudio(), true);

  assert.equal(metrics.instances, 2);
  assert.equal(metrics.resumes, 2);
  assert.equal(metrics.closes, 1);
  await runtime.disposeAudio();
});
