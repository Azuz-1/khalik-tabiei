/** Real WebSocket E2E for four-player 3/2/1 streak scoring and secrecy. */
import { WebSocket } from "ws";

const URL = process.env.URL ?? "ws://localhost:8080/ws";
const ORIGIN = process.env.ORIGIN ?? URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const TIMEOUT_MS = 70_000;
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

async function waitForAll(clients, predicate, label, timeout = TIMEOUT_MS) {
  await Promise.all(clients.map((client) => waitFor(client, predicate, `${client.label} ${label}`, timeout)));
}

function roles(players) {
  const impostors = players.filter((player) => player.view?.isImpostor === true);
  const normals = players.filter((player) => player.view?.isImpostor === false);
  ok(impostors.length === 1, "four-player stint has exactly one private impostor");
  ok(normals.length === 3, "four-player stint has three normals");
  return { impostor: impostors[0], normals };
}

function assertNoInternals(client, label) {
  const raw = client.rawText();
  ok(!raw.includes("voterUid"), `${label}: no voterUid`);
  ok(!raw.includes("voterName"), `${label}: no voterName`);
  ok(!raw.includes("targetUid"), `${label}: no voter-to-target mapping`);
  ok(!raw.includes("voteBreakdown"), `${label}: no voteBreakdown`);
  ok(!raw.includes("correctVoteStreakStart"), `${label}: no hidden streak state`);
  ok(!raw.includes("pendingRoundScores"), `${label}: no pending score state`);
}

async function physical(host, players, label) {
  const current = roles(players);
  const prompt = current.normals[0].view?.myPrompt?.text;
  ok(typeof prompt === "string" && prompt.length > 0, `${label}: normal prompt exists`);
  ok(current.normals.every((normal) => normal.view?.myPrompt?.text === prompt), `${label}: normals share prompt`);
  ok(current.impostor.view?.myPrompt === undefined, `${label}: impostor has no prompt`);
  ok(host.view?.publicPrompt === undefined, `${label}: Host has no prompt before reveal`);
  ok(!current.impostor.rawText().includes(prompt), `${label}: impostor raw wire has no secret prompt`);
  ok(!current.impostor.rawText().includes("promptId"), `${label}: impostor raw wire has no promptId`);

  for (const player of players) player.send({ t: "MARK_READY" });
  await waitFor(host, (client) => client.phase() === "COUNTDOWN", `${label} countdown`);
  await waitFor(host, (client) => client.phase() === "PROMPT_REVEAL", `${label} reveal`, 12_000);
  ok(host.view?.publicPrompt?.text === prompt, `${label}: prompt reveals only after physical sequence`);
  await waitForAll([host, ...players], (client) => client.phase() === "DISCUSSION", `${label} discussion`, 6_000);
  return current;
}

async function vote(host, players, current, correctNormalCount, label) {
  for (const client of [host, ...players]) client.clearMessages();
  await waitForAll([host, ...players], (client) => client.phase() === "VOTING", `${label} automatic voting`, 55_000);
  ok(host.view?.votesProgress?.submitted === 0, `${label}: voting starts with zero submitted ballots`);
  ok(host.view?.votesProgress?.total === players.length, `${label}: voting progress reports all participants`);
  ok(host.view?.votesProgress?.requiredVotes === undefined, `${label}: live progress exposes no quorum target`);
  ok(host.view?.liveVoteTally === undefined, `${label}: Host sees no live target totals`);

  for (let index = 0; index < current.normals.length; index += 1) {
    const normal = current.normals[index];
    const wrongTarget = current.normals[(index + 1) % current.normals.length];
    normal.send({
      t: "SUBMIT_VOTE",
      targetUid: index < correctNormalCount ? current.impostor.uid : wrongTarget.uid,
    });
  }
  current.impostor.send({ t: "SUBMIT_VOTE", targetUid: current.normals[0].uid });

  await waitForAll([host, ...players], (client) => client.phase() === "RESULT", `${label} result`);
  for (const client of [host, ...players]) assertNoInternals(client, `${client.label} ${label}`);
}

async function nextChallenge(host, players, expectedIndex) {
  await waitForAll(
    [host, ...players],
    (client) => client.phase() === "QUESTION" && client.view?.challenge?.index === expectedIndex,
    `Challenge ${expectedIndex} automatic QUESTION`,
    10_000,
  );
}

