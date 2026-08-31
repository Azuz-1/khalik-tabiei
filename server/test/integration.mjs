/**
 * End-to-end multi-client test over real WebSockets against a running server.
 * Drives 1 host + 3 players through two full rounds and asserts the wire never
 * leaks secrets. Run: `node test/integration.mjs` (server must be on :8080).
 */
import { WebSocket } from "ws";
import { randomBytes } from "node:crypto";

const URL = process.env.URL ?? "ws://localhost:8080/ws";
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.error("  ✗", m); } else console.log("  ✓", m); };

class Client {
  constructor(label) {
    this.label = label;
    this.key = randomBytes(24).toString("hex");
    this.uid = null;
    this.view = null;
    this.messages = [];
    this.ws = new WebSocket(URL);
    this.ready = new Promise((res) => {
      this.ws.on("open", () => this.sendRaw({ t: "HELLO", clientKey: this.key }));
      this.ws.on("message", (d) => {
        const m = JSON.parse(d.toString());
        this.messages.push(m);
        if (m.t === "HELLO_OK") { this.uid = m.uid; res(); }
        if (m.t === "STATE") { this.view = m.view; this.uid = m.view.self.uid; res(); }
      });
    });
  }
  sendRaw(o) { this.ws.send(JSON.stringify(o)); }
  send(o) { this.sendRaw(o); }
  phase() { return this.view?.room?.phase; }
  rawText() { return JSON.stringify(this.messages); }
  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(client, pred, label, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (pred(client)) return true;
    await sleep(40);
  }
  throw new Error(`timeout waiting for: ${label} (phase=${client.phase()})`);
}

async function playRound(host, players, roundNo) {
  // Only inspect THIS round's traffic — prior rounds legitimately revealed
  // their result (impostor + questions + tally) at RESULT.
  [host, ...players].forEach((c) => { c.messages = []; });
  await waitFor(host, (c) => c.phase() === "ANSWERING", `round ${roundNo} ANSWERING`);

  // --- SECURITY checks during ANSWERING -----------------------------------
  const qs = players.map((p) => p.view.myQuestion);
  ok(qs.every((q) => typeof q === "string" && q.length > 0), "each player received a question");
  const distinct = new Set(qs);
  ok(distinct.size === 2, "exactly two distinct questions dealt (impostor differs)");
  ok(host.view.myQuestion === undefined, "host view carries NO question");
  // Host wire must contain no question text at all.
  const anyQ = [...distinct];
  ok(!anyQ.some((q) => host.rawText().includes(q)), "host wire never contained any question");
  // Each normal player's wire must not contain the impostor's (other) question.
  for (const p of players) {
    const others = anyQ.filter((q) => q !== p.view.myQuestion);
    ok(!others.some((q) => p.rawText().includes(q)), `player ${p.label} wire has only their own question`);
    ok(!/impostor/i.test(p.rawText()), `player ${p.label} wire has no impostor marker`);
  }

  // Submit answers (each uses their own dealt question, answers freely).
  for (const p of players) p.send({ t: "SUBMIT_ANSWER", answer: `جواب-${p.label}` });

  // ANSWERING -> REVEAL -> DISCUSSION (auto)
  await waitFor(host, (c) => c.phase() === "REVEAL" || c.phase() === "DISCUSSION", "REVEAL");
  ok((host.view.reveal ?? []).length === players.length, "all answers revealed on host");
  await waitFor(host, (c) => c.phase() === "DISCUSSION", "DISCUSSION");

  host.send({ t: "START_VOTING" });
  await waitFor(players[0], (c) => c.phase() === "VOTING", "VOTING");

  // Mid-vote secrecy: after one vote, others see only a count, no result.
  players[0].send({ t: "SUBMIT_VOTE", targetUid: players[1].uid });
  await waitFor(host, (c) => (c.view.votesProgress?.submitted ?? 0) >= 1, "vote progress");
  ok(host.view.result === undefined, "no result exposed mid-voting");
  ok(!players[2].rawText().includes("voteTally"), "voteTally not leaked before result");

  // Remaining players vote.
  players[1].send({ t: "SUBMIT_VOTE", targetUid: players[0].uid });
  players[2].send({ t: "SUBMIT_VOTE", targetUid: players[0].uid });

  await waitFor(host, (c) => c.phase() === "RESULT", "RESULT");
  const r = host.view.result;
  ok(!!r && typeof r.impostorUid === "string", "result reveals impostor at RESULT");
  ok(!!r.normalQuestion && !!r.impostorQuestion, "both questions revealed at RESULT");
  ok((host.view.scoreboard ?? []).length === players.length, "scoreboard present at RESULT");
}

