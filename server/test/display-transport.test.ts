import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket, type RawData } from "ws";
import type { ServerMessage } from "../../shared/types.js";
import { createGameServer } from "../src/index.js";

function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData) => {
      cleanup();
      try { resolve(JSON.parse(data.toString()) as ServerMessage); }
      catch (error) { reject(error); }
    };
    const onClose = () => { cleanup(); reject(new Error("socket closed before message")); };
    const cleanup = () => {
      ws.off("message", onMessage);
      ws.off("close", onClose);
    };
    ws.on("message", onMessage);
    ws.on("close", onClose);
  });
}

function nextMessages(ws: WebSocket, count: number): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ServerMessage[] = [];
    const onMessage = (data: RawData) => {
      try {
        messages.push(JSON.parse(data.toString()) as ServerMessage);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (messages.length >= count) {
        cleanup();
        resolve(messages);
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`socket closed after ${messages.length}/${count} messages`));
    };
    const cleanup = () => {
      ws.off("message", onMessage);
      ws.off("close", onClose);
    };
    ws.on("message", onMessage);
    ws.on("close", onClose);
  });
}

async function open(url: string, origin: string, cookie?: string): Promise<WebSocket> {
  const ws = new WebSocket(url, { headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
  await once(ws, "open");
  return ws;
}

test("display link is owner-only and display socket is sessionless, spectator-only, and read-only", async () => {
  const runtime = createGameServer();
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("test server address missing");
  const origin = `http://127.0.0.1:${address.port}`;
  const wsOrigin = `ws://127.0.0.1:${address.port}`;
  let owner: WebSocket | undefined;
  let display: WebSocket | undefined;
  let rejectedDisplay: WebSocket | undefined;

  try {
    const unauthenticatedLink = await fetch(`${origin}/api/rooms/ABCDE/display-link`);
    assert.equal(unauthenticatedLink.status, 401);

    const bootstrap = await fetch(`${origin}/api/session`);
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    owner = await open(`${wsOrigin}/ws`, origin, cookie);
    const ownerHello = nextMessage(owner);
    owner.send(JSON.stringify({ t: "HELLO", protocolVersion: 2 }));
    assert.equal((await ownerHello).t, "HELLO_OK");

    const roomCreated = nextMessage(owner);
    owner.send(JSON.stringify({ t: "CREATE_ROOM", name: "المالك" }));
    const created = await roomCreated;
    assert.equal(created.t, "STATE");
    if (created.t !== "STATE") throw new Error("room state missing");
    const code = created.view.room.code;

    const linkResponse = await fetch(`${origin}/api/rooms/${code}/display-link`, { headers: { Cookie: cookie } });
    assert.equal(linkResponse.status, 200);
    const linkBody = await linkResponse.json() as { path?: string };
    assert.ok(linkBody.path);
    const displayHttpUrl = new URL(linkBody.path, origin);
    assert.equal(displayHttpUrl.search, "", "display capability must not appear in the HTTP query");
    const token = new URLSearchParams(displayHttpUrl.hash.slice(1)).get("token");
    assert.ok(token);

    const displayWsUrl = `${wsOrigin}/ws?mode=display&code=${encodeURIComponent(code)}`;
    assert.equal(displayWsUrl.includes("token="), false, "display capability must not appear in the WebSocket URL");
    assert.equal(displayWsUrl.includes(token), false, "display capability must not be embedded in the WebSocket URL");

    rejectedDisplay = await open(displayWsUrl, origin);
    const rejectedHelloMessage = nextMessage(rejectedDisplay);
    const rejectedClosed = once(rejectedDisplay, "close");
    rejectedDisplay.send(JSON.stringify({ t: "HELLO", protocolVersion: 2 }));
    const rejectedHello = await rejectedHelloMessage;
    assert.equal(rejectedHello.t, "ERROR");
    if (rejectedHello.t !== "ERROR") throw new Error("display authentication error missing");
    assert.equal(rejectedHello.code, "UNAUTHORIZED");
    await rejectedClosed;
    rejectedDisplay = undefined;

    display = await open(displayWsUrl, origin);
    const displayAuth = nextMessages(display, 2);
    display.send(JSON.stringify({ t: "HELLO", protocolVersion: 2, displayToken: token }));
    const [displayHello, publicState] = await displayAuth;
    assert.equal(displayHello?.t, "HELLO_OK");
    assert.equal(publicState?.t, "STATE");
    if (!publicState || publicState.t !== "STATE") throw new Error("display state missing");
    assert.equal(publicState.view.self.role, "spectator");
    assert.equal(publicState.view.self.isOwner, false);
    assert.equal(publicState.view.players.length, 1);
    assert.equal(publicState.view.myPrompt, undefined);
    assert.equal(publicState.view.isImpostor, undefined);
    assert.equal(publicState.view.voteTargets, undefined);
    assert.equal(publicState.view.settingsEditable, undefined);
    assert.equal(publicState.view.blockedPlayers, undefined);

    const rejectedWrite = nextMessage(display);
    display.send(JSON.stringify({ t: "START_GAME", rid: "display-write" }));
    const rejected = await rejectedWrite;
    assert.deepEqual(rejected, {
      t: "ERROR",
      code: "UNAUTHORIZED",
      message: "display connection is read-only",
      rid: "display-write",
    });

    const displayClosed = once(display, "close");
    display.close();
    await displayClosed;
    const room = runtime.manager.roomForTests(code);
    assert.ok(room);
    assert.equal(room.hostConnected, true, "closing the display must not disconnect or pause the owner/player");
    assert.equal(room.players.get(created.view.self.uid)?.connected, true);
  } finally {
    try { rejectedDisplay?.terminate(); } catch { /* ignore */ }
    try { display?.terminate(); } catch { /* ignore */ }
    try { owner?.terminate(); } catch { /* ignore */ }
    runtime.dispose();
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
  }
});
