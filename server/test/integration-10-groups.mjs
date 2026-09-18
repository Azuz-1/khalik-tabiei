/**
 * Comprehensive release-candidate WebSocket simulation.
 *
 * Ten independent groups exercise the final competitive ruleset across every
 * supported player count (3..10), all Challenge totals (3/6/9/12), every mode
 * alone and in combinations, catch/survival/max-stint/match-end outcomes,
 * reconnect, voting abstention, Host reconnect, admission/room capacity,
 * kick, rematch, telemetry ingestion and wire secrecy.
 *
 * G1 runs alone as a baseline, then the remaining groups run in small concurrent
 * batches. This keeps real multi-room coverage without turning the release test
 * into an artificial 30-socket burst on one CI-loopback IP.
 */
import { WebSocket } from "ws";

const URL = process.env.URL ?? "ws://localhost:8080/ws";
const ORIGIN = process.env.ORIGIN ?? URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const TIMEOUT_MS = 35_000;
const PHASE_TIMEOUT_MS = 20_000;
let assertions = 0;
let failures = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(condition, message) {
  assertions += 1;
  if (!condition) {
    failures += 1;
    throw new Error(message);
  }
}

async function waitUntil(predicate, label, timeout = TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await sleep(40);
  }
  throw new Error(`timeout waiting for ${label}`);
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

  async init() {
    const response = await fetch(`${ORIGIN}/api/session`);
    check(response.ok, `${this.label}: session bootstrap`);
    this.cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
    check(Boolean(this.cookie), `${this.label}: session cookie issued`);
    await this.connect();
  }

  async connect() {
    check(Boolean(this.cookie), `${this.label}: reconnect has cookie`);
    this.view = null;
    const ws = new WebSocket(URL, { headers: { Cookie: this.cookie, Origin: ORIGIN } });
    this.ws = ws;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label}: auth timeout`)), TIMEOUT_MS);
      const onError = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      ws.once("error", onError);
      ws.on("open", () => ws.send(JSON.stringify({ t: "HELLO" })));
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        this.messages.push(message);
        if (message.t === "STATE") {
          this.view = message.view;
          this.uid = message.view.self.uid;
        } else if (message.t === "HELLO_OK") {
          this.uid = message.uid;
        }
        if (message.t === "STATE" || message.t === "HELLO_OK") {
          clearTimeout(timer);
          ws.off("error", onError);
          resolve();
        }
      });
    });
  }

  send(message) {
    check(this.ws?.readyState === WebSocket.OPEN, `${this.label}: socket open before ${message.t}`);
    this.ws.send(JSON.stringify(message));
  }

  phase() {
    return this.view?.room?.phase;
  }

  raw() {
    return JSON.stringify(this.messages);
  }

  async reconnect(delay = 180) {
    const oldUid = this.uid;
    await this.drop();
    await sleep(delay);
    await this.connect();
    check(this.uid === oldUid, `${this.label}: reconnect preserves uid`);
  }

  async drop() {
    const ws = this.ws;
    if (!ws || ws.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1_500);
      ws.once("close", () => { clearTimeout(timer); resolve(); });
      ws.close();
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

async function waitFor(client, predicate, label, timeout = TIMEOUT_MS) {
  await waitUntil(() => predicate(client), `${client.label}: ${label}`, timeout);
}

async function waitForAll(clients, predicate, label, timeout = TIMEOUT_MS) {
  await Promise.all(clients.map((client) => waitFor(client, predicate, label, timeout)));
}

async function expectError(client, code, label) {
  await waitFor(client, (c) => c.messages.some((message) => message.t === "ERROR" && message.code === code), label, 8_000);
  check(true, `${client.label}: ${code}`);
}

function currentRoles(players, context = "role check") {
  const impostors = players.filter((player) => player.view?.isImpostor === true);
  const normals = players.filter((player) => player.view?.isImpostor === false);
  if (impostors.length !== 1 || normals.length !== players.length - 1) {
    const snapshot = players.map((player) => ({
      label: player.label,
      uid: player.uid,
      phase: player.phase(),
      isImpostor: player.view?.isImpostor,
      challenge: player.view?.challenge,
    }));
    throw new Error(`${context}: invalid private role projection ${JSON.stringify(snapshot)}`);
  }
  assertions += 2;
  return { impostor: impostors[0], normals };
}

function assertWireSecrecy(host, players, prompt) {
  const { impostor, normals } = currentRoles(players, "wire secrecy role check");
  check(typeof prompt === "string" && prompt.length > 0, "normal prompt exists");
  check(normals.every((normal) => normal.view?.myPrompt?.text === prompt), "all normals share prompt");
  check(impostor.view?.myPrompt === undefined, "impostor has no prompt");
  check(host.view?.myPrompt === undefined, "Host has no prompt");
  check(host.view?.publicPrompt === undefined, "prompt hidden from Host before reveal");
  check(!impostor.raw().includes(prompt), "current prompt absent from impostor wire before reveal");
  check(!host.raw().includes(prompt), "current prompt absent from Host wire before reveal");
  check(!host.raw().includes("promptId"), "promptId absent from Host wire");
  return { impostor, normals };
}

function decoyTarget(voter, roles) {
  return roles.normals.find((normal) => normal.uid !== voter.uid)?.uid ?? roles.impostor.uid;
}

async function castVotes(group, roles, outcome, skippedUid = null) {
  const participants = group.players.length;
  const required = Math.floor(participants / 2) + 1;
  const connectedNormals = roles.normals.filter((normal) => normal.uid !== skippedUid);
  const correctNormals = outcome === "catch" ? connectedNormals : connectedNormals.slice(0, Math.max(0, required - 1));
  const correctSet = new Set(correctNormals.map((normal) => normal.uid));

  for (const player of group.players) {
    if (player.uid === skippedUid) continue;
    let targetUid;
    if (player.uid === roles.impostor.uid) targetUid = decoyTarget(player, roles);
    else if (correctSet.has(player.uid)) targetUid = roles.impostor.uid;
    else targetUid = decoyTarget(player, roles);
    check(targetUid !== player.uid, `${group.id}: no self vote`);
    player.send({ t: "SUBMIT_VOTE", targetUid });
  }
  return required;
}

async function runPhysical(group, challengeNo) {
  await waitForAll(
    [group.host, ...group.players],
    (client) => client.phase() === "QUESTION",
    `${group.id} C${challengeNo} QUESTION`,
  );
  await waitForAll(
    group.players,
    (client) => typeof client.view?.isImpostor === "boolean",
    `${group.id} C${challengeNo} private role projection`,
  );
  const roles = currentRoles(group.players, `${group.id} C${challengeNo}`);
  const prompt = roles.normals[0]?.view?.myPrompt?.text;
  assertWireSecrecy(group.host, group.players, prompt);
  check(group.host.view?.challenge?.max === 3, `${group.id}: stint max is always 3`);
  check(group.host.view?.challenge?.index >= 1 && group.host.view?.challenge?.index <= 3, `${group.id}: challenge index in 1..3`);
  check(group.config.modes.includes(group.host.view?.challenge?.mode), `${group.id}: Challenge mode is selected`);

  if (group.config.duplicateReady && challengeNo === 1) {
    group.players[0].send({ t: "MARK_READY" });
    for (let i = 0; i < 4; i += 1) group.players[0].send({ t: "MARK_READY" });
    for (const player of group.players.slice(1)) player.send({ t: "MARK_READY" });
  } else {
    for (const player of group.players) player.send({ t: "MARK_READY" });
  }

  await waitFor(group.host, (client) => client.phase() === "COUNTDOWN", `${group.id} C${challengeNo} COUNTDOWN`, PHASE_TIMEOUT_MS);

  if (group.config.playerReconnect && challengeNo === 1) {
    const reconnecting = group.players[0];
    await reconnecting.reconnect();
    await waitFor(reconnecting, (client) => client.phase() === "COUNTDOWN", `${group.id} player reconnect COUNTDOWN`, PHASE_TIMEOUT_MS);
  }

  if (group.config.hostReconnect && challengeNo === 1) {
    await group.host.reconnect();
    await waitFor(group.host, (client) => client.phase() === "COUNTDOWN", `${group.id} Host reconnect COUNTDOWN`, PHASE_TIMEOUT_MS);
    check(group.host.view?.room?.hostConnected === true, `${group.id}: Host restored after reconnect`);
  }

  await waitFor(group.host, (client) => client.phase() === "ACTION", `${group.id} C${challengeNo} ACTION`, PHASE_TIMEOUT_MS);
  await waitFor(group.host, (client) => client.phase() === "HOLD", `${group.id} C${challengeNo} HOLD`, PHASE_TIMEOUT_MS);
  await waitFor(group.host, (client) => client.phase() === "PROMPT_REVEAL", `${group.id} C${challengeNo} PROMPT_REVEAL`, PHASE_TIMEOUT_MS);
  check(group.host.view?.publicPrompt?.text === prompt, `${group.id}: public prompt revealed after HOLD`);
  await waitForAll([group.host, ...group.players], (client) => client.phase() === "DISCUSSION", `${group.id} C${challengeNo} DISCUSSION`, PHASE_TIMEOUT_MS);
  return roles;
}

async function runVoting(group, roles, outcome, challengeNo) {
  group.host.send({ t: "START_VOTING" });
  await waitForAll([group.host, ...group.players], (client) => client.phase() === "VOTING", `${group.id} C${challengeNo} VOTING`);
  const expectedRequired = Math.floor(group.players.length / 2) + 1;
  check(group.host.view?.votesProgress?.requiredVotes === expectedRequired, `${group.id}: majority threshold ${expectedRequired}`);
  check(group.host.view?.liveVoteTally === undefined, `${group.id}: no live vote tally`);

  let skipped = null;
  if (group.config.votingAbstention && challengeNo === 1) {
    skipped = roles.normals[0];
    await skipped.drop();
    await waitFor(group.host, (client) => client.view?.players?.some((p) => p.uid === skipped.uid && p.connected === false), `${group.id} disconnected voter visible`);
  }

  const required = await castVotes(group, roles, outcome, skipped?.uid ?? null);
  if (skipped) {
    await waitFor(group.host, (client) => client.phase() === "VOTING" && client.view?.votesProgress?.submitted === group.players.length - 1, `${group.id} waits for abstention grace`);
    check(group.host.view?.votesProgress?.requiredVotes === required, `${group.id}: disconnect does not lower majority`);
  }

  await waitFor(group.host, (client) => client.phase() === "RESULT", `${group.id} C${challengeNo} RESULT`, skipped ? 32_000 : 10_000);
  const connected = group.players.filter((player) => player.uid !== skipped?.uid);
  await waitForAll(connected, (client) => client.phase() === "RESULT", `${group.id} C${challengeNo} player RESULT`, 10_000);
  check(group.host.view?.result?.requiredVotes === required, `${group.id}: sealed result preserves threshold`);
  check(group.host.view?.result?.groupFound === (outcome === "catch"), `${group.id}: ${outcome} outcome`);

  if (skipped) {
    await skipped.connect();
    check(skipped.uid != null, `${group.id}: abstaining player reconnects`);
    await waitFor(skipped, (client) => client.phase() === "RESULT", `${group.id} abstaining player sees sealed RESULT`);
  }

  return group.host.view?.result;
}

async function setupGroup(config) {
  const host = new Client(`${config.id}-HOST`);
  const players = Array.from({ length: config.players }, (_, index) => new Client(`${config.id}-لاعب${index + 1}`));
  await Promise.all([host.init(), ...players.map((player) => player.init())]);
  const group = { id: config.id, config, host, players };

  host.send({ t: "CREATE_ROOM" });
  await waitFor(host, (client) => client.phase() === "LOBBY", `${config.id} lobby`);
  const code = host.view.room.code;
  for (const player of players) player.send({ t: "JOIN_ROOM", code, name: player.label.slice(-12) });
  await waitFor(host, (client) => client.view?.players?.length === config.players, `${config.id} ${config.players} joined`);
  check(new Set(host.view.players.map((p) => p.seatNumber)).size === config.players, `${config.id}: unique seat numbers`);

  if (config.capacityChecks) {
    host.send({ t: "SET_ADMISSION", locked: true });
    await waitFor(host, (client) => client.view?.room?.admissionLocked === true, `${config.id} admission locked`);
    const locked = new Client(`${config.id}-LOCKED`);
    await locked.init();
    locked.send({ t: "JOIN_ROOM", code, name: "مقفول" });
    await expectError(locked, "ROOM_LOCKED", `${config.id} locked join rejected`);
    locked.close();

    host.send({ t: "SET_ADMISSION", locked: false });
    await waitFor(host, (client) => client.view?.room?.admissionLocked === false, `${config.id} admission unlocked`);
    const full = new Client(`${config.id}-FULL`);
    await full.init();
    full.send({ t: "JOIN_ROOM", code, name: "زائد" });
    await expectError(full, "ROOM_FULL", `${config.id} eleventh player rejected`);
    full.close();
  }

  return group;
}

async function configureAndStart(group, target = group.config.target) {
  group.host.send({ t: "SET_SETTINGS", totalRounds: target, selectedModes: group.config.modes });
  await waitFor(group.host, (client) => client.view?.room?.targetChallenges === target && client.view?.room?.selectedModes?.length === group.config.modes.length, `${group.id} settings`);
  check(group.host.view?.room?.playStyle === "INDIVIDUAL", `${group.id}: competitive scoring ruleset`);
  group.host.send({ t: "START_GAME" });
  await waitForAll([group.host, ...group.players], (client) => client.phase() === "QUESTION", `${group.id} game start`);
  await waitForAll(group.players, (client) => typeof client.view?.isImpostor === "boolean", `${group.id} initial private roles`);
}

async function playMatch(group, target, pattern) {
  await configureAndStart(group, target);
  let completed = 0;
  let sawMaxStint = false;
  let sawMatchEnd = false;
  let sawCatch = false;

  while (completed < target) {
    const challengeNo = completed + 1;
    const roles = await runPhysical(group, challengeNo);
    const outcome = pattern[completed % pattern.length];
    const result = await runVoting(group, roles, outcome, challengeNo);
    completed += 1;
    check(group.host.view?.room?.completedChallenges === completed, `${group.id}: completed ${completed}/${target}`);

    if (result?.completionReason === "MAX_CHALLENGES") sawMaxStint = true;
    if (result?.completionReason === "MATCH_END") sawMatchEnd = true;
    if (result?.completionReason === "CAUGHT") sawCatch = true;

    if (group.config.kickAfterFirst && completed === 1) {
      const targetPlayer = roles.normals.at(-1);
      check(Boolean(targetPlayer), `${group.id}: kick target exists`);
      group.host.send({ t: "KICK_PLAYER", uid: targetPlayer.uid });
      await waitFor(group.host, (client) => client.view?.players?.length === group.players.length - 1, `${group.id} kicked player removed`);
      await waitFor(targetPlayer, (client) => client.messages.some((message) => message.t === "KICKED"), `${group.id} kicked player notified`);
      targetPlayer.close();
      group.players = group.players.filter((player) => player.uid !== targetPlayer.uid);
      check(group.players.length >= 3, `${group.id}: enough players remain after kick`);
    }

    group.host.send({ t: "NEXT_ROUND" });
    if (completed === target) {
      await waitForAll([group.host, ...group.players], (client) => client.phase() === "GAME_OVER", `${group.id} GAME_OVER`);
    } else {
      await waitForAll([group.host, ...group.players], (client) => client.phase() === "QUESTION", `${group.id} next QUESTION`);
      await waitForAll(group.players, (client) => typeof client.view?.isImpostor === "boolean", `${group.id} next private roles`);
    }
  }

  check(group.host.view?.gameOver?.targetChallenges === target, `${group.id}: GAME_OVER target ${target}`);
  check(group.host.view?.gameOver?.completedChallenges === target, `${group.id}: exact Challenge boundary ${target}`);
  check(Array.isArray(group.host.view?.scoreboard) && group.host.view.scoreboard.length === group.players.length, `${group.id}: final scoreboard complete`);
  check(group.host.view.scoreboard.every((row) => Number.isInteger(row.rank) && row.rank >= 1), `${group.id}: valid ranks`);
  for (const client of [group.host, ...group.players]) {
    check(!client.raw().includes("promptId"), `${group.id}: promptId never serialized to ${client.label}`);
    check(!client.raw().includes("voterUid"), `${group.id}: voter mapping absent from ${client.label}`);
  }
  return { sawMaxStint, sawMatchEnd, sawCatch };
}

async function runGroup(config) {
  const started = Date.now();
  const group = await setupGroup(config);
  try {
    const result = await playMatch(group, config.target, config.pattern);
    if (config.expectMaxStint) check(result.sawMaxStint, `${config.id}: observed MAX_CHALLENGES completion`);
    if (config.expectMatchEnd) check(result.sawMatchEnd, `${config.id}: observed MATCH_END completion`);
    if (config.pattern.includes("catch")) check(result.sawCatch, `${config.id}: observed CAUGHT completion`);

    if (config.rematch) {
      group.host.send({ t: "REMATCH" });
      await waitForAll([group.host, ...group.players], (client) => client.phase() === "LOBBY", `${config.id} rematch lobby`);
      const second = await playMatch(group, 3, ["catch"]);
      check(second.sawCatch, `${config.id}: rematch produces catch result`);
    }

    group.host.send({ t: "CLOSE_ROOM" });
    await sleep(80);
    console.log(`GROUP ${config.id} PASS (${config.players} players, ${config.target} Challenges) in ${Math.round((Date.now() - started) / 1000)}s`);
    return { id: config.id, ok: true };
  } finally {
    group.host.close();
    for (const player of group.players) player.close();
  }
}

async function smokeHttpTelemetry() {
  const health = await fetch(`${ORIGIN}/healthz`);
  check(health.ok && (await health.json()).ok === true, "healthz healthy");
  const ready = await fetch(`${ORIGIN}/readyz`);
  check(ready.ok && (await ready.json()).ok === true, "readyz ready");
  const version = await fetch(`${ORIGIN}/version`);
  check(version.ok && typeof (await version.json()).sha === "string", "version endpoint responds");

  const session = await fetch(`${ORIGIN}/api/session`);
  const cookie = session.headers.get("set-cookie")?.split(";", 1)[0];
  check(Boolean(cookie), "telemetry smoke session issued");
  const telemetry = await fetch(`${ORIGIN}/api/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: cookie },
    body: JSON.stringify({ events: [{ event: "client_started", props: { deviceClass: "desktop", browserFamily: "test" } }] }),
  });
  check(telemetry.status === 204, "authenticated client telemetry accepted");
}

