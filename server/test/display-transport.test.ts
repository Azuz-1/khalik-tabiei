import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket, type RawData } from "ws";
import type { ClientMessage, ServerMessage } from "../../shared/types.js";
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

async function open(url: string, origin: string, cookie?: string): Promise<WebSocket> {
  const ws = new WebSocket(url, { headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
  await once(ws, "open");
  return ws;
}

function tokenFromPath(path: string, origin: string): string {
  const url = new URL(path, origin);
  assert.equal(url.search, "", "display capability must not appear in the HTTP query");
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  assert.ok(token);
  return token;
}

async function expectDisplayWriteRejected(ws: WebSocket, message: ClientMessage & { rid: string }) {
  const responsePromise = nextMessage(ws);
  ws.send(JSON.stringify(message));
  const response = await responsePromise;
  assert.deepEqual(response, {
    t: "ERROR",
    code: "UNAUTHORIZED",
    message: "display connection is read-only",
    rid: message.rid,
  });
}

test("display transport is owner-issued, aliased, single-slot, revocable, sessionless, and read-only", async () => {
  const runtime = createGameServer();
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("test server address missing");
  const origin = `http://127.0.0.1:${address.port}`;
  const browserOrigin = "http://127.0.0.1:8080";
  const wsOrigin = `ws://127.0.0.1:${address.port}`;
  let owner: WebSocket | undefined;
  let display: WebSocket | undefined;
  let secondDisplay: WebSocket | undefined;
  let rejectedDisplay: WebSocket | undefined;
  let rotatedDisplay: WebSocket | undefined;

  try {
    const unauthenticatedLink = await fetch(`${origin}/api/rooms/ABCDE/display-link`);
    assert.equal(unauthenticatedLink.status, 401);

    const bootstrap = await fetch(`${origin}/api/session`);
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    owner = await open(`${wsOrigin}/ws`, browserOrigin, cookie);
    const ownerHello = nextMessage(owner);
    owner.send(JSON.stringify({ t: "HELLO", protocolVersion: 2 }));
    assert.equal((await ownerHello).t, "HELLO_OK");

    const roomCreated = nextMessage(owner);
    owner.send(JSON.stringify({ t: "CREATE_ROOM", name: "المالك" }));
    const created = await roomCreated;
    assert.equal(created.t, "STATE");
    if (created.t !== "STATE") throw new Error("room state missing");
    const code = created.view.room.code;
    const realOwnerUid = created.view.self.uid;

    const outsiderBootstrap = await fetch(`${origin}/api/session`);
    const outsiderCookie = outsiderBootstrap.headers.get("set-cookie")?.split(";")[0];
    assert.ok(outsiderCookie);
    const forbiddenLink = await fetch(`${origin}/api/rooms/${code}/display-link`, { headers: { Cookie: outsiderCookie } });
    assert.equal(forbiddenLink.status, 404, "an authenticated non-owner must not learn that the room exists");
    assert.deepEqual(await forbiddenLink.json(), { ok: false, code: "ROOM_NOT_FOUND" });

    const missingLink = await fetch(`${origin}/api/rooms/ZZZZZ/display-link`, { headers: { Cookie: outsiderCookie } });
    assert.equal(missingLink.status, 404);
    assert.deepEqual(await missingLink.json(), { ok: false, code: "ROOM_NOT_FOUND" });

    const linkResponse = await fetch(`${origin}/api/rooms/${code}/display-link`, { headers: { Cookie: cookie } });
    assert.equal(linkResponse.status, 200);
    const linkBody = await linkResponse.json() as { path?: string };
    assert.ok(linkBody.path);
    const token = tokenFromPath(linkBody.path, origin);

    const displayWsUrl = `${wsOrigin}/ws?mode=display&code=${encodeURIComponent(code)}`;
    assert.equal(displayWsUrl.includes("token="), false, "display capability must not appear in the WebSocket URL");
    assert.equal(displayWsUrl.includes(token), false, "display capability must not be embedded in the WebSocket URL");

    rejectedDisplay = await open(displayWsUrl, browserOrigin);
    const rejectedHelloMessage = nextMessage(rejectedDisplay);
    const rejectedClosed = once(rejectedDisplay, "close");
    rejectedDisplay.send(JSON.stringify({ t: "HELLO", protocolVersion: 2 }));
    const rejectedHello = await rejectedHelloMessage;
    assert.equal(rejectedHello.t, "ERROR");
    if (rejectedHello.t !== "ERROR") throw new Error("display authentication error missing");
    assert.equal(rejectedHello.code, "UNAUTHORIZED");
    await rejectedClosed;
    rejectedDisplay = undefined;

    display = await open(displayWsUrl, browserOrigin);
    const displayStateMessage = nextMessage(display);
    display.send(JSON.stringify({ t: "HELLO", protocolVersion: 2, displayToken: token }));
    const publicState = await displayStateMessage;
    assert.equal(publicState.t, "STATE");
    if (publicState.t !== "STATE") throw new Error("display state missing");
    assert.equal(publicState.view.self.role, "spectator");
    assert.equal(publicState.view.self.isOwner, false);
    assert.equal(publicState.view.self.uid, "display");
    assert.equal(publicState.view.players.length, 1);
    assert.equal(publicState.view.myPrompt, undefined);
    assert.equal(publicState.view.isImpostor, undefined);
    assert.equal(publicState.view.voteTargets, undefined);
    assert.equal(publicState.view.settingsEditable, undefined);
    assert.equal(publicState.view.blockedPlayers, undefined);
    assert.equal(publicState.view.readyRecovery, undefined);
    assert.equal(JSON.stringify(publicState.view).includes(realOwnerUid), false, "Display STATE must not contain real participant uid");
    assert.match(publicState.view.players[0]!.uid, /^d_[A-Za-z0-9_-]{16}$/);
    assert.match(publicState.view.room.hostUid, /^d_[A-Za-z0-9_-]{16}$/);

    secondDisplay = await open(displayWsUrl, browserOrigin);
    const secondResponse = nextMessage(secondDisplay);
    const secondClosed = once(secondDisplay, "close");
    secondDisplay.send(JSON.stringify({ t: "HELLO", protocolVersion: 2, displayToken: token }));
    const inUse = await secondResponse;
    assert.equal(inUse.t, "ERROR");
    if (inUse.t !== "ERROR") throw new Error("second display rejection missing");
    assert.equal(inUse.code, "DISPLAY_IN_USE");
    await secondClosed;
    secondDisplay = undefined;

    const writeAttempts: Array<ClientMessage & { rid: string }> = [
      { t: "MARK_READY", rid: "display-ready" },
      { t: "SUBMIT_VOTE", targetUid: realOwnerUid, rid: "display-vote" },
      { t: "SET_SETTINGS", totalRounds: 6, rid: "display-settings" },
      { t: "REDEAL_CHALLENGE", rid: "display-redeal" },
      { t: "NEXT_ROUND", rid: "display-next" },
      { t: "CLOSE_ROOM", rid: "display-close" },
    ];
    for (const message of writeAttempts) await expectDisplayWriteRejected(display, message);

    const revokedMessage = nextMessage(display);
    const displayClosed = once(display, "close");
    const revokeResponse = await fetch(`${origin}/api/rooms/${code}/display-link`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    assert.equal(revokeResponse.status, 204);
    const revoked = await revokedMessage;
    assert.equal(revoked.t, "ROOM_CLOSED");
    if (revoked.t !== "ROOM_CLOSED") throw new Error("display revocation close message missing");
    assert.equal(revoked.reason, "display_revoked");
    await displayClosed;
    display = undefined;

    rejectedDisplay = await open(displayWsUrl, browserOrigin);
    const oldTokenResponse = nextMessage(rejectedDisplay);
    const oldTokenClosed = once(rejectedDisplay, "close");
    rejectedDisplay.send(JSON.stringify({ t: "HELLO", protocolVersion: 2, displayToken: token }));
    const oldTokenRejected = await oldTokenResponse;
    assert.equal(oldTokenRejected.t, "ERROR");
    if (oldTokenRejected.t !== "ERROR") throw new Error("old token rejection missing");
    assert.equal(oldTokenRejected.code, "UNAUTHORIZED");
    await oldTokenClosed;
    rejectedDisplay = undefined;

    const rotatedLinkResponse = await fetch(`${origin}/api/rooms/${code}/display-link`, { headers: { Cookie: cookie } });
    assert.equal(rotatedLinkResponse.status, 200);
    const rotatedBody = await rotatedLinkResponse.json() as { path?: string };
    assert.ok(rotatedBody.path);
    const rotatedToken = tokenFromPath(rotatedBody.path, origin);
    assert.notEqual(rotatedToken, token, "revocation must rotate the effective capability");

    rotatedDisplay = await open(displayWsUrl, browserOrigin);
    const rotatedStateMessage = nextMessage(rotatedDisplay);
    rotatedDisplay.send(JSON.stringify({ t: "HELLO", protocolVersion: 2, displayToken: rotatedToken }));
    const rotatedState = await rotatedStateMessage;
    assert.equal(rotatedState.t, "STATE");

    const rotatedClosed = once(rotatedDisplay, "close");
    rotatedDisplay.close();
    await rotatedClosed;
    rotatedDisplay = undefined;

    const room = runtime.manager.roomForTests(code);
    assert.ok(room);
    assert.equal(room.hostConnected, true, "closing/revoking a display must not disconnect or pause the owner/player");
    assert.equal(room.players.get(realOwnerUid)?.connected, true);
  } finally {
    try { rejectedDisplay?.terminate(); } catch { /* ignore */ }
    try { secondDisplay?.terminate(); } catch { /* ignore */ }
    try { rotatedDisplay?.terminate(); } catch { /* ignore */ }
    try { display?.terminate(); } catch { /* ignore */ }
    try { owner?.terminate(); } catch { /* ignore */ }
    runtime.dispose();
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
  }
});
