/**
 * End-to-end multi-client test over real WebSockets against a running server.
 *
 * Drives one shared host screen plus three player phones through the current
 * HANDS / POINT / NUMBER imitation flow and inspects raw wire messages for
 * secret-data leaks.
 *
 * Run from the repository root while the server is listening on :8080:
 *   node server/test/integration.mjs
 */
import { WebSocket } from "ws";

const URL = process.env.URL ?? "ws://localhost:8080/ws";
const ORIGIN = process.env.ORIGIN ?? URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const TIMEOUT_MS = 10_000;

let failures = 0;

function ok(condition, message) {
  if (condition) {
    console.log("  ✓", message);
    return;
  }

  failures += 1;
  console.error("  ✗", message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    this.ws = new WebSocket(URL, {
      headers: { Cookie: sessionCookie, Origin: ORIGIN },
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${this.label}: websocket authentication timed out`)),
        TIMEOUT_MS,
      );

      this.ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      this.ws.on("open", () => this.send({ t: "HELLO" }));
      this.ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        this.messages.push(message);

        if (message.t === "HELLO_OK") {
          this.uid = message.uid;
          clearTimeout(timer);
          resolve();
        }

        if (message.t === "STATE") {
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
    const cookie = this.cookie;
    const uid = this.uid;
    this.ws?.close();
    await sleep(120);
    this.view = null;
    this.messages = [];
    await this.connect(cookie);
    ok(this.uid === uid, `${this.label} reconnect keeps the same uid`);
  }

  close() {
    this.ws?.close();
  }
}

async function waitFor(client, predicate, label, timeout = TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (predicate(client)) return;
    await sleep(40);
  }

  throw new Error(`timeout waiting for ${label}; ${client.label} phase=${client.phase()}`);
}

function currentRoles(players) {
  const impostors = players.filter((player) => player.view?.isImpostor === true);
  const normals = players.filter((player) => player.view?.isImpostor === false);
  ok(impostors.length === 1, "exactly one player is marked as the impostor privately");
  ok(normals.length === 2, "the other two players are marked as normal privately");
  return { impostor: impostors[0], normals };
}

function currentPrompt(normals) {
  const prompts = normals.map((player) => player.view?.myPrompt?.text);
  ok(prompts.every((prompt) => typeof prompt === "string" && prompt.length > 0), "normal players receive a prompt");
  ok(new Set(prompts).size === 1, "normal players receive the same current prompt");
  return prompts[0];
}

function assertPrivateQuestionWire(host, impostor, normals, prompt) {
  ok(host.view?.myPrompt === undefined, "host never receives a private prompt");
  ok(impostor.view?.isImpostor === true, "impostor knows they are the impostor");
  ok(impostor.view?.myPrompt === undefined, "impostor receives no prompt");
  ok(!impostor.rawText().includes(prompt), "raw impostor wire never contains the secret prompt text");
  ok(!impostor.rawText().includes("promptId"), "raw impostor wire never contains promptId");
  ok(!host.rawText().includes(prompt), "raw host wire never contains the private prompt text");

  for (const normal of normals) {
    ok(normal.view?.myPrompt?.text === prompt, `${normal.label} has the expected private prompt`);
    ok(!normal.rawText().includes("promptId"), `${normal.label} wire does not expose promptId`);
  }
}

async function markReadyAndReachDiscussion(host, players, challengeIndex) {
  for (const player of players) player.send({ t: "MARK_READY" });

  await waitFor(host, (client) => client.phase() === "REVEAL", `challenge ${challengeIndex} countdown`);
  ok(typeof host.view?.room?.phaseEndsAt === "number", `challenge ${challengeIndex} exposes an authoritative countdown deadline`);

  await waitFor(host, (client) => client.phase() === "DISCUSSION", `challenge ${challengeIndex} discussion`);
  ok(host.view?.room?.phaseEndsAt === undefined, `challenge ${challengeIndex} clears the countdown deadline in discussion`);
}

function submitThreeWayTie(players) {
  const [a, b, c] = players;
  a.send({ t: "SUBMIT_VOTE", targetUid: b.uid });
  b.send({ t: "SUBMIT_VOTE", targetUid: c.uid });
  c.send({ t: "SUBMIT_VOTE", targetUid: a.uid });
}

async function surviveChallenge(host, players, challengeIndex) {
  host.send({ t: "START_VOTING" });
  await waitFor(players[0], (client) => client.phase() === "VOTING", `challenge ${challengeIndex} voting`);

  players[0].send({ t: "SUBMIT_VOTE", targetUid: players[1].uid });
  await waitFor(host, (client) => (client.view?.votesProgress?.submitted ?? 0) >= 1, `challenge ${challengeIndex} vote progress`);
  ok(host.view?.result === undefined, `challenge ${challengeIndex} does not expose a result mid-vote`);
  ok(!players[2].rawText().includes("voteTally"), `challenge ${challengeIndex} does not leak a tally mid-vote`);

  players[1].send({ t: "SUBMIT_VOTE", targetUid: players[2].uid });
  players[2].send({ t: "SUBMIT_VOTE", targetUid: players[0].uid });
  await waitFor(host, (client) => client.phase() === "RESULT", `challenge ${challengeIndex} result`);
}

async function main() {
  console.log("Connecting host + 3 players…");
  const host = new Client("HOST");
  const players = [new Client("سلمان"), new Client("ناصر"), new Client("فيصل")];
  await Promise.all([host.ready, ...players.map((player) => player.ready)]);

  console.log("\n[setup] create room + join players:");
  host.send({ t: "CREATE_ROOM" });
  await waitFor(host, (client) => client.phase() === "LOBBY", "host lobby");
  const code = host.view.room.code;
  ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(code), `room code is valid: ${code}`);

  for (const player of players) {
    player.send({ t: "JOIN_ROOM", code, name: player.label });
  }
  await waitFor(host, (client) => client.view?.players?.length === 3, "three joined players");
  ok(true, "host sees all three players in real time");

  host.send({
    t: "SET_SETTINGS",
    totalRounds: 3,
    selectedModes: ["HANDS", "POINT", "NUMBER"],
  });
  await waitFor(
    host,
    (client) =>
      client.view?.room?.totalRounds === 3 &&
      client.view?.room?.selectedModes?.length === 3,
    "new gameplay settings",
  );
  ok(
    host.view.room.selectedModes.join(",") === "HANDS,POINT,NUMBER",
    "selectedModes are authoritative on the room",
  );

  host.send({ t: "START_GAME" });
  await waitFor(host, (client) => client.phase() === "QUESTION", "challenge 1 private prompt phase");
  await Promise.all(players.map((player) => waitFor(player, (client) => client.phase() === "QUESTION", `${player.label} challenge 1 prompt`)));

  console.log("\n[challenge 1] private prompt + reconnect + survived result:");
  let { impostor, normals } = currentRoles(players);
  const impostorUid = impostor.uid;
  const firstPrompt = currentPrompt(normals);
  assertPrivateQuestionWire(host, impostor, normals, firstPrompt);

  const normalToReconnect = normals[0];
  await normalToReconnect.reconnect();
  await waitFor(normalToReconnect, (client) => client.phase() === "QUESTION", "normal private view after reconnect");
  ok(normalToReconnect.view?.myPrompt?.text === firstPrompt, "normal reconnect restores the exact private prompt");

  await impostor.reconnect();
  await waitFor(impostor, (client) => client.phase() === "QUESTION", "impostor private view after reconnect");
  ok(impostor.view?.isImpostor === true, "impostor reconnect restores their private role");
  ok(impostor.view?.myPrompt === undefined, "impostor reconnect still receives no prompt");
  ok(!impostor.rawText().includes(firstPrompt), "reconnected impostor wire still contains no prompt text");
  ok(!impostor.rawText().includes("promptId"), "reconnected impostor wire still contains no promptId");

  await markReadyAndReachDiscussion(host, players, 1);
  await surviveChallenge(host, players, 1);

  const challengeOneResult = host.view.result;
  ok(challengeOneResult?.roundComplete === false, "challenge 1 survival keeps the round open");
  ok(challengeOneResult?.impostorUid === undefined, "challenge 1 result hides impostor uid");
  ok(challengeOneResult?.impostorName === undefined, "challenge 1 result hides impostor name");
  ok(challengeOneResult?.prompt === undefined, "challenge 1 result hides the previous prompt");
  ok(challengeOneResult?.voteTally?.length === 0, "challenge 1 result hides vote tally");
  ok(challengeOneResult?.voteBreakdown?.length === 0, "challenge 1 result hides vote details");
  ok(challengeOneResult?.roundScores?.length === 0, "challenge 1 result hides score deltas");

  host.send({ t: "NEXT_ROUND" });
  await waitFor(host, (client) => client.phase() === "QUESTION" && client.view?.challenge?.index === 2, "challenge 2 question phase");
  await Promise.all(players.map((player) => waitFor(player, (client) => client.phase() === "QUESTION" && client.view?.challenge?.index === 2, `${player.label} challenge 2 prompt`)));

  console.log("\n[challenge 2] same impostor + new prompt:");
  players.forEach((player) => player.clearMessages());
  host.clearMessages();
  ({ impostor, normals } = currentRoles(players));
  const secondPrompt = currentPrompt(normals);
  ok(impostor.uid === impostorUid, "the same impostor continues into challenge 2");
  ok(secondPrompt !== firstPrompt, "challenge 2 receives a new prompt");
  assertPrivateQuestionWire(host, impostor, normals, secondPrompt);

  await markReadyAndReachDiscussion(host, players, 2);
  await surviveChallenge(host, players, 2);
  ok(host.view.result?.roundComplete === false, "challenge 2 survival still keeps the round open");
  ok(host.view.result?.impostorUid === undefined, "challenge 2 still hides impostor identity");
  ok(host.view.result?.voteTally?.length === 0, "challenge 2 still hides vote tally");

  host.send({ t: "NEXT_ROUND" });
  await waitFor(host, (client) => client.phase() === "QUESTION" && client.view?.challenge?.index === 3, "challenge 3 question phase");
  await Promise.all(players.map((player) => waitFor(player, (client) => client.phase() === "QUESTION" && client.view?.challenge?.index === 3, `${player.label} challenge 3 prompt`)));

  console.log("\n[challenge 3] survival completes round and awards +2:");
  players.forEach((player) => player.clearMessages());
  host.clearMessages();
  ({ impostor, normals } = currentRoles(players));
  const thirdPrompt = currentPrompt(normals);
  ok(impostor.uid === impostorUid, "the same impostor continues into challenge 3");
  ok(thirdPrompt !== secondPrompt, "challenge 3 receives another new prompt");
  assertPrivateQuestionWire(host, impostor, normals, thirdPrompt);

  await markReadyAndReachDiscussion(host, players, 3);
  await surviveChallenge(host, players, 3);

  const finalResult = host.view.result;
  ok(finalResult?.roundComplete === true, "surviving challenge 3 completes the round");
  ok(finalResult?.groupFound === false, "challenge 3 tie records an impostor survival");
  ok(finalResult?.impostorUid === impostorUid, "completed round reveals the impostor");
  ok(finalResult?.prompt === thirdPrompt, "completed round reveals the final challenge prompt");
  ok((finalResult?.voteTally?.length ?? 0) > 0, "completed round reveals vote tally");
  ok((finalResult?.voteBreakdown?.length ?? 0) === 3, "completed round reveals vote details");

  const impostorScore = host.view.scoreboard?.find((row) => row.uid === impostorUid)?.score;
  ok(impostorScore === 2, "impostor receives +2 only after surviving challenge 3");

  console.log("\n[cleanup]:");
  host.send({ t: "CLOSE_ROOM" });
  await sleep(200);
  ok(true, "room closed cleanly");

  for (const client of [host, ...players]) client.close();

  console.log(`\n${failures === 0 ? "ALL PASSED ✅" : `${failures} FAILED ❌`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exit(1);
});
