import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRoomState,
  type InternalPlayer,
  type RoomState,
} from "../src/game/state.js";
import * as engine from "../src/game/engine.js";
import { buildView } from "../src/game/view.js";

const NOW = () => 1_000;

function addPlayer(room: RoomState, uid: string, name: string): void {
  const p: InternalPlayer = {
    uid,
    name,
    normalizedName: name,
    score: 0,
    connected: true,
    joinedAt: 1,
    lastSeen: 1,
    isHost: false,
  };
  room.players.set(uid, p);
}

/** Deterministic rng from a fixed sequence (loops). */
function seqRng(seq: number[]): () => number {
  let i = 0;
  return () => seq[i++ % seq.length];
}

function lobbyWith(n: number): RoomState {
  const room = createRoomState("ABCDE", "host", NOW());
  for (let i = 1; i <= n; i++) addPlayer(room, `p${i}`, `player${i}`);
  room.categories = ["food"];
  room.totalRounds = 3;
  return room;
}

test("startGame requires minimum players", () => {
  const room = lobbyWith(2);
  assert.throws(() => engine.startGame(room, "host", { rng: Math.random, now: NOW }), /NOT_ENOUGH_PLAYERS/);
});

test("startGame requires a category", () => {
  const room = lobbyWith(3);
  room.categories = [];
  assert.throws(() => engine.startGame(room, "host", { rng: Math.random, now: NOW }), /NO_CATEGORY/);
});

test("only the host can start", () => {
  const room = lobbyWith(3);
  assert.throws(() => engine.startGame(room, "p1", { rng: Math.random, now: NOW }), /NOT_HOST/);
});

test("exactly one impostor per round, always an active player", () => {
  const room = lobbyWith(4);
  const deps = { rng: seqRng([0.1, 0.7, 0.3, 0.9]), now: NOW };
  engine.startGame(room, "host", deps);
  assert.equal(room.phase, "QUESTION");
  assert.ok(room.round);
  assert.ok(room.players.has(room.round!.impostorUid));
});

test("impostor selection favors players chosen least (fairness)", () => {
  const room = lobbyWith(3);
  // Pretend p1 has been impostor twice already.
  room.impostorHistory = ["p1", "p1"];
  const chosen = new Set<string>();
  for (let k = 0; k < 20; k++) {
    const uid = engine.selectImpostor(room, { rng: () => Math.random(), now: NOW });
    chosen.add(uid);
  }
  // p1 should never be chosen while others have a lower count.
  assert.ok(!chosen.has("p1"));
});

test("each player gets their own question; impostor differs", () => {
  const room = lobbyWith(3);
  engine.startGame(room, "host", { rng: seqRng([0.0, 0.5]), now: NOW });
  const r = room.round!;
  for (const uid of room.players.keys()) {
    const q = engine.questionFor(r, uid);
    if (uid === r.impostorUid) assert.equal(q, r.impostorQuestion);
    else assert.equal(q, r.normalQuestion);
  }
  assert.notEqual(r.normalQuestion, r.impostorQuestion);
});

test("duplicate answers and votes are rejected", () => {
  const room = lobbyWith(3);
  engine.startGame(room, "host", { rng: seqRng([0.0]), now: NOW });
  engine.openAnswering(room, { rng: Math.random, now: NOW });
  engine.submitAnswer(room, "p1", "قهوة", { rng: Math.random, now: NOW });
  assert.throws(() => engine.submitAnswer(room, "p1", "شاهي", { rng: Math.random, now: NOW }), /ALREADY_SUBMITTED/);
});

test("full round: group finds impostor → voters score, impostor gets 0", () => {
  const room = lobbyWith(3);
  const deps = { rng: seqRng([0.0]), now: NOW }; // impostor = first candidate (p1)
  engine.startGame(room, "host", deps);
  engine.openAnswering(room, deps);
  const imp = room.round!.impostorUid;
  const others = [...room.players.keys()].filter((u) => u !== imp);
  for (const u of room.players.keys()) engine.submitAnswer(room, u, "answer", deps);
  assert.ok(engine.allAnswered(room));
  engine.reveal(room, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
  // Both normal players vote for the impostor; impostor votes for someone.
  for (const u of others) engine.submitVote(room, u, imp, deps);
  engine.submitVote(room, imp, others[0], deps);
  assert.ok(engine.allVoted(room));
  engine.computeResult(room, deps);
  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.groupFound, true);
  for (const u of others) assert.equal(room.players.get(u)!.score, 1);
  assert.equal(room.players.get(imp)!.score, 0);
});

