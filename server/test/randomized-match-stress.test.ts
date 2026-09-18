import test from "node:test";
import assert from "node:assert/strict";
import type { GameMode } from "../../shared/types.js";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoom, joinPlayer, lastMessage } from "./helpers.js";

const TARGETS = [3, 6, 9, 12] as const;
const MODES: readonly GameMode[] = ["HANDS", "POINT", "NUMBER"];

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

function selectedModes(random: () => number): GameMode[] {
  const chosen = MODES.filter(() => random() < 0.55);
  return chosen.length ? [...chosen] : [pick(MODES, random)];
}

function advance(room: NonNullable<ReturnType<RoomManager["roomForTests"]>>, now: () => number): void {
  const deps = { now, rng: () => 0.5 };
  engine.startCountdown(room, now() + 1, deps);
  engine.toAction(room, now() + 1, deps);
  engine.toHold(room, now() + 1, deps);
  engine.revealPrompt(room, now() + 1, deps);
  engine.toDiscussion(room, deps);
}

test("100 seeded randomized matches preserve competitive invariants", () => {
  let challengeCount = 0;
  let caughtChallenges = 0;
  let survivedChallenges = 0;
  const playerCountCoverage = new Set<number>();
  const targetCoverage = new Set<number>();
  const modeCoverage = new Set<GameMode>();

  for (let scenario = 1; scenario <= 100; scenario += 1) {
    const random = rng(0x51f15e + scenario * 9973);
    const playerCount = 3 + Math.floor(random() * 8);
    const target = pick(TARGETS, random);
    const modes = selectedModes(random);
    let clock = scenario * 10_000_000;
    const now = () => ++clock;
    const manager = new RoomManager({ rng: random, now });
    const host = createRoom(manager);
    const players = Array.from({ length: playerCount }, (_, index) => joinPlayer(manager, host.code, index + 2));
    const room = manager.roomForTests(host.code)!;

    playerCountCoverage.add(playerCount);
    targetCoverage.add(target);
    modes.forEach((mode) => modeCoverage.add(mode));

    assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: target, selectedModes: modes }), true);
    assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
    const prompts = new Set<string>();

    for (let completed = 0; completed < target; completed += 1) {
      assert.equal(room.phase, "QUESTION", `R${scenario} C${completed + 1}: QUESTION`);
      const round = room.round!;
      assert.equal(round.participantUids.length, playerCount);
      assert.equal(round.maxChallenges, 3);
      assert.ok(modes.includes(round.mode));
      assert.ok(!prompts.has(round.promptId), `R${scenario}: prompt repeat ${round.promptId}`);
      prompts.add(round.promptId);

      const impostorUid = round.impostorUid;
      const catchThisChallenge = random() < 0.48;
      advance(room, now);
      assert.equal(manager.handle(host.conn, { t: "START_VOTING" }), true);

      for (const player of players) {
        let targetUid: string;
        if (catchThisChallenge && player.uid !== impostorUid) {
          targetUid = impostorUid;
        } else {
          targetUid = players.find((candidate) => candidate.uid !== player.uid && candidate.uid !== impostorUid)?.uid
            ?? players.find((candidate) => candidate.uid !== player.uid)!.uid;
        }
        assert.notEqual(targetUid, player.uid);
        assert.equal(manager.handle(player.conn, { t: "SUBMIT_VOTE", targetUid }), true);
      }

      assert.equal(room.phase, "RESULT");
      assert.equal(room.completedChallenges, completed + 1);
      assert.equal(room.round?.resultComputed, true);
      assert.equal(room.round?.groupFound, catchThisChallenge);
      if (catchThisChallenge) caughtChallenges += 1;
      else survivedChallenges += 1;
      challengeCount += 1;

      assert.equal(manager.handle(host.conn, { t: "NEXT_ROUND" }), true);
      assert.equal(room.phase, completed + 1 === target ? "GAME_OVER" : "QUESTION");
    }

    assert.equal(room.completedChallenges, target);
    assert.equal(prompts.size, target);
    const view = lastMessage(host.socket, "STATE")?.view;
    assert.equal(view?.room.phase, "GAME_OVER");
    assert.equal(view?.gameOver?.targetChallenges, target);
    assert.equal(view?.gameOver?.completedChallenges, target);
    assert.equal(view?.scoreboard?.length, playerCount);
    assert.ok(view?.scoreboard?.every((row) => Number.isInteger(row.score) && row.score >= 0));
    assert.ok(view?.scoreboard?.every((row) => Number.isInteger(row.rank) && row.rank >= 1));
    manager.dispose();
  }

  assert.deepEqual([...playerCountCoverage].sort((a, b) => a - b), [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual([...targetCoverage].sort((a, b) => a - b), [3, 6, 9, 12]);
  assert.deepEqual([...modeCoverage].sort(), ["HANDS", "NUMBER", "POINT"]);
  assert.ok(challengeCount >= 600, `expected hundreds of Challenges, got ${challengeCount}`);
  assert.ok(caughtChallenges > 0);
  assert.ok(survivedChallenges > 0);
});