const GROUPS = [
  { id: "G1", players: 3, target: 3, modes: ["HANDS"], pattern: ["catch"], duplicateReady: true },
  { id: "G2", players: 4, target: 6, modes: ["POINT"], pattern: ["survive", "catch"] },
  { id: "G3", players: 5, target: 9, modes: ["NUMBER"], pattern: ["survive", "survive", "survive", "catch"], expectMaxStint: true },
  { id: "G4", players: 6, target: 12, modes: ["HANDS", "POINT", "NUMBER"], pattern: ["survive", "catch", "survive", "survive", "survive"], expectMaxStint: true },
  { id: "G5", players: 7, target: 3, modes: ["HANDS", "POINT"], pattern: ["survive"], playerReconnect: true, expectMatchEnd: true },
  { id: "G6", players: 8, target: 6, modes: ["POINT", "NUMBER"], pattern: ["survive", "catch"], votingAbstention: true },
  { id: "G7", players: 9, target: 9, modes: ["HANDS", "NUMBER"], pattern: ["catch", "survive"], hostReconnect: true },
  { id: "G8", players: 10, target: 12, modes: ["HANDS", "POINT", "NUMBER"], pattern: ["survive", "survive", "catch"], capacityChecks: true },
  { id: "G9", players: 3, target: 6, modes: ["HANDS", "POINT", "NUMBER"], pattern: ["survive", "catch"], rematch: true },
  { id: "G10", players: 4, target: 3, modes: ["POINT", "NUMBER"], pattern: ["catch", "survive", "survive"], kickAfterFirst: true, expectMatchEnd: true },
];

