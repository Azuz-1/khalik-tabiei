/**
 * End-to-end multi-client test over real WebSockets against a running server.
 *
 * Drives one shared host screen plus three player phones through the current
 * HANDS / POINT / NUMBER game loop and inspects raw server->client frames for
 * secret-data and vote-identity leaks.
 *
 * Run from the repository root while the server is listening on :8080:
 *   npm run test:integration
 */
import { WebSocket } from "ws";

const URL = process.env.URL ?? "ws://localhost:8080/ws";
const ORIGIN = process.env.ORIGIN ?? URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const TIMEOUT_MS = 15_000;

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

async function waitForAll(clients, predicate, label) {
  await Promise.all(
    clients.map((client) => waitFor(client, predicate, `${client.label} ${label}`)),
  );
}

function currentRoles(players) {
  const impostors = players.filter((player) => player.view?.isImpostor === true);
  const normals = players.filter((player) => player.view?.isImpostor === false);
  ok(impostors.length === 1, "exactly one player is marked as the impostor privately");
  ok(normals.length === 2, "the other two players are marked as normal privately");
  return { impostor: impostors[0], normals };
}

function currentPrompt(normals, expectedMode) {
  const prompts = normals.map((player) => player.view?.myPrompt?.text);
  ok(
    prompts.every((prompt) => typeof prompt === "string" && prompt.length > 0),
    "normal players receive a private prompt",
  );
  ok(new Set(prompts).size === 1, "normal players receive the same current prompt");
  ok(
    normals.every((player) => player.view?.myPrompt?.mode === expectedMode),
    "normal private prompt is tagged with the current Challenge mode",
  );
  return prompts[0];
}

function assertNoVoterMappingWire(client, label) {
  const raw = client.rawText();
  ok(!raw.includes("voterUid"), `${label} wire contains no voterUid field`);
  ok(!raw.includes("voterName"), `${label} wire contains no voterName field`);
  ok(!raw.includes("targetUid"), `${label} wire contains no voter-to-target field`);
  ok(!raw.includes("voteBreakdown"), `${label} wire contains no voteBreakdown`);
  ok(!raw.includes("voterTarget"), `${label} wire contains no voterTarget field`);
}

function assertSecretWire(host, impostor, normals, prompt) {
  ok(host.view?.myPrompt === undefined, "host receives no private prompt");
  ok(host.view?.publicPrompt === undefined, "host receives no public prompt before reveal");
  ok(impostor.view?.isImpostor === true, "impostor knows they are the impostor");
  ok(impostor.view?.myPrompt === undefined, "impostor receives no private prompt");
  ok(impostor.view?.publicPrompt === undefined, "impostor receives no public prompt before reveal");
  ok(!impostor.rawText().includes(prompt), "raw impostor wire contains no secret prompt text");
  ok(!impostor.rawText().includes("promptId"), "raw impostor wire contains no promptId");
  ok(!host.rawText().includes(prompt), "raw host wire contains no secret prompt text");

  for (const normal of normals) {
    ok(normal.view?.myPrompt?.text === prompt, `${normal.label} has the expected private prompt`);
    ok(!normal.rawText().includes("promptId"), `${normal.label} wire does not expose promptId`);
  }
}

