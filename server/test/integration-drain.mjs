import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const PORT = 8091;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const TIMEOUT_MS = 8_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log("  ✓", message);
}

async function waitUntil(predicate, label) {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out: ${label}`);
}

async function openSocket(cookie) {
  const socket = new WebSocket(WS_URL, { headers: { Cookie: cookie, Origin: ORIGIN } });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

async function main() {
  console.log("Graceful drain real-process suite");
  const child = spawn(process.execPath, ["server/dist/server/src/index.js"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(PORT),
      PUBLIC_ORIGIN: ORIGIN,
      SESSION_SECRET: "drain-integration-secret-0123456789-abcdef",
      DRAIN_TIMEOUT_MS: "700",
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    await waitUntil(async () => {
      try { return (await fetch(`${ORIGIN}/readyz`)).status === 200; } catch { return false; }
    }, "server readiness");

    const session = await fetch(`${ORIGIN}/api/session`);
    assert(session.ok, "session bootstrap works before drain");
    const cookie = session.headers.get("set-cookie")?.split(";", 1)[0];
    if (!cookie) throw new Error("missing session cookie");

    // Complete an HTTP upgrade before drain but intentionally delay HELLO. This
    // closes the narrow race between accepting /ws and authenticating it.
    const delayedMessages = [];
    const delayedWs = await openSocket(cookie);
    delayedWs.on("message", (data) => delayedMessages.push(JSON.parse(data.toString())));

    const messages = [];
    const ws = await openSocket(cookie);
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ t: "HELLO", protocolVersion: 2 }));
    await waitUntil(() => messages.some((message) => message.t === "HELLO_OK"), "HELLO_OK");
    ws.send(JSON.stringify({ t: "CREATE_ROOM", rid: "before-drain" }));
    await waitUntil(() => messages.some((message) => message.t === "ACK" && message.rid === "before-drain"), "room creation ACK");

    child.kill("SIGTERM");
    await waitUntil(() => messages.some((message) => message.t === "SERVER_RESTARTING"), "restart notification");
    const restart = messages.find((message) => message.t === "SERVER_RESTARTING");
    assert(Number.isFinite(restart.deadlineMs) && restart.deadlineMs > Date.now(), "existing clients receive a future drain deadline");

    const ready = await fetch(`${ORIGIN}/readyz`);
    assert(ready.status === 503, "readiness flips to 503 during drain");
    const health = await fetch(`${ORIGIN}/healthz`);
    assert(health.status === 200, "liveness remains 200 during drain");
    const bootstrapDuringDrain = await fetch(`${ORIGIN}/api/session`, { headers: { Cookie: cookie } });
    assert(bootstrapDuringDrain.status === 503, "session bootstrap is rejected during drain");

    delayedWs.send(JSON.stringify({ t: "HELLO", protocolVersion: 2, rid: "delayed-hello" }));
    await waitUntil(
      () => delayedMessages.some((message) => message.t === "ERROR" && message.rid === "delayed-hello"),
      "delayed HELLO drain rejection",
    );
    const delayedError = delayedMessages.find((message) => message.t === "ERROR" && message.rid === "delayed-hello");
    assert(delayedError.code === "SERVER_RESTARTING", "pre-drain upgraded socket cannot authenticate after drain begins");

    ws.send(JSON.stringify({ t: "START_GAME", rid: "during-drain" }));
    await waitUntil(() => messages.some((message) => message.t === "ERROR" && message.rid === "during-drain"), "drain action rejection");
    const actionError = messages.find((message) => message.t === "ERROR" && message.rid === "during-drain");
    assert(actionError.code === "SERVER_RESTARTING", "new game start is rejected with SERVER_RESTARTING");

    const upgradeStatus = await new Promise((resolve, reject) => {
      const probe = new WebSocket(WS_URL, { headers: { Cookie: cookie, Origin: ORIGIN } });
      const timer = setTimeout(() => reject(new Error("new websocket drain rejection timeout")), 2_000);
      probe.once("unexpected-response", (_request, response) => {
        clearTimeout(timer);
        resolve(response.statusCode);
        response.resume();
      });
      probe.once("open", () => {
        clearTimeout(timer);
        probe.close();
        reject(new Error("new websocket unexpectedly opened during drain"));
      });
      probe.once("error", () => {});
    });
    assert(upgradeStatus === 503, "new WebSocket admission stops during drain");

    const closeCode = await new Promise((resolve) => ws.once("close", (code) => resolve(code)));
    assert(closeCode === 1012, "existing WebSocket closes with service-restart code at deadline");
    const exitCode = await new Promise((resolve) => child.once("exit", (code) => resolve(code)));
    assert(exitCode === 0, "server exits cleanly after drain deadline");
    console.log("DRAIN ALL PASSED ✅");
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    if (stderr) process.stderr.write(stderr);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