async function runBatch(configs, label) {
  console.log(label);
  const results = await Promise.allSettled(configs.map((config) => runGroup(config)));
  const rejected = results.filter((result) => result.status === "rejected");
  for (const result of rejected) console.error("GROUP FAILURE:", result.reason);
  if (rejected.length) throw new Error(`${rejected.length} group(s) failed in ${label}`);
  await sleep(200);
}

async function main() {
  console.log(`10-GROUP COMPREHENSIVE RELEASE TEST against ${ORIGIN}`);
  await smokeHttpTelemetry();
  await runBatch(GROUPS.slice(0, 1), "Baseline: G1 isolated");
  await runBatch(GROUPS.slice(1, 3), "Concurrent batch: G2-G3");
  await runBatch(GROUPS.slice(3, 5), "Concurrent batch: G4-G5");
  await runBatch(GROUPS.slice(5, 7), "Concurrent batch: G6-G7");
  await runBatch(GROUPS.slice(7, 9), "Concurrent batch: G8-G9");
  await runBatch(GROUPS.slice(9), "Final: G10 isolated");
  console.log(`10-GROUP COMPREHENSIVE PASS ✅ — ${assertions} assertions, ${failures} failures`);
}

main().catch((error) => {
  console.error("10-GROUP COMPREHENSIVE FAILED ❌", error);
  process.exit(1);
});