async function main() {
  console.log("Connecting clients…");
  const host = new Client("HOST");
  const p1 = new Client("سلمان");
  const p2 = new Client("ناصر");
  const p3 = new Client("فيصل");
  const players = [p1, p2, p3];
  await Promise.all([host.ready, ...players.map((p) => p.ready)]);

  console.log("\n[negative] join non-existent room:");
  host.send({ t: "JOIN_ROOM", code: "ZZZZZ", name: "x" });
  await waitFor(host, (c) => c.messages.some((m) => m.t === "ERROR" && m.code === "ROOM_NOT_FOUND"), "ROOM_NOT_FOUND");
  ok(true, "unknown code rejected with ROOM_NOT_FOUND");

  console.log("\n[setup] create + join:");
  host.send({ t: "CREATE_ROOM" });
  await waitFor(host, (c) => c.phase() === "LOBBY", "host LOBBY");
  const code = host.view.room.code;
  ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(code), `room code valid: ${code}`);

  for (const p of players) p.send({ t: "JOIN_ROOM", code, name: p.label });
  await waitFor(host, (c) => c.view.players.length === 3, "3 players joined");
  ok(true, "players appear on host in real time");

  console.log("\n[negative] duplicate name + start with settings:");
  const dup = new Client("dup");
  await dup.ready;
  dup.send({ t: "JOIN_ROOM", code, name: "سلمان" });
  await waitFor(dup, (c) => c.messages.some((m) => m.t === "ERROR" && m.code === "DUPLICATE_NAME"), "DUPLICATE_NAME");
  ok(true, "duplicate normalized name rejected");
  dup.close();

  host.send({ t: "SET_SETTINGS", totalRounds: 3, categories: ["food", "friends"] });
  // totalRounds must be one of the allowed options; use 3.
  await waitFor(host, (c) => c.view.room.totalRounds === 3 && c.view.room.categories.length === 2, "settings applied");
  ok(true, "host settings applied (3 rounds, 2 categories)");

  // Shorten to 2 rounds for the test by resetting to an allowed value.
  host.send({ t: "SET_SETTINGS", totalRounds: 3 });
  host.send({ t: "START_GAME" });

  console.log("\n[round 1]:");
  await playRound(host, players, 1);

  console.log("\n[round 2]:");
  host.send({ t: "NEXT_ROUND" });
  await playRound(host, players, 2);

  console.log("\n[round 3 -> game over]:");
  host.send({ t: "NEXT_ROUND" });
  await playRound(host, players, 3);
  host.send({ t: "NEXT_ROUND" });
  await waitFor(host, (c) => c.phase() === "GAME_OVER", "GAME_OVER");
  ok(!!host.view.gameOver?.winnerName, `game over, winner: ${host.view.gameOver?.winnerName}`);

  console.log("\n[reconnect] same key restores the same seat:");
  // p2 "refreshes": close its socket, open a new one with the SAME saved key.
  const savedKey = p2.key;
  const savedUid = p2.uid;
  p2.close();
  await sleep(300);
  const rc = new WebSocket(URL);
  const rcMsgs = [];
  await new Promise((res) => {
    rc.on("open", () => rc.send(JSON.stringify({ t: "HELLO", clientKey: savedKey })));
    rc.on("message", (d) => { const m = JSON.parse(d.toString()); rcMsgs.push(m); if (m.t === "STATE") res(); });
    setTimeout(res, 3000);
  });
  const restored = rcMsgs.find((m) => m.t === "STATE");
  ok(!!restored && restored.view.self.uid === savedUid, "reconnect resolves to the SAME uid via saved key");
  ok(!!restored && restored.view.room?.code === code, "reconnect restored the same room");
  rc.close();

  host.send({ t: "CLOSE_ROOM" });
  await sleep(200);

  console.log(`\n${failures === 0 ? "ALL PASSED ✅" : failures + " FAILED ❌"}`);
  [host, p2, p3].forEach((c) => c.close());
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
