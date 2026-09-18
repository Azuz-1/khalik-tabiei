import { WebSocket } from "ws";

const URL = process.env.URL ?? "ws://localhost:8080/ws";
const HTTP_BASE = process.env.HTTP_BASE ?? URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const ORIGIN = process.env.ORIGIN ?? HTTP_BASE;
const TIMEOUT_MS = 40_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let ridCounter = 0;
const rid = (prefix) => `${prefix}-${++ridCounter}`;

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log("  ✓", message);
}

class Client {
  constructor(label) {
    this.label = label;
    this.cookie = null;
    this.uid = null;
    this.view = null;
    this.messages = [];
    this.ws = null;
  }

  async connect() {
    if (!this.cookie) {
      const response = await fetch(`${HTTP_BASE}/api/session`);
      check(response.ok, `${this.label}: session bootstrap succeeds`);
      this.cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
    }
    if (!this.cookie) throw new Error(`${this.label}: missing session cookie`);

    const start = this.messages.length;
    const ws = new WebSocket(URL, {
      headers: { Cookie: this.cookie, Origin: ORIGIN },
    });
    this.ws = ws;
    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());
      this.messages.push(message);
      if (message.t === "HELLO_OK") this.uid = message.uid;
      if (message.t === "STATE") {
        this.view = message.view;
        this.uid = message.view.self.uid;
      }
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: websocket open timeout`)), TIMEOUT_MS);
      ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    ws.send(JSON.stringify({ t: "HELLO", protocolVersion: 2 }));
    const hello = await this.waitForMessage((message) => message.t === "HELLO_OK" || message.t === "STATE", start);
    check(hello.t === "STATE" || hello.protocolVersion === 2, `${this.label}: authenticates on the real WebSocket transport`);
  }

  async waitForMessage(predicate, after = 0, timeout = TIMEOUT_MS) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = this.messages.slice(after).find(predicate);
      if (found) return found;
      await sleep(20);
    }
    throw new Error(`${this.label}: timed out waiting for message`);
  }

  async waitForView(predicate, timeout = TIMEOUT_MS) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (this.view && predicate(this.view)) return this.view;
      await sleep(20);
    }
    throw new Error(`${this.label}: timed out waiting for view; phase=${this.view?.room?.phase ?? "none"}`);
  }

  async action(message, requestId = rid(this.label)) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error(`${this.label}: socket is not open`);
    const start = this.messages.length;
    this.ws.send(JSON.stringify({ ...message, rid: requestId }));
    return this.waitForMessage(
      (candidate) => (candidate.t === "ACK" || candidate.t === "ERROR") && candidate.rid === requestId,
      start,
    );
  }

  async disconnect() {
    const ws = this.ws;
    if (!ws || ws.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      ws.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.close();
    });
  }

  async reconnect() {
    const oldUid = this.uid;
    await this.disconnect();
    this.view = null;
    await this.connect();
    check(this.uid === oldUid, `${this.label}: reconnect preserves signed identity`);
  }

  stateRoomCodes() {
    return this.messages
      .filter((message) => message.t === "STATE")
      .map((message) => message.view.room.code);
  }

  close() {
    this.ws?.close();
  }
}

async function expectAck(promise, message) {
  const reply = await promise;
  check(reply.t === "ACK", message);
  return reply;
}

async function expectError(promise, code, message) {
  const reply = await promise;
  check(reply.t === "ERROR" && reply.code === code, `${message} (${code})`);
  return reply;
}

async function createGroup(label, totalPlayers, targetChallenges, selectedModes) {
  const clients = Array.from({ length: totalPlayers }, (_, index) =>
    new Client(`${label}-P${index + 1}`),
  );
  await Promise.all(clients.map((client) => client.connect()));
  const owner = clients[0];

  await expectAck(
    owner.action({ t: "CREATE_ROOM", name: `${label}-owner` }, rid(`${label}-create`)),
    `${label}: named owner creates room`,
  );
  await owner.waitForView((view) => view.room.phase === "LOBBY" && view.self.isOwner === true);
  const code = owner.view.room.code;

  await Promise.all(
    clients.slice(1).map((client, index) =>
      expectAck(
        client.action({ t: "JOIN_ROOM", code, name: `${label}-member-${index + 2}` }, rid(`${label}-join`)),
        `${label}: member ${index + 2} joins`,
      ),
    ),
  );

  await Promise.all(clients.map((client) =>
    client.waitForView((view) => view.room.code === code && view.players.length === totalPlayers),
  ));

  await expectAck(
    owner.action(
      { t: "SET_SETTINGS", totalRounds: targetChallenges, selectedModes },
      rid(`${label}-settings`),
    ),
    `${label}: owner sets target and modes`,
  );
  await Promise.all(clients.map((client) =>
    client.waitForView(
      (view) =>
        view.room.targetChallenges === targetChallenges &&
        selectedModes.every((mode) => view.room.selectedModes.includes(mode)),
    ),
  ));

  check(new Set(clients.map((client) => client.uid)).size === totalPlayers, `${label}: every simulated phone has a distinct identity`);
  return { label, code, clients, owner, targetChallenges };
}

async function startGame(group) {
  await expectAck(group.owner.action({ t: "START_GAME" }, rid(`${group.label}-start`)), `${group.label}: game starts`);
  await Promise.all(group.clients.map((client) => client.waitForView((view) => view.room.phase === "QUESTION")));
  check(group.clients.filter((client) => client.view.isImpostor === true).length === 1, `${group.label}: exactly one impostor is privately assigned`);
}

function currentRoles(group) {
  const impostor = group.clients.find((client) => client.view?.isImpostor === true);
  if (!impostor) throw new Error(`${group.label}: impostor not found`);
  const normals = group.clients.filter((client) => client.uid !== impostor.uid);
  return { impostor, normals };
}

async function readyToDiscussion(group) {
  await Promise.all(
    group.clients.map((client) =>
      expectAck(client.action({ t: "MARK_READY" }, rid(`${group.label}-ready`)), `${client.label}: ready accepted`),
    ),
  );
  await Promise.all(group.clients.map((client) => client.waitForView((view) => view.room.phase === "DISCUSSION")));
}

async function waitForAutomaticVoting(group) {
  await Promise.all(
    group.clients
      .filter((client) => client.ws?.readyState === WebSocket.OPEN)
      .map((client) => client.waitForView((view) => view.room.phase === "VOTING", 65_000)),
  );
  check(group.owner.view.votesProgress?.submitted === 0, `${group.label}: authoritative discussion timer opens a fresh ballot`);
}

async function voteToCatch(group, skip = new Set()) {
  const { impostor, normals } = currentRoles(group);
  const firstNormal = normals.find((client) => !skip.has(client.uid));
  if (!firstNormal) throw new Error(`${group.label}: no normal target available`);

  const active = group.clients.filter(
    (client) => !skip.has(client.uid) && client.ws?.readyState === WebSocket.OPEN,
  );
  for (const client of active) {
    const targetUid = client.uid === impostor.uid ? firstNormal.uid : impostor.uid;
    await expectAck(
      client.action({ t: "SUBMIT_VOTE", targetUid }, rid(`${group.label}-vote`)),
      `${client.label}: valid ballot accepted`,
    );
  }

  await Promise.all(active.map((client) => client.waitForView((view) => view.room.phase === "RESULT")));
  check(group.owner.view.result?.groupFound === true, `${group.label}: cooperative majority catches the impostor`);
}

async function runGoodCop(group) {
  console.log("\n[good cop / full match / rematch]");
  await startGame(group);

  for (let challenge = 1; challenge <= group.targetChallenges; challenge += 1) {
    await readyToDiscussion(group);
    await waitForAutomaticVoting(group);
    await voteToCatch(group);
    check(
      group.owner.view.room.completedChallenges === challenge,
      `${group.label}: challenge counter reaches ${challenge}`,
    );

    await expectAck(
      group.owner.action({ t: "NEXT_ROUND" }, rid(`${group.label}-next`)),
      `${group.label}: owner advances after result`,
    );
    const expected = challenge === group.targetChallenges ? "GAME_OVER" : "QUESTION";
    await Promise.all(group.clients.map((client) => client.waitForView((view) => view.room.phase === expected)));
  }

  check(group.owner.view.gameOver?.completedChallenges === group.targetChallenges, `${group.label}: game ends on the configured challenge target`);
  await expectAck(group.owner.action({ t: "REMATCH" }, rid(`${group.label}-rematch`)), `${group.label}: rematch accepted`);
  await Promise.all(group.clients.map((client) => client.waitForView((view) => view.room.phase === "LOBBY")));
  check(group.owner.view.room.completedChallenges === 0, `${group.label}: rematch clears completed challenge state`);

  await expectAck(group.owner.action({ t: "START_GAME" }, rid(`${group.label}-restart`)), `${group.label}: rematch can start a fresh match`);
  await group.owner.waitForView((view) => view.room.phase === "QUESTION");
  await expectAck(group.owner.action({ t: "CLOSE_ROOM" }, rid(`${group.label}-close`)), `${group.label}: owner can close an active rematch cleanly`);
}

async function runBadCop(group) {
  console.log("\n[bad cop / adversarial actions]");
  const attacker = group.clients[1];

  const reusedRid = rid(`${group.label}-reuse`);
  await expectError(
    attacker.action({ t: "SET_ADMISSION", locked: true }, reusedRid),
    "NOT_HOST",
    `${group.label}: non-owner cannot lock admission`,
  );
  await expectError(
    attacker.action({ t: "KICK_PLAYER", uid: group.owner.uid }, reusedRid),
    "BAD_REQUEST",
    `${group.label}: conflicting request-id replay is rejected`,
  );
  await expectError(
    attacker.action({ t: "START_GAME" }, rid(`${group.label}-bad-start`)),
    "NOT_HOST",
    `${group.label}: non-owner cannot start the match`,
  );

  await startGame(group);
  const beforeVoteTarget = group.clients.find((client) => client.uid !== attacker.uid);
  await expectError(
    attacker.action({ t: "SUBMIT_VOTE", targetUid: beforeVoteTarget.uid }, rid(`${group.label}-early-vote`)),
    "INVALID_PHASE",
    `${group.label}: voting before the ballot opens is rejected`,
  );

  await readyToDiscussion(group);
  await expectError(
    attacker.action({ t: "START_VOTING" }, rid(`${group.label}-bad-open`)),
    "INVALID_PHASE",
    `${group.label}: production server rejects client-forced voting`,
  );
  await waitForAutomaticVoting(group);

  await expectError(
    attacker.action({ t: "SUBMIT_VOTE", targetUid: attacker.uid }, rid(`${group.label}-self-vote`)),
    "INVALID_VOTE",
    `${group.label}: self-vote is rejected`,
  );

  const participants = [...group.clients];
  const attackerIndex = participants.indexOf(attacker);
  const attackerTarget = participants[(attackerIndex + 1) % participants.length];
  await expectAck(
    attacker.action({ t: "SUBMIT_VOTE", targetUid: attackerTarget.uid }, rid(`${group.label}-valid-attacker-vote`)),
    `${group.label}: attacker can still submit one legitimate ballot`,
  );
  await expectError(
    attacker.action({ t: "SUBMIT_VOTE", targetUid: attackerTarget.uid }, rid(`${group.label}-duplicate-vote`)),
    "VOTE_ALREADY_SUBMITTED",
    `${group.label}: duplicate ballot is rejected`,
  );

  for (const client of participants) {
    if (client.uid === attacker.uid) continue;
    const index = participants.indexOf(client);
    const target = participants[(index + 1) % participants.length];
    await expectAck(
      client.action({ t: "SUBMIT_VOTE", targetUid: target.uid }, rid(`${group.label}-split-vote`)),
      `${client.label}: split ballot accepted`,
    );
  }

  await Promise.all(group.clients.map((client) => client.waitForView((view) => view.room.phase === "RESULT")));
  check(group.owner.view.result?.groupFound === false, `${group.label}: strategic split lets the impostor survive without corrupting state`);
  check(group.owner.view.result?.impostorUid === undefined, `${group.label}: intermediate result keeps impostor identity hidden`);
  check(group.owner.view.result?.voteTally === undefined, `${group.label}: intermediate result keeps target totals hidden`);

  await expectAck(group.owner.action({ t: "CLOSE_ROOM" }, rid(`${group.label}-close`)), `${group.label}: room remains controllable after adversarial attempts`);
}

async function runFailureRecovery(group) {
  console.log("\n[failure / reconnect / removal]");
  await startGame(group);
  const initialRoles = currentRoles(group);
  const reconnecting = initialRoles.normals.find((client) => client.uid !== group.owner.uid);
  if (!reconnecting) throw new Error(`${group.label}: reconnect candidate missing`);

  await Promise.all(
    group.clients.map((client) =>
      expectAck(client.action({ t: "MARK_READY" }, rid(`${group.label}-ready`)), `${client.label}: ready accepted`),
    ),
  );
  await group.owner.waitForView((view) => view.room.phase === "COUNTDOWN");

  const reconnectUid = reconnecting.uid;
  await reconnecting.reconnect();
  check(reconnecting.uid === reconnectUid, `${group.label}: countdown reconnect returns to the same seat identity`);
  await reconnecting.waitForView((view) => view.room.code === group.code);

  await Promise.all(group.clients.map((client) => client.waitForView((view) => view.room.phase === "DISCUSSION")));

  const peer = group.clients.find((client) => client.uid !== group.owner.uid);
  const ownerUid = group.owner.uid;
  await group.owner.disconnect();
  await peer.waitForView((view) => view.players.some((player) => player.uid === ownerUid && player.connected === false));
  await sleep(250);
  await group.owner.connect();
  check(group.owner.uid === ownerUid, `${group.label}: owner reconnect keeps identity`);
  await group.owner.waitForView((view) => view.room.phase === "DISCUSSION" && view.self.isOwner === true);
  check(group.owner.view.room.hostUid === ownerUid, `${group.label}: short owner outage does not transfer authority`);

  await waitForAutomaticVoting(group);
  const roles = currentRoles(group);
  const kickTarget = roles.normals.find(
    (client) => client.uid !== group.owner.uid && client.uid !== reconnecting.uid,
  ) ?? roles.normals.find((client) => client.uid !== group.owner.uid);
  if (!kickTarget) throw new Error(`${group.label}: removable normal missing`);

  await kickTarget.disconnect();
  await group.owner.waitForView((view) =>
    view.players.some((player) => player.uid === kickTarget.uid && player.connected === false),
  );

  const active = group.clients.filter(
    (client) => client.uid !== kickTarget.uid && client.ws?.readyState === WebSocket.OPEN,
  );
  const firstNormal = active.find((client) => client.uid !== roles.impostor.uid);
  if (!firstNormal) throw new Error(`${group.label}: active normal target missing`);

  const firstVoters = active.slice(0, 2);
  for (const client of firstVoters) {
    const targetUid = client.uid === roles.impostor.uid ? firstNormal.uid : roles.impostor.uid;
    await expectAck(
      client.action({ t: "SUBMIT_VOTE", targetUid }, rid(`${group.label}-pre-kick-vote`)),
      `${client.label}: pre-removal ballot commits`,
    );
  }

  await expectAck(
    group.owner.action({ t: "KICK_PLAYER", uid: kickTarget.uid }, rid(`${group.label}-kick-offline`)),
    `${group.label}: owner can remove an offline normal during voting`,
  );
  await group.owner.waitForView((view) => !view.players.some((player) => player.uid === kickTarget.uid));

  for (const client of active) {
    if (firstVoters.includes(client)) continue;
    const targetUid = client.uid === roles.impostor.uid ? firstNormal.uid : roles.impostor.uid;
    await expectAck(
      client.action({ t: "SUBMIT_VOTE", targetUid }, rid(`${group.label}-post-kick-vote`)),
      `${client.label}: post-removal ballot commits`,
    );
  }

  await Promise.all(active.map((client) => client.waitForView((view) => view.room.phase === "RESULT")));
  check(group.owner.view.result?.groupFound === true, `${group.label}: match still resolves correctly after disconnect/reconnect/removal`);
  check(group.owner.view.players.length === group.clients.length - 1, `${group.label}: kicked seat is removed exactly once`);

  await expectAck(group.owner.action({ t: "CLOSE_ROOM" }, rid(`${group.label}-close`)), `${group.label}: recovered room closes cleanly`);
}

function assertRoomIsolation(groups) {
  const codes = new Set(groups.map((group) => group.code));
  check(codes.size === groups.length, "concurrent groups receive distinct room codes");
  for (const group of groups) {
    for (const client of group.clients) {
      const seenCodes = client.stateRoomCodes();
      check(
        seenCodes.every((code) => code === group.code),
        `${client.label}: never receives another group's STATE`,
      );
    }
  }
}

async function main() {
  console.log("Concurrent multi-group real-WebSocket adversarial campaign");
  const groups = await Promise.all([
    createGroup("GOOD3", 3, 3, ["HANDS", "POINT", "NUMBER"]),
    createGroup("BAD6", 6, 6, ["POINT"]),
    createGroup("FAIL10", 10, 9, ["NUMBER", "HANDS"]),
  ]);

  try {
    assertRoomIsolation(groups);
    await Promise.all([
      runGoodCop(groups[0]),
      runBadCop(groups[1]),
      runFailureRecovery(groups[2]),
    ]);
    assertRoomIsolation(groups);
    console.log("\nMULTI-GROUP ADVERSARIAL E2E PASSED ✅");
  } finally {
    for (const group of groups) {
      for (const client of group.clients) client.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