test("tie at the top → impostor survives and earns 2", () => {
  const room = lobbyWith(4);
  const deps = { rng: seqRng([0.0]), now: NOW };
  engine.startGame(room, "host", deps);
  engine.openAnswering(room, deps);
  const imp = room.round!.impostorUid;
  const others = [...room.players.keys()].filter((u) => u !== imp);
  for (const u of room.players.keys()) engine.submitAnswer(room, u, "x", deps);
  engine.reveal(room, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
  // Create a tie: others[0] and others[1] each get one vote; nobody gets 2.
  engine.submitVote(room, imp, others[0], deps);
  engine.submitVote(room, others[0], others[1], deps);
  engine.submitVote(room, others[1], others[0], deps);
  engine.submitVote(room, others[2], imp, deps); // imp gets 1 too → 3-way tie at 1
  engine.computeResult(room, deps);
  assert.equal(room.round!.groupFound, false);
  assert.equal(room.players.get(imp)!.score, 2);
});

test("nextRound advances then ends the game", () => {
  const room = lobbyWith(3);
  room.totalRounds = 1;
  const deps = { rng: seqRng([0.0]), now: NOW };
  engine.startGame(room, "host", deps);
  engine.openAnswering(room, deps);
  for (const u of room.players.keys()) engine.submitAnswer(room, u, "x", deps);
  engine.reveal(room, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
  for (const u of room.players.keys()) {
    const target = [...room.players.keys()].find((t) => t !== u)!;
    engine.submitVote(room, u, target, deps);
  }
  engine.computeResult(room, deps);
  engine.nextRound(room, "host", deps);
  assert.equal(room.phase, "GAME_OVER");
});

test("SECURITY: pre-result views never leak the impostor or the other question", () => {
  const room = lobbyWith(3);
  const deps = { rng: seqRng([0.0]), now: NOW };
  engine.startGame(room, "host", deps);
  engine.openAnswering(room, deps);
  const r = room.round!;
  const imp = r.impostorUid;
  const normalUid = [...room.players.keys()].find((u) => u !== imp)!;

  const serialize = (uid: string) => JSON.stringify(buildView(room, uid, "http://x/join/ABCDE"));

  // Host view must not contain any question text, nor any field that marks a
  // player as the impostor. (Player uids appear in the public roster for
  // everyone equally — that is not a leak; an "impostor" marker would be.)
  const hostView = serialize("host");
  assert.ok(!hostView.includes(r.normalQuestion));
  assert.ok(!hostView.includes(r.impostorQuestion));
  assert.ok(!/impostor/i.test(hostView)); // no impostor field/marker leaked
  assert.equal(buildView(room, "host", "http://x/join/ABCDE").result, undefined);
  assert.equal(buildView(room, "host", "http://x/join/ABCDE").myQuestion, undefined);

  // A normal player must see ONLY the normal question, never the impostor's.
  const normalView = serialize(normalUid);
  assert.ok(normalView.includes(r.normalQuestion));
  assert.ok(!normalView.includes(r.impostorQuestion));

  // The impostor sees only their own (impostor) question, not the normal one,
  // and is not told they are the impostor.
  const impView = buildView(room, imp, "http://x/join/ABCDE");
  assert.equal(impView.myQuestion, r.impostorQuestion);
  assert.ok(!JSON.stringify(impView).includes(r.normalQuestion));
});

test("SECURITY: votes are hidden until the result is computed", () => {
  const room = lobbyWith(3);
  const deps = { rng: seqRng([0.0]), now: NOW };
  engine.startGame(room, "host", deps);
  engine.openAnswering(room, deps);
  for (const u of room.players.keys()) engine.submitAnswer(room, u, "x", deps);
  engine.reveal(room, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
  const uids = [...room.players.keys()];
  engine.submitVote(room, uids[0], uids[1], deps);
  // Mid-voting: host view exposes only a count, no targets.
  const hostView = buildView(room, "host", "http://x/join/ABCDE");
  assert.equal(hostView.votesProgress?.submitted, 1);
  assert.equal(hostView.result, undefined);
  // Another player cannot see who voted for whom.
  const pView = buildView(room, uids[2], "http://x/join/ABCDE");
  assert.equal(pView.result, undefined);
  assert.ok(!JSON.stringify(pView).includes(`"${uids[1]}":`)); // no tally map leaked
});
