import { WebSocket } from "ws";

const URL = process.env.URL ?? "ws://localhost:8080/ws";
const ORIGIN = process.env.ORIGIN ?? URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const TIMEOUT_MS = 10_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log("  ✓", message);
}

class Client {
  constructor(label, cookie = null) {
    this.label = label;
    this.cookie = cookie;
    this.uid = null;
    this.view = null;
    this.messages = [];
    this.ws = null;
  }

  async connect() {
    if (!this.cookie) {
      const response = await fetch(`${ORIGIN}/api/session`);
      assert(response.ok, `${this.label} session bootstrap succeeds`);
      this.cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
    }
    if (!this.cookie) throw new Error(`${this.label}: session cookie missing`);

    this.ws = new WebSocket(URL, {
      headers: { Cookie: this.cookie, Origin: ORIGIN },
    });
    this.ws.on("message", (data) => {
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
      this.ws.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.ws.send(JSON.stringify({ t: "HELLO", protocolVersion: 2 }));
    const hello = await this.waitFor((message) => message.t === "HELLO_OK");
    assert(hello.protocolVersion === 2, `${this.label} negotiates protocol v2`);
    assert(Number.isFinite(hello.serverMs), `${this.label} receives a server clock anchor`);
  }

  async waitFor(predicate, after = 0) {
    const started = Date.now();
    while (Date.now() - started < TIMEOUT_MS) {
      const found = this.messages.slice(after).find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`${this.label}: timed out waiting for message`);
  }

  async action(message, rid) {
    const start = this.messages.length;
    this.ws.send(JSON.stringify({ ...message, rid }));
    return this.waitFor(
      (candidate) => (candidate.t === "ACK" || candidate.t === "ERROR") && candidate.rid === rid,
      start,
    );
  }

  close() {
    this.ws?.close();
  }
}

async function main() {
  console.log("Transport hardening real-WebSocket suite");
  const host = new Client("host");
  const player = new Client("player");
  const fresh = new Client("fresh");
  await Promise.all([host.connect(), player.connect(), fresh.connect()]);

  let start = host.messages.length;
  let reply = await host.action({ t: "CREATE_ROOM" }, "create1");
  assert(reply.t === "ACK", "CREATE_ROOM returns correlated ACK");
  await host.waitFor((message) => message.t === "STATE" && message.view.self.role === "host", start);
  const code = host.view.room.code;

  start = host.messages.length;
  host.ws.send(JSON.stringify({ t: "CREATE_ROOM", rid: "create1" }));
  reply = await host.waitFor((message) => message.t === "ACK" && message.rid === "create1", start);
  assert(reply.t === "ACK", "exact request-ID retry is idempotently acknowledged");

  reply = await host.action({ t: "SET_ADMISSION", locked: true }, "create1");
  assert(reply.t === "ERROR" && reply.code === "BAD_REQUEST", "conflicting request-ID reuse is rejected");

  start = host.messages.length;
  host.ws.send(JSON.stringify({ t: "PING", sampleId: "s-42", clientMonoMs: 123.5 }));
  const pong = await host.waitFor((message) => message.t === "PONG" && message.sampleId === "s-42", start);
  assert(Number.isFinite(pong.serverMs), "heartbeat echoes sample ID with server timestamp");

  reply = await player.action({ t: "JOIN_ROOM", code, name: "سالم" }, "join1");
  assert(reply.t === "ACK", "player joins with correlated ACK");
  await player.waitFor((message) => message.t === "STATE" && message.view.room.code === code);

  reply = await host.action({ t: "SET_ADMISSION", locked: true }, "lock1");
  assert(reply.t === "ACK", "Host can lock admission");
  await host.waitFor((message) => message.t === "STATE" && message.view.room.admissionLocked === true);

  reply = await fresh.action({ t: "JOIN_ROOM", code, name: "ناصر" }, "fresh1");
  assert(reply.t === "ERROR" && reply.code === "ROOM_LOCKED", "fresh signed identity is blocked by Lobby lock");

  reply = await host.action({ t: "KICK_PLAYER", uid: player.uid }, "kick1");
  assert(reply.t === "ACK", "Host kick is acknowledged");
  await player.waitFor((message) => message.t === "KICKED");
  await host.waitFor((message) =>
    message.t === "STATE" && message.view.blockedPlayers?.some((row) => row.uid === player.uid));

  reply = await player.action({ t: "JOIN_ROOM", code, name: "سالم" }, "rejoinBlocked");
  assert(reply.t === "ERROR" && reply.code === "KICKED", "same kicked UID cannot immediately rejoin");

  reply = await host.action({ t: "UNBLOCK_PLAYER", uid: player.uid }, "unblock1");
  assert(reply.t === "ACK", "Host can explicitly unblock signed identity");
  reply = await host.action({ t: "SET_ADMISSION", locked: false }, "unlock1");
  assert(reply.t === "ACK", "Host can reopen admission");
  reply = await player.action({ t: "JOIN_ROOM", code, name: "سالم" }, "rejoinAllowed");
  assert(reply.t === "ACK", "unblocked identity can be readmitted once admission is open");

  reply = await host.action({ t: "CLOSE_ROOM" }, "close1");
  assert(reply.t === "ACK", "close action receives ACK without client replay");

  host.close();
  player.close();
  fresh.close();
  console.log("TRANSPORT ALL PASSED ✅");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