async function runPhysicalSequence(host, players, challengeIndex, prompt, reconnectRoles = null) {
  for (const player of players) player.send({ t: "MARK_READY" });

  await waitFor(host, (client) => client.phase() === "COUNTDOWN", `challenge ${challengeIndex} countdown`);
  const countdownSeenAt = Date.now();
  const countdownRemaining = (host.view?.room?.phaseEndsAt ?? countdownSeenAt) - countdownSeenAt;
  ok(
    countdownRemaining >= 4_500 && countdownRemaining <= 5_200,
    `challenge ${challengeIndex} authoritative countdown is approximately 5 seconds`,
  );
  ok(host.view?.publicPrompt === undefined, `challenge ${challengeIndex} prompt is still secret during countdown`);

  if (reconnectRoles) {
    await reconnectRoles.normal.reconnect();
    await waitFor(
      reconnectRoles.normal,
      (client) => client.phase() === "COUNTDOWN",
      "normal reconnect during countdown",
    );
    ok(
      reconnectRoles.normal.view?.myPrompt?.text === prompt,
      "normal reconnect before ACTION restores the current private prompt",
    );

    await reconnectRoles.impostor.reconnect();
    await waitFor(
      reconnectRoles.impostor,
      (client) => client.phase() === "COUNTDOWN",
      "impostor reconnect during countdown",
    );
    ok(
      reconnectRoles.impostor.view?.isImpostor === true,
      "impostor reconnect before ACTION restores the role marker",
    );
    ok(
      reconnectRoles.impostor.view?.myPrompt === undefined,
      "impostor reconnect before ACTION still has no prompt",
    );
    ok(
      !reconnectRoles.impostor.rawText().includes(prompt),
      "reconnected impostor raw wire still has no secret prompt",
    );
    ok(
      !reconnectRoles.impostor.rawText().includes("promptId"),
      "reconnected impostor raw wire still has no promptId",
    );
  }

  await waitFor(host, (client) => client.phase() === "ACTION", `challenge ${challengeIndex} ACTION`, 8_000);
  const countdownElapsed = Date.now() - countdownSeenAt;
  ok(
    countdownElapsed >= 4_500,
    `challenge ${challengeIndex} does not leave the 5-second countdown early`,
  );
  ok(host.view?.publicPrompt === undefined, `challenge ${challengeIndex} prompt is still secret at ACTION`);

  await waitFor(host, (client) => client.phase() === "HOLD", `challenge ${challengeIndex} HOLD`, 4_000);
  const holdSeenAt = Date.now();
  ok(host.view?.publicPrompt === undefined, `challenge ${challengeIndex} prompt is still secret during HOLD`);

  await waitFor(
    host,
    (client) => client.phase() === "PROMPT_REVEAL",
    `challenge ${challengeIndex} prompt reveal`,
    5_000,
  );
  const holdElapsed = Date.now() - holdSeenAt;
  ok(holdElapsed >= 1_700, `challenge ${challengeIndex} HOLD lasts about two seconds`);
  ok(host.view?.publicPrompt?.text === prompt, `challenge ${challengeIndex} prompt becomes public after HOLD`);

  await waitForAll(
    players,
    (client) => client.phase() === "PROMPT_REVEAL",
    `challenge ${challengeIndex} prompt reveal`,
  );
  for (const player of players) {
    ok(
      player.view?.publicPrompt?.text === prompt,
      `${player.label} receives the now-public prompt after the action`,
    );
    ok(!player.rawText().includes("promptId"), `${player.label} never receives promptId`);
  }

  await waitFor(host, (client) => client.phase() === "DISCUSSION", `challenge ${challengeIndex} discussion`, 6_000);
  ok(host.view?.room?.phaseEndsAt === undefined, `challenge ${challengeIndex} discussion has no timer`);
  ok(host.view?.publicPrompt?.text === prompt, `challenge ${challengeIndex} public prompt remains available in discussion`);
}

function tallySum(view) {
  return view?.liveVoteTally?.reduce((sum, row) => sum + row.votes, 0) ?? -1;
}

