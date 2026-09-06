/**
 * Real WebSocket E2E for the one competitive «خلك طبيعي» ruleset.
 *
 * Host + three player phones run through the production timers, secrecy boundary,
 * two-Challenge three-player impostor stint, score reveal, repeated weighted role
 * selection and the nine-base-Challenge GAME_OVER condition.
 */
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
  constructor(label, cookie = null) {
    this.label = label;
    this.cookie = cookie;
    this.uid = null;
    this.view = null;
    this.messages = [];
    this.ws = null;
    this.ready = this.connect(cookie);
  }

  async connect(cookie = null) {
    let sessionCookie = cookie;
    if (!sessionCookie) {
      const response = await fetch(`${ORIGIN}/api/session`);
      if (!response.ok) throw new Error(`${this.label}: session bootstrap failed`);
      sessionCookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
    }
    if (!sessionCookie) throw new Error(`${this.label}: session cookie missing`);
    this.cookie = sessionCookie;

    this.ws = new WebSocket(URL, { headers: { Cookie: sessionCookie, Origin: ORIGIN } });
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

  async reconnect() {
    const oldUid = this.uid;
    this.ws?.close();
    await sleep(120);
    this.view = null;
    this.messages = [];
    await this.connect(this.cookie);
    ok(this.uid === oldUid, `${this.label} reconnect keeps the same uid`);
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
  ok(impostors.length === 1, "exactly one player is privately marked as the impostor");
  ok(normals.length === 2, "the other two players are privately normal");
  return { impostor: impostors[0], normals };
}

function assertNoMapping(client, label) {
  const raw = client.rawText();
  ok(!raw.includes("voterUid"), `${label}: no voterUid`);
  ok(!raw.includes("voterName"), `${label}: no voterName`);
  ok(!raw.includes("targetUid"), `${label}: no voter-to-target mapping`);
  ok(!raw.includes("voteBreakdown"), `${label}: no voteBreakdown`);
  ok(!raw.includes("correctVoteStreakStart"), `${label}: no hidden score streak state`);
  ok(!raw.includes("pendingRoundScores"), `${label}: no pending score state`);
}

function assertQuestionSecrecy(host, impostor, normals) {
  const prompt = normals[0].view?.myPrompt?.text;
  ok(typeof prompt === "string" && prompt.length > 0, "normal receives a private prompt");
  ok(normals.every((normal) => normal.view?.myPrompt?.text === prompt), "normals share the current prompt");
  ok(impostor.view?.myPrompt === undefined, "impostor receives no private prompt");
  ok(host.view?.myPrompt === undefined, "Host receives no private prompt");
  ok(host.view?.publicPrompt === undefined, "prompt is not public in QUESTION");
  ok(!impostor.rawText().includes(prompt), "impostor raw wire contains no secret prompt text");
  ok(!impostor.rawText().includes("promptId"), "impostor raw wire contains no promptId");
  ok(!host.rawText().includes(prompt), "Host raw wire contains no secret prompt text");
  return prompt;
}

async function physical(host, players, label, reconnect = null) {
  const current = roles(players);
  const prompt = assertQuestionSecrecy(host, current.impostor, current.normals);
  const mode = host.view?.challenge?.mode;
  ok(current.normals.every((normal) => normal.view?.myPrompt?.mode === mode), `${label}: private prompt mode matches Challenge`);

  for (const player of players) player.send({ t: "MARK_READY" });
  await waitFor(host, (client) => client.phase() === "COUNTDOWN", `${label} countdown`);
  ok(host.view?.publicPrompt === undefined, `${label}: prompt stays secret in countdown`);

  if (reconnect) {
    await reconnect.reconnect();
    await waitFor(reconnect, (client) => client.phase() === "COUNTDOWN", `${label} reconnect countdown`);
    if (reconnect.uid === current.impostor.uid) {
      ok(reconnect.view?.myPrompt === undefined, `${label}: reconnected impostor still has no prompt`);
    } else {
      ok(reconnect.view?.myPrompt?.text === prompt, `${label}: reconnected normal restores private prompt`);
    }
  }

  await waitFor(host, (client) => client.phase() === "ACTION", `${label} action`, 8_000);
  ok(host.view?.publicPrompt === undefined, `${label}: prompt stays secret at ACTION`);
  await waitFor(host, (client) => client.phase() === "HOLD", `${label} hold`, 4_000);
  ok(host.view?.publicPrompt === undefined, `${label}: prompt stays secret during HOLD`);
  await waitFor(host, (client) => client.phase() === "PROMPT_REVEAL", `${label} reveal`, 5_000);
  ok(host.view?.publicPrompt?.text === prompt, `${label}: prompt becomes public after HOLD`);
  await waitFor(host, (client) => client.phase() === "DISCUSSION", `${label} discussion`, 6_000);
  await waitForAll(players, (client) => client.phase() === "DISCUSSION", `${label} player discussion`);
  return current;
}

async function startVoting(host, players, label) {
  host.send({ t: "START_VOTING" });
  await waitForAll([host, ...players], (client) => client.phase() === "VOTING", `${label} voting`);
  ok(host.view?.votesProgress?.requiredVotes === 2, `${label}: three players require two votes to catch`);
  ok(host.view?.liveVoteTally === undefined, `${label}: Host receives no live target tally`);
  for (const player of players) ok(player.view?.liveVoteTally === undefined, `${label}: player receives no live target tally`);
}

async function submitAndWait(host, voter, targetUid, expectedSubmitted, label) {
  voter.send({ t: "SUBMIT_VOTE", targetUid });
  await waitFor(
    host,
    (client) => client.phase() === "VOTING" && client.view?.votesProgress?.submitted === expectedSubmitted,
    `${label} vote ${expectedSubmitted}`,
  );
  ok(host.view?.liveVoteTally === undefined, `${label}: target totals remain hidden after vote ${expectedSubmitted}`);
}

async function surviveFirstChallenge(host, players, current, label) {
  await startVoting(host, players, label);
  const [firstNormal, secondNormal] = current.normals;
  await submitAndWait(host, firstNormal, current.impostor.uid, 1, label);
  await submitAndWait(host, secondNormal, firstNormal.uid, 2, label);
  current.impostor.send({ t: "SUBMIT_VOTE", targetUid: secondNormal.uid });
  await waitForAll([host, ...players], (client) => client.phase() === "RESULT", `${label} result`);

  ok(host.view?.result?.groupFound === false, `${label}: one correct normal is below majority`);
  ok(host.view?.result?.roundComplete === false, `${label}: impostor stint continues`);
  ok(host.view?.result?.impostorUid === undefined, `${label}: intermediate result hides impostor identity`);
  ok(host.view?.result?.voteTally?.length === 0, `${label}: intermediate result hides vote distribution`);
  ok(host.view?.scoreboard === undefined, `${label}: intermediate result hides scoreboard`);
  for (const client of [host, ...players]) assertNoMapping(client, `${client.label} ${label}`);
}

async function catchCurrent(host, players, current, label) {
  await startVoting(host, players, label);
  const [firstNormal, secondNormal] = current.normals;
  await submitAndWait(host, firstNormal, current.impostor.uid, 1, label);
  await submitAndWait(host, secondNormal, current.impostor.uid, 2, label);
  current.impostor.send({ t: "SUBMIT_VOTE", targetUid: firstNormal.uid });
  await waitForAll([host, ...players], (client) => client.phase() === "RESULT", `${label} result`);

  ok(host.view?.result?.groupFound === true, `${label}: majority catches impostor`);
  ok(host.view?.result?.roundComplete === true, `${label}: catch ends impostor stint`);
  ok(Array.isArray(host.view?.scoreboard), `${label}: completed stint reveals scoreboard`);
  ok(host.view?.result?.voteTally?.length === 3, `${label}: stint-end aggregate includes all participants`);
  for (const client of [host, ...players]) assertNoMapping(client, `${client.label} ${label}`);
}

async function nextQuestion(host, players, expectedCompleted) {
  host.send({ t: "NEXT_ROUND" });
  await waitForAll(
    [host, ...players],
    (client) => client.phase() === "QUESTION" && client.view?.room?.completedChallenges === expectedCompleted,
    `next QUESTION after ${expectedCompleted} completed Challenges`,
  );
}

async function main() {
  console.log("Connecting competitive E2E host + 3 players…");
  const host = new Client("HOST");
  const players = [new Client("سلمان"), new Client("ناصر"), new Client("فيصل")];
  await Promise.all([host.ready, ...players.map((player) => player.ready)]);

  host.send({ t: "CREATE_ROOM" });
  await waitFor(host, (client) => client.phase() === "LOBBY", "host lobby");
  const code = host.view.room.code;
  for (const player of players) player.send({ t: "JOIN_ROOM", code, name: player.label });
  await waitFor(host, (client) => client.view?.players?.length === 3, "three joined players");

  host.send({ t: "SET_SETTINGS", selectedModes: ["HANDS", "POINT", "NUMBER"] });
  await waitFor(host, (client) => client.view?.room?.selectedModes?.length === 3, "mode settings");
  host.send({ t: "START_GAME" });
  await waitForAll([host, ...players], (client) => client.phase() === "QUESTION", "first QUESTION");

  ok(host.view?.room?.playStyle === "INDIVIDUAL", "single product ruleset is competitive scoring");
  ok(host.view?.room?.targetChallenges === 9, "match advertises nine base Challenges");
  ok(host.view?.challenge?.max === 2, "three-player impostor stint has two-Challenge maximum");

  console.log("\n[first stint] C1 survival then C2 catch tests 2/1 scoring + survival point:");
  let current = await physical(host, players, "C1", players[0]);
  const firstImpostorUid = current.impostor.uid;
  await surviveFirstChallenge(host, players, current, "C1");
  ok(host.view?.room?.completedChallenges === 1, "C1 increments completed Challenge count");

  await nextQuestion(host, players, 1);
  ok(host.view?.challenge?.index === 2, "same stint advances to Challenge 2");
  current = await physical(host, players, "C2");
  ok(current.impostor.uid === firstImpostorUid, "same impostor stays for the second three-player Challenge");
  await catchCurrent(host, players, current, "C2");

  const firstStintScores = host.view.scoreboard;
  const early = firstStintScores?.find((row) => row.uid === current.normals[0].uid);
  const late = firstStintScores?.find((row) => row.uid === current.normals[1].uid);
  const hidden = firstStintScores?.find((row) => row.uid === current.impostor.uid);
  ok(early?.roundDelta === 2, "normal correct continuously from C1 gets +2");
  ok(late?.roundDelta === 1, "normal whose correct streak begins in C2 gets +1");
  ok(hidden?.roundDelta === 1, "impostor gets +1 for surviving C1 before being caught");

  let completed = 2;
  while (completed < 9) {
    await nextQuestion(host, players, completed);
    current = await physical(host, players, `base C${completed + 1}`);
    await catchCurrent(host, players, current, `base C${completed + 1}`);
    completed += 1;
    ok(host.view?.room?.completedChallenges === completed, `completed Challenge count reaches ${completed}`);
  }

  host.send({ t: "NEXT_ROUND" });
  await waitForAll([host, ...players], (client) => client.phase() === "GAME_OVER", "GAME_OVER after base Challenge 9");
  ok(host.view?.gameOver?.targetChallenges === 9, "GAME_OVER keeps nine-Challenge target");
  ok(host.view?.gameOver?.completedChallenges === 9, "GAME_OVER reports nine completed Challenges");
  ok(Array.isArray(host.view?.scoreboard) && host.view.scoreboard.length === 3, "GAME_OVER exposes final ranking");
  ok(host.view.scoreboard.every((row) => Number.isInteger(row.rank) && row.rank >= 1), "final ranking has numeric ranks");
  for (const client of [host, ...players]) {
    assertNoMapping(client, `${client.label} GAME_OVER`);
    ok(!client.rawText().includes("promptId"), `${client.label}: promptId never appears on wire`);
  }

  host.send({ t: "CLOSE_ROOM" });
  await sleep(150);
  for (const client of [host, ...players]) client.close();

  console.log(`\n${failures === 0 ? "COMPETITIVE E2E ALL PASSED ✅" : `${failures} COMPETITIVE E2E FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("COMPETITIVE E2E FATAL", error);
  process.exit(1);
});
