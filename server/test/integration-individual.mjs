/** Real WebSocket E2E for INDIVIDUAL scoring and secrecy boundaries. */
import { WebSocket } from "ws";

const URL = process.env.URL ?? "ws://localhost:8080/ws";
const ORIGIN = process.env.ORIGIN ?? URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const TIMEOUT_MS = 15_000;
let failures = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ok(condition, message) {
  if (condition) console.log("  ✓", message);
  else {
    failures += 1;
    console.error("  ✗", message);
  }
}

class Client {
  constructor(label) {
    this.label = label;
    this.uid = null;
    this.view = null;
    this.messages = [];
    this.ws = null;
    this.ready = this.connect();
  }

  async connect() {
    const response = await fetch(`${ORIGIN}/api/session`);
    if (!response.ok) throw new Error(`${this.label}: session bootstrap failed`);
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    if (!cookie) throw new Error(`${this.label}: session cookie missing`);

    this.ws = new WebSocket(URL, { headers: { Cookie: cookie, Origin: ORIGIN } });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: auth timeout`)), TIMEOUT_MS);
      this.ws.once("error", reject);
      this.ws.on("open", () => this.send({ t: "HELLO" }));
      this.ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        this.messages.push(message);
        if (message.t === "HELLO_OK") {
          this.uid = message.uid;
          clearTimeout(timer);
          resolve();
        } else if (message.t === "STATE") {
          this.view = message.view;
          this.uid = message.view.self.uid;
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  phase() {
    return this.view?.room?.phase;
  }

  rawText() {
    return JSON.stringify(this.messages);
  }

  clearMessages() {
    this.messages = [];
  }

  close() {
    this.ws?.close();
  }
}

async function waitFor(client, predicate, label, timeout = TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate(client)) return;
    await sleep(40);
  }
  throw new Error(`timeout waiting for ${label}; ${client.label} phase=${client.phase()}`);
}

async function waitForAll(clients, predicate, label) {
  await Promise.all(clients.map((client) => waitFor(client, predicate, `${client.label} ${label}`)));
}

function roles(players) {
  const impostors = players.filter((player) => player.view?.isImpostor === true);
  const normals = players.filter((player) => player.view?.isImpostor === false);
  ok(impostors.length === 1, "INDIVIDUAL still has exactly one private impostor");
  ok(normals.length === 2, "INDIVIDUAL still has two normal players");
  return { impostor: impostors[0], normals };
}

function assertNoVoteMapping(client, label) {
  const raw = client.rawText();
  ok(!raw.includes("voterUid"), `${label} wire has no voterUid`);
  ok(!raw.includes("voterName"), `${label} wire has no voterName`);
  ok(!raw.includes("targetUid"), `${label} wire has no voter-to-target mapping`);
  ok(!raw.includes("voteBreakdown"), `${label} wire has no voteBreakdown`);
}

function assertNoScoreInternals(client, label) {
  const raw = client.rawText();
  ok(!raw.includes("pendingRoundScores"), `${label} wire has no pendingRoundScores`);
  ok(!raw.includes("roundDelta"), `${label} wire has no intermediate roundDelta`);
}

async function physical(host, players, label) {
  const { impostor, normals } = roles(players);
  const prompt = normals[0].view?.myPrompt?.text;
  ok(typeof prompt === "string" && prompt.length > 0, `${label} normal prompt exists`);
  ok(normals.every((normal) => normal.view?.myPrompt?.text === prompt), `${label} normals share prompt`);
  ok(impostor.view?.myPrompt === undefined, `${label} impostor has no prompt`);
  ok(host.view?.publicPrompt === undefined, `${label} host has no prompt before reveal`);
  const impostorQuestionView = JSON.stringify(impostor.view);
  ok(!impostorQuestionView.includes("promptId"), `${label} impostor QUESTION view has no promptId`);
  ok(!impostorQuestionView.includes(prompt), `${label} impostor QUESTION view has no prompt text`);

  for (const player of players) player.send({ t: "MARK_READY" });
  await waitFor(host, (client) => client.phase() === "COUNTDOWN", `${label} countdown`);
  ok(host.view?.publicPrompt === undefined, `${label} prompt remains secret during countdown`);
  await waitFor(host, (client) => client.phase() === "PROMPT_REVEAL", `${label} reveal`, 12_000);
  ok(host.view?.publicPrompt?.text === prompt, `${label} prompt reveals at normal boundary`);
  await waitFor(host, (client) => client.phase() === "DISCUSSION", `${label} discussion`, 6_000);
  await waitForAll(players, (client) => client.phase() === "DISCUSSION", `${label} discussion`);
  return { impostor, normals };
}

async function catchCurrentRound(host, players, label) {
  const { impostor, normals } = await physical(host, players, label);
  for (const client of [host, ...players]) client.clearMessages();
  host.send({ t: "START_VOTING" });
  await waitForAll([host, ...players], (client) => client.phase() === "VOTING", `${label} voting`);
  normals[0].send({ t: "SUBMIT_VOTE", targetUid: impostor.uid });
  normals[1].send({ t: "SUBMIT_VOTE", targetUid: impostor.uid });
  impostor.send({ t: "SUBMIT_VOTE", targetUid: normals[0].uid });
  await waitForAll([host, ...players], (client) => client.phase() === "RESULT", `${label} result`);
  ok(host.view?.result?.groupFound === true, `${label} majority catches impostor`);
  ok(host.view?.result?.roundComplete === true, `${label} completes Round`);
  ok(Array.isArray(host.view?.scoreboard), `${label} exposes completed-Round scoreboard`);
  for (const client of [host, ...players]) assertNoVoteMapping(client, `${client.label} ${label}`);
  return { impostor, normals };
}

async function main() {
  console.log("Connecting INDIVIDUAL E2E host + 3 players…");
  const host = new Client("HOST-INDIVIDUAL");
  const players = [new Client("سلمان"), new Client("ناصر"), new Client("فيصل")];
  await Promise.all([host.ready, ...players.map((player) => player.ready)]);

  host.send({ t: "CREATE_ROOM" });
  await waitFor(host, (client) => client.phase() === "LOBBY", "individual lobby");
  const code = host.view.room.code;
  for (const player of players) player.send({ t: "JOIN_ROOM", code, name: player.label });
  await waitFor(host, (client) => client.view?.players?.length === 3, "individual players joined");

  ok(host.view?.room?.playStyle === "TEAM", "TEAM remains the wire default");
  host.send({
    t: "SET_SETTINGS",
    totalRounds: 3,
    selectedModes: ["HANDS", "POINT", "NUMBER"],
    playStyle: "INDIVIDUAL",
  });
  await waitFor(host, (client) => client.view?.room?.playStyle === "INDIVIDUAL", "individual setting accepted");
  await waitForAll(players, (client) => client.view?.room?.playStyle === "INDIVIDUAL", "individual setting broadcast");
  ok(true, "INDIVIDUAL setting travels through parser/server/view over real WebSockets");

  host.send({ t: "START_GAME" });
  await waitForAll([host, ...players], (client) => client.phase() === "QUESTION", "round 1 challenge 1");

  console.log("\n[individual round 1 / challenge 1] one private correct guess, no group majority:");
  let { impostor, normals } = await physical(host, players, "round 1 challenge 1");
  const roundImpostorUid = impostor.uid;

  for (const client of [host, ...players]) client.clearMessages();
  host.send({ t: "START_VOTING" });
  await waitForAll([host, ...players], (client) => client.phase() === "VOTING", "round 1 challenge 1 voting");

  normals[0].send({ t: "SUBMIT_VOTE", targetUid: impostor.uid });
  normals[1].send({ t: "SUBMIT_VOTE", targetUid: normals[0].uid });
  impostor.send({ t: "SUBMIT_VOTE", targetUid: normals[1].uid });
  await waitForAll([host, ...players], (client) => client.phase() === "RESULT", "round 1 challenge 1 result");

  ok(host.view?.result?.roundComplete === false, "one correct guess does not replace majority rule");
  ok(host.view?.scoreboard === undefined, "intermediate Host result exposes no score clue");
  assertNoScoreInternals(host, "Host challenge 1");
  assertNoVoteMapping(host, "Host challenge 1");
  for (const player of players) {
    ok(player.view?.scoreboard === undefined, `${player.label} intermediate phone exposes no score clue`);
    assertNoScoreInternals(player, `${player.label} challenge 1`);
    assertNoVoteMapping(player, `${player.label} challenge 1`);
  }

  host.send({ t: "NEXT_ROUND" });
  await waitForAll(
    [host, ...players],
    (client) => client.phase() === "QUESTION" && client.view?.challenge?.index === 2,
    "round 1 challenge 2",
  );

  console.log("\n[individual round 1 / challenge 2] majority catch reveals accumulated personal points:");
  ({ impostor, normals } = await physical(host, players, "round 1 challenge 2"));
  ok(impostor.uid === roundImpostorUid, "same impostor remains through survived Challenge");

  for (const client of [host, ...players]) client.clearMessages();
  host.send({ t: "START_VOTING" });
  await waitForAll([host, ...players], (client) => client.phase() === "VOTING", "round 1 challenge 2 voting");
  normals[0].send({ t: "SUBMIT_VOTE", targetUid: impostor.uid });
  normals[1].send({ t: "SUBMIT_VOTE", targetUid: impostor.uid });
  impostor.send({ t: "SUBMIT_VOTE", targetUid: normals[0].uid });
  await waitForAll([host, ...players], (client) => client.phase() === "RESULT", "round 1 caught result");

  ok(host.view?.result?.groupFound === true, "majority still controls catch in INDIVIDUAL");
  ok(host.view?.result?.roundComplete === true, "caught result completes Round");
  ok(Array.isArray(host.view?.scoreboard) && host.view.scoreboard.length === 3, "completed Round exposes scoreboard");
  const firstCorrect = host.view.scoreboard?.find((row) => row.uid === normals[0].uid);
  const secondCorrect = host.view.scoreboard?.find((row) => row.uid === normals[1].uid);
  const impostorScore = host.view.scoreboard?.find((row) => row.uid === impostor.uid);
  ok(firstCorrect?.score === 2 && firstCorrect?.roundDelta === 2, "hidden Challenge 1 + Challenge 2 correct votes accumulate to +2");
  ok(secondCorrect?.score === 1 && secondCorrect?.roundDelta === 1, "Challenge 2 correct vote awards +1");
  ok(impostorScore?.score === 0, "caught impostor gets zero survival points");
  for (const client of [host, ...players]) assertNoVoteMapping(client, `${client.label} round 1 result`);

  host.send({ t: "NEXT_ROUND" });
  await waitForAll([host, ...players], (client) => client.phase() === "QUESTION" && client.view?.room?.currentRound === 2, "round 2 start");
  console.log("\n[individual round 2] normal majority catch:");
  await catchCurrentRound(host, players, "round 2 challenge 1");

  host.send({ t: "NEXT_ROUND" });
  await waitForAll([host, ...players], (client) => client.phase() === "QUESTION" && client.view?.room?.currentRound === 3, "round 3 start");
  console.log("\n[individual round 3] normal majority catch:");
  await catchCurrentRound(host, players, "round 3 challenge 1");

  host.send({ t: "NEXT_ROUND" });
  await waitForAll([host, ...players], (client) => client.phase() === "GAME_OVER", "individual GAME_OVER");
  ok(Array.isArray(host.view?.scoreboard) && host.view.scoreboard.length === 3, "GAME_OVER exposes final ranking");
  ok(host.view.scoreboard.every((row) => Number.isInteger(row.rank) && row.rank >= 1), "final ranking has stable numeric ranks");
  ok(!JSON.stringify(host.view.scoreboard).includes("roundDelta"), "GAME_OVER ranking does not carry stale roundDelta");
  for (const client of [host, ...players]) {
    ok(Array.isArray(client.view?.scoreboard) && client.view.scoreboard.length === 3, `${client.label} receives final ranking`);
    assertNoVoteMapping(client, `${client.label} GAME_OVER`);
    ok(!client.rawText().includes("pendingRoundScores"), `${client.label} never receives pendingRoundScores`);
  }

  host.send({ t: "CLOSE_ROOM" });
  await sleep(150);
  for (const client of [host, ...players]) client.close();

  console.log(`\n${failures === 0 ? "INDIVIDUAL ALL PASSED ✅" : `${failures} INDIVIDUAL FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("INDIVIDUAL FATAL", error);
  process.exit(1);
});