async function voteNoMajority(host, players, challengeIndex, inspectLive = false) {
  host.send({ t: "START_VOTING" });
  await waitFor(host, (client) => client.phase() === "VOTING", `challenge ${challengeIndex} host voting`);
  await waitForAll(players, (client) => client.phase() === "VOTING", `challenge ${challengeIndex} voting`);
  ok(players[0].view?.votesProgress?.requiredVotes === 2, "3 players require a 2-vote majority");

  const stableOrder = players.map((player) => player.uid);
  if (inspectLive) {
    ok(host.view?.liveVoteTally?.length === 3, "host live tally includes all players before any vote");
    ok(tallySum(host.view) === 0, "host live tally starts at zero");
    ok(
      host.view?.liveVoteTally?.map((row) => row.uid).join(",") === stableOrder.join(","),
      "host live voting cards start in stable participant order",
    );
  }

  const [a, b, c] = players;
  a.send({ t: "SUBMIT_VOTE", targetUid: b.uid });
  await waitFor(host, (client) => client.phase() === "VOTING" && client.view?.votesProgress?.submitted === 1, "host live tally after vote 1");
  if (inspectLive) {
    ok(tallySum(host.view) === 1, "host live tally sum is 1 after the first vote");
    ok(host.view?.liveVoteTally?.find((row) => row.uid === b.uid)?.votes === 1, "first vote increments only its aggregate target counter");
    ok(host.view?.liveVoteTally?.some((row) => row.votes === 0), "host live tally keeps zero-vote players visible");
    ok(
      host.view?.liveVoteTally?.map((row) => row.uid).join(",") === stableOrder.join(","),
      "host player card order is unchanged after the first vote",
    );
    assertNoVoterMappingWire(host, "host live voting");
    await waitFor(a, (client) => client.view?.myVoteSubmitted === true, "first player vote acknowledgement");
    ok(a.view?.myVoteSubmitted === true, "player phone clearly records submitted vote");
    for (const player of players) {
      ok(player.view?.liveVoteTally === undefined, `${player.label} phone does not receive live tally`);
      assertNoVoterMappingWire(player, `${player.label} voting`);
    }
  }

  b.send({ t: "SUBMIT_VOTE", targetUid: c.uid });
  await waitFor(host, (client) => client.phase() === "VOTING" && client.view?.votesProgress?.submitted === 2, "host live tally after vote 2");
  if (inspectLive) {
    ok(tallySum(host.view) === 2, "host live tally sum is 2 after the second vote");
    ok(
      host.view?.liveVoteTally?.map((row) => row.uid).join(",") === stableOrder.join(","),
      "host player card order remains stable after the second vote",
    );
    assertNoVoterMappingWire(host, "host after second vote");
  }

  c.send({ t: "SUBMIT_VOTE", targetUid: a.uid });
  await waitFor(host, (client) => client.phase() === "RESULT", `challenge ${challengeIndex} result`);
}

async function voteCatch(host, players, challengeIndex, impostor) {
  host.send({ t: "START_VOTING" });
  await waitFor(host, (client) => client.phase() === "VOTING", `challenge ${challengeIndex} host voting`);
  await waitForAll(players, (client) => client.phase() === "VOTING", `challenge ${challengeIndex} voting`);

  const normals = players.filter((player) => player.uid !== impostor.uid);
  normals[0].send({ t: "SUBMIT_VOTE", targetUid: impostor.uid });
  await waitFor(host, (client) => client.phase() === "VOTING" && client.view?.votesProgress?.submitted === 1, "catch vote 1");
  normals[1].send({ t: "SUBMIT_VOTE", targetUid: impostor.uid });
  await waitFor(host, (client) => client.phase() === "VOTING" && client.view?.votesProgress?.submitted === 2, "catch vote 2");
  impostor.send({ t: "SUBMIT_VOTE", targetUid: normals[0].uid });

  await waitFor(host, (client) => client.phase() === "RESULT", `challenge ${challengeIndex} caught result`);
}

function assertNoPointsOrVoteIdentity(view, label) {
  const json = JSON.stringify(view);
  ok(!json.includes("scoreboard"), `${label} has no scoreboard payload`);
  ok(!json.includes("roundScores"), `${label} has no round scoring payload`);
  ok(!json.includes("voteBreakdown"), `${label} has no voter breakdown payload`);
  ok(!json.includes("voterUid"), `${label} has no voter identity payload`);
  ok(!json.includes("targetUid"), `${label} has no voter-to-target payload`);
  ok(!json.includes("\"score\""), `${label} has no player score field`);
}