async function main() {
  console.log("Connecting four-player competitive scoring E2E…");
  const host = new Client("HOST-SCORING");
  const players = [new Client("سلمان"), new Client("ناصر"), new Client("فيصل"), new Client("خالد")];
  await Promise.all([host.ready, ...players.map((player) => player.ready)]);

  host.send({ t: "CREATE_ROOM" });
  await waitFor(host, (client) => client.phase() === "LOBBY", "scoring lobby");
  const code = host.view.room.code;
  for (const player of players) player.send({ t: "JOIN_ROOM", code, name: player.label });
  await waitFor(host, (client) => client.view?.players?.length === 4, "four players joined");

  host.send({ t: "SET_SETTINGS", selectedModes: ["HANDS", "POINT", "NUMBER"] });
  await waitFor(host, (client) => client.view?.room?.selectedModes?.length === 3, "mode settings");
  host.send({ t: "START_GAME" });
  await waitForAll([host, ...players], (client) => client.phase() === "QUESTION", "Challenge 1 QUESTION");
  ok(host.view?.room?.playStyle === "INDIVIDUAL", "one competitive ruleset is active");
  ok(host.view?.challenge?.max === 3, "four-player stint allows three Challenges");

  let current = await physical(host, players, "C1");
  const impostorUid = current.impostor.uid;
  const normalUids = current.normals.map((normal) => normal.uid);
  await vote(host, players, current, 1, "C1");
  ok(host.view?.result?.groupFound === false, "one correct vote is below majority in C1");
  ok(host.view?.result?.roundComplete === false, "stint continues after C1");
  ok(host.view?.scoreboard === undefined, "C1 keeps all scoring hidden");
  ok(host.view?.result?.voteTally === undefined, "C1 keeps aggregate distribution hidden");

  await nextChallenge(host, players, 2);
  current = await physical(host, players, "C2");
  ok(current.impostor.uid === impostorUid, "same impostor remains in C2");
  ok(current.normals.map((normal) => normal.uid).join(",") === normalUids.join(","), "normal roster remains stable in stint");
  await vote(host, players, current, 2, "C2");
  ok(host.view?.result?.groupFound === false, "two correct votes are still below four-player majority");
  ok(host.view?.result?.roundComplete === false, "stint continues after C2");
  ok(host.view?.scoreboard === undefined, "C2 still hides scoring");

  await nextChallenge(host, players, 3);
  current = await physical(host, players, "C3");
  ok(current.impostor.uid === impostorUid, "same impostor remains through C3");
  await vote(host, players, current, 3, "C3");

  ok(host.view?.result?.groupFound === true, "three correct normals catch the impostor in C3");
  ok(host.view?.result?.roundComplete === true, "C3 catch completes the stint");
  ok(host.view?.result?.voteTally?.length === 4, "stint-end aggregate tally lists all four participants");
  ok(Array.isArray(host.view?.scoreboard) && host.view.scoreboard.length === 4, "stint end exposes scoreboard");

  const byUid = new Map(host.view.scoreboard.map((row) => [row.uid, row]));
  ok(byUid.get(normalUids[0])?.roundDelta === 3, "normal correct continuously from C1 gets +3");
  ok(byUid.get(normalUids[1])?.roundDelta === 2, "normal whose streak begins in C2 gets +2");
  ok(byUid.get(normalUids[2])?.roundDelta === 1, "normal whose streak begins in C3 gets +1");
  ok(byUid.get(impostorUid)?.roundDelta === 2, "impostor gets +2 for surviving C1 and C2");

  for (const client of [host, ...players]) {
    assertNoInternals(client, `${client.label} final stint result`);
    ok(!client.rawText().includes("promptId"), `${client.label}: promptId never appears on wire`);
  }

  host.send({ t: "CLOSE_ROOM" });
  await sleep(150);
  for (const client of [host, ...players]) client.close();

  console.log(`\n${failures === 0 ? "4P SCORING E2E ALL PASSED ✅" : `${failures} 4P SCORING E2E FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("4P SCORING E2E FATAL", error);
  process.exit(1);
});