function assertFinalTally(result, playerCount, stableOrder) {
  ok(result?.voteTally?.length === playerCount, "round-end tally lists every participant including zero-vote players");
  ok(
    result?.voteTally?.reduce((sum, row) => sum + row.votes, 0) === playerCount,
    "round-end tally contains exactly the votes from the challenge that ended the round",
  );
  ok(
    result?.voteTally?.map((row) => row.uid).join(",") === stableOrder.join(","),
    "round-end vote board keeps stable participant order",
  );
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
    "game settings",
  );
  ok(
    host.view.room.selectedModes.join(",") === "HANDS,POINT,NUMBER",
    "selectedModes are authoritative on the room",
  );

  host.send({ t: "START_GAME" });
  await waitFor(host, (client) => client.phase() === "QUESTION", "round 1 challenge 1 private phase");
  await waitForAll(players, (client) => client.phase() === "QUESTION", "round 1 challenge 1 private phase");

  console.log("\n[round 1] same impostor + challenge-level balanced mode rotation:");
  let { impostor, normals } = currentRoles(players);
  const roundOneImpostorUid = impostor.uid;
  const roundOneModes = [];
  const roundOnePrompts = [];

  for (let challengeIndex = 1; challengeIndex <= 3; challengeIndex += 1) {
    players.forEach((player) => player.clearMessages());
    host.clearMessages();

    ({ impostor, normals } = currentRoles(players));
    const currentMode = host.view.challenge?.mode;
    const prompt = currentPrompt(normals, currentMode);
    roundOneModes.push(currentMode);
    roundOnePrompts.push(prompt);

    ok(impostor.uid === roundOneImpostorUid, `challenge ${challengeIndex} keeps the same round impostor`);
    if (challengeIndex > 1) {
      ok(
        roundOneModes[challengeIndex - 1] !== roundOneModes[challengeIndex - 2],
        `challenge ${challengeIndex} changes mode instead of immediately repeating`,
      );
    }
    assertSecretWire(host, impostor, normals, prompt);

    await runPhysicalSequence(
      host,
      players,
      challengeIndex,
      prompt,
      challengeIndex === 1 ? { normal: normals[0], impostor } : null,
    );
    await voteNoMajority(host, players, challengeIndex, challengeIndex === 1);

    const result = host.view.result;
    ok(result?.groupFound === false, `challenge ${challengeIndex} less-than-majority vote does not catch impostor`);

    if (challengeIndex < 3) {
      ok(result?.roundComplete === false, `challenge ${challengeIndex} keeps round open`);
      ok(result?.impostorUid === undefined, `challenge ${challengeIndex} hides impostor identity`);
      ok(result?.impostorName === undefined, `challenge ${challengeIndex} hides impostor name`);
      ok(result?.voteTally?.length === 0, `challenge ${challengeIndex} hides result tally`);
      assertNoPointsOrVoteIdentity(host.view, `challenge ${challengeIndex} intermediate result`);

      host.send({ t: "NEXT_ROUND" });
      await waitFor(
        host,
        (client) => client.phase() === "QUESTION" && client.view?.challenge?.index === challengeIndex + 1,
        `round 1 challenge ${challengeIndex + 1}`,
      );
      await waitForAll(
        players,
        (client) => client.phase() === "QUESTION" && client.view?.challenge?.index === challengeIndex + 1,
        `round 1 challenge ${challengeIndex + 1}`,
      );
    } else {
      ok(result?.roundComplete === true, "surviving challenge 3 ends round 1");
      ok(result?.impostorUid === roundOneImpostorUid, "round 1 end reveals impostor identity");
      assertFinalTally(result, 3, players.map((player) => player.uid));
      assertNoPointsOrVoteIdentity(host.view, "round 1 final result");
    }
  }

  ok(new Set(roundOneModes).size === 3, "first three Challenges consume all three selected modes before refill");
  ok(
    ["HANDS", "POINT", "NUMBER"].every((mode) => roundOneModes.includes(mode)),
    "round 1 Challenge modes are exactly the three selected modes",
  );
  ok(new Set(roundOnePrompts).size === 3, "round 1 challenges use three different prompts");

  host.send({ t: "NEXT_ROUND" });
  await waitFor(host, (client) => client.phase() === "QUESTION" && client.view?.room?.currentRound === 2, "round 2 start");
  await waitForAll(players, (client) => client.phase() === "QUESTION" && client.view?.room?.currentRound === 2, "round 2 start");
  ok(host.phase() !== "GAME_OVER", "ending round 1 does not end the game");

  console.log("\n[round 2] majority catch in challenge 1 ends round, not game:");
  ({ impostor, normals } = currentRoles(players));
  const roundTwoImpostorUid = impostor.uid;
  const roundTwoMode = host.view.challenge?.mode;
  const roundTwoPrompt = currentPrompt(normals, roundTwoMode);
  ok(roundTwoImpostorUid !== roundOneImpostorUid, "round 2 gets a new fair impostor");
  ok(
    roundTwoMode !== roundOneModes.at(-1),
    "refilled Challenge mode bag avoids an immediate repeat across the bag boundary",
  );
  assertSecretWire(host, impostor, normals, roundTwoPrompt);

  await runPhysicalSequence(host, players, 1, roundTwoPrompt);
  await voteCatch(host, players, 1, impostor);
  ok(host.view.result?.groupFound === true, "majority catches the round 2 impostor");
  ok(host.view.result?.roundComplete === true, "catching impostor in challenge 1 ends the round immediately");
  ok(host.view.result?.challengeIndex === 1, "round 2 ends in challenge 1/3");
  assertFinalTally(host.view.result, 3, players.map((player) => player.uid));
  assertNoPointsOrVoteIdentity(host.view, "round 2 final result");

  host.send({ t: "NEXT_ROUND" });
  await waitFor(host, (client) => client.phase() === "QUESTION" && client.view?.room?.currentRound === 3, "round 3 start");
  await waitForAll(players, (client) => client.phase() === "QUESTION" && client.view?.room?.currentRound === 3, "round 3 start");
  ok(host.phase() !== "GAME_OVER", "game continues after a challenge-1 catch when rounds remain");

  console.log("\n[round 3] final configured round:");
  ({ impostor, normals } = currentRoles(players));
  const roundThreeImpostorUid = impostor.uid;
  const roundThreeMode = host.view.challenge?.mode;
  const roundThreePrompt = currentPrompt(normals, roundThreeMode);
  ok(roundThreeImpostorUid !== roundTwoImpostorUid, "round 3 advances fairness to another impostor");
  ok(roundThreeMode !== roundTwoMode, "Challenge-level bag does not repeat round 2 mode immediately");

  await runPhysicalSequence(host, players, 1, roundThreePrompt);
  await voteCatch(host, players, 1, impostor);
  ok(host.view.result?.groupFound === true, "final round majority catches impostor");
  assertFinalTally(host.view.result, 3, players.map((player) => player.uid));

  host.send({ t: "NEXT_ROUND" });
  await waitFor(host, (client) => client.phase() === "GAME_OVER", "GAME_OVER after round 3");
  await waitForAll(players, (client) => client.phase() === "GAME_OVER", "GAME_OVER after round 3");

  ok(host.view.gameOver?.totalRounds === 3, "game over summary uses configured round count");
  ok(host.view.gameOver?.caughtRounds === 2, "game over summary counts two caught rounds");
  ok(host.view.gameOver?.escapedRounds === 1, "game over summary counts one escaped round");
  assertNoPointsOrVoteIdentity(host.view, "game over");
  ok(!JSON.stringify(host.view.gameOver).includes("ranking"), "game over has no ranking");
  ok(!JSON.stringify(host.view.gameOver).includes("winner"), "game over has no individual winner");

  for (const client of [host, ...players]) {
    ok(!client.rawText().includes("promptId"), `${client.label} never receives a promptId on the wire`);
    assertNoVoterMappingWire(client, `${client.label} final accumulated`);
  }

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
