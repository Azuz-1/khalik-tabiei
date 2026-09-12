import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket, type RawData } from "ws";
import type { ServerMessage } from "../../shared/types.js";
import { config } from "../src/config.js";
import { verifyDisplayToken } from "../src/game/display.js";
import { DisplayPairingRegistry } from "../src/game/displayPairing.js";
import { createGameServer } from "../src/index.js";

interface PairingBody {
  ok: true;
  id: string;
  code: string;
  secret: string;
  expiresAt: number;
}

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

function deterministicRegistry(codes: number[], now: () => number = Date.now, ttlMs = 5 * 60_000) {
  let id = 0;
  let secret = 0;
  return new DisplayPairingRegistry({
    now,
    ttlMs,
    randomCode: () => codes.shift() ?? 999999,
    createId: () => `pair-${++id}`,
    createSecret: () => `tv-secret-${String(++secret).padStart(32, "0")}`,
  });
}

async function startRuntime(registry = deterministicRegistry([])) {
  const runtime = createGameServer({ displayPairings: registry });
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("test server address missing");
  return {
    runtime,
    origin: `http://127.0.0.1:${address.port}`,
    wsOrigin: `ws://127.0.0.1:${address.port}`,
    browserOrigin: "http://127.0.0.1:8080",
  };
}

async function stopRuntime(runtime: ReturnType<typeof createGameServer>): Promise<void> {
  runtime.dispose();
  if (!runtime.server.listening) return;
  await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
}

async function bootstrap(origin: string): Promise<string> {
  const response = await fetch(`${origin}/api/session`);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

async function createOwnerRoom(
  runtime: ReturnType<typeof createGameServer>,
  origin: string,
  wsOrigin: string,
  browserOrigin: string,
  name: string,
) {
  const cookie = await bootstrap(origin);
  const ws = await open(`${wsOrigin}/ws`, browserOrigin, cookie);
  const hello = nextMessage(ws);
  ws.send(JSON.stringify({ t: "HELLO", protocolVersion: 2 }));
  assert.equal((await hello).t, "HELLO_OK");
  const createdMessage = nextMessage(ws);
  ws.send(JSON.stringify({ t: "CREATE_ROOM", name }));
  const created = await createdMessage;
  assert.equal(created.t, "STATE");
  if (created.t !== "STATE") throw new Error("room state missing");
  const code = created.view.room.code;
  const room = runtime.manager.roomForTests(code);
  assert.ok(room);
  return { cookie, ws, code, uid: created.view.self.uid, room };
}

async function createPairing(origin: string): Promise<PairingBody> {
  const response = await fetch(`${origin}/api/display-pairings`, { method: "POST" });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json() as PairingBody;
  assert.equal(body.ok, true);
  assert.match(body.id, /^pair-/);
  assert.match(body.code, /^[0-9]{6}$/u);
  assert.ok(body.secret.length >= 32);
  return body;
}

async function claim(origin: string, roomCode: string, cookie: string | undefined, pairingCode: string) {
  return fetch(`${origin}/api/rooms/${encodeURIComponent(roomCode)}/display-pairings/claim`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ pairingCode }),
  });
}

async function status(origin: string, pairing: PairingBody, secret = pairing.secret) {
  return fetch(`${origin}/api/display-pairings/${encodeURIComponent(pairing.id)}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
  });
}

test("TV pairing creation is sessionless, room-free, no-store, and pending status requires the TV secret", async () => {
  const { runtime, origin } = await startRuntime(deterministicRegistry([111111]));
  try {
    const pairing = await createPairing(origin);
    assert.equal(pairing.code, "111111");
    const serialized = JSON.stringify(pairing);
    assert.equal(serialized.includes("roomCode"), false);
    assert.equal(serialized.includes("hostUid"), false);
    assert.equal(serialized.includes("displayToken"), false);

    const pending = await status(origin, pairing);
    assert.equal(pending.status, 200);
    assert.equal(pending.headers.get("cache-control"), "no-store");
    assert.deepEqual(await pending.json(), { ok: true, status: "pending", expiresAt: pairing.expiresAt });

    const wrong = await status(origin, pairing, "wrong-secret-wrong-secret");
    const missing = await fetch(`${origin}/api/display-pairings/does-not-exist`, {
      headers: { Authorization: "Bearer wrong-secret-wrong-secret" },
    });
    assert.equal(wrong.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(await wrong.json(), await missing.json(), "wrong secret and missing pairing share one generic failure");
  } finally {
    await stopRuntime(runtime);
  }
});

test("only the authoritative owner can claim and the returned capability verifies for that exact room", async () => {
  const { runtime, origin, wsOrigin, browserOrigin } = await startRuntime(deterministicRegistry([222222]));
  let owner: WebSocket | undefined;
  try {
    const room = await createOwnerRoom(runtime, origin, wsOrigin, browserOrigin, "مالك أ");
    owner = room.ws;
    const pairing = await createPairing(origin);

    const anonymous = await claim(origin, room.code, undefined, pairing.code);
    assert.equal(anonymous.status, 401);

    const outsiderCookie = await bootstrap(origin);
    const outsider = await claim(origin, room.code, outsiderCookie, pairing.code);
    assert.equal(outsider.status, 404);
    assert.deepEqual(await outsider.json(), { ok: false, code: "ROOM_NOT_FOUND" });

    const malformedRoom = await claim(origin, "@@@", room.cookie, pairing.code);
    assert.equal(malformedRoom.status, 404);
    assert.deepEqual(await malformedRoom.json(), { ok: false, code: "ROOM_NOT_FOUND" });

    const badPairing = await claim(origin, room.code, room.cookie, "12x");
    assert.equal(badPairing.status, 400);
    assert.deepEqual(await badPairing.json(), { ok: false, code: "PAIRING_UNAVAILABLE" });

    const claimed = await claim(origin, room.code, room.cookie, "222 222");
    assert.equal(claimed.status, 200);
    assert.deepEqual(await claimed.json(), { ok: true });

    const claimedStatus = await status(origin, pairing);
    assert.equal(claimedStatus.status, 200);
    const body = await claimedStatus.json() as {
      status?: string;
      roomCode?: string;
      displayToken?: string;
      expiresAt?: number;
    };
    assert.equal(body.status, "claimed");
    assert.equal(body.roomCode, room.code);
    assert.ok(body.displayToken);
    assert.equal(body.expiresAt, pairing.expiresAt);
    assert.equal(verifyDisplayToken(room.room, config.sessionSecret, body.displayToken, 0), true);
  } finally {
    try { owner?.terminate(); } catch { /* ignore */ }
    await stopRuntime(runtime);
  }
});

test("two simultaneous houses pair independently and one TV cannot cross-link or rebind", async () => {
  const { runtime, origin, wsOrigin, browserOrigin } = await startRuntime(deterministicRegistry([111111, 222222]));
  let ownerA: WebSocket | undefined;
  let ownerB: WebSocket | undefined;
  try {
    const roomA = await createOwnerRoom(runtime, origin, wsOrigin, browserOrigin, "مالك أ");
    const roomB = await createOwnerRoom(runtime, origin, wsOrigin, browserOrigin, "مالك ب");
    ownerA = roomA.ws;
    ownerB = roomB.ws;
    const tvA = await createPairing(origin);
    const tvB = await createPairing(origin);
    assert.equal(tvA.code, "111111");
    assert.equal(tvB.code, "222222");

    assert.equal((await claim(origin, roomA.code, roomA.cookie, tvA.code)).status, 200);
    assert.equal((await claim(origin, roomB.code, roomB.cookie, tvB.code)).status, 200);
    const rebound = await claim(origin, roomB.code, roomB.cookie, tvA.code);
    assert.equal(rebound.status, 400, "a claimed TV pairing cannot be rebound to another room");

    const bodyA = await (await status(origin, tvA)).json() as { roomCode?: string; displayToken?: string };
    const bodyB = await (await status(origin, tvB)).json() as { roomCode?: string; displayToken?: string };
    assert.equal(bodyA.roomCode, roomA.code);
    assert.equal(bodyB.roomCode, roomB.code);
    assert.ok(bodyA.displayToken);
    assert.ok(bodyB.displayToken);
    assert.equal(verifyDisplayToken(roomA.room, config.sessionSecret, bodyA.displayToken, 0), true);
    assert.equal(verifyDisplayToken(roomB.room, config.sessionSecret, bodyB.displayToken, 0), true);
    assert.equal(verifyDisplayToken(roomB.room, config.sessionSecret, bodyA.displayToken, 0), false);
    assert.equal(verifyDisplayToken(roomA.room, config.sessionSecret, bodyB.displayToken, 0), false);
  } finally {
    try { ownerA?.terminate(); } catch { /* ignore */ }
    try { ownerB?.terminate(); } catch { /* ignore */ }
    await stopRuntime(runtime);
  }
});

test("ownership, room incarnation, and display epoch changes invalidate stale pairings", async () => {
  const { runtime, origin, wsOrigin, browserOrigin } = await startRuntime(deterministicRegistry([300001, 300002, 300003]));
  let owner: WebSocket | undefined;
  try {
    const current = await createOwnerRoom(runtime, origin, wsOrigin, browserOrigin, "مالك");
    owner = current.ws;

    const ownershipPairing = await createPairing(origin);
    assert.equal((await claim(origin, current.code, current.cookie, ownershipPairing.code)).status, 200);
    const originalHost = current.room.hostUid;
    current.room.hostUid = "replacement-owner";
    assert.equal((await status(origin, ownershipPairing)).status, 404, "ownership transfer invalidates binding");
    current.room.hostUid = originalHost;

    const incarnationPairing = await createPairing(origin);
    assert.equal((await claim(origin, current.code, current.cookie, incarnationPairing.code)).status, 200);
    const originalCreatedAt = current.room.createdAt;
    current.room.createdAt = originalCreatedAt + 1;
    assert.equal((await status(origin, incarnationPairing)).status, 404, "room-code reuse/new incarnation cannot revive pairing");
    current.room.createdAt = originalCreatedAt;

    const epochPairing = await createPairing(origin);
    assert.equal((await claim(origin, current.code, current.cookie, epochPairing.code)).status, 200);
    const revoke = await fetch(`${origin}/api/rooms/${current.code}/display-link`, {
      method: "DELETE",
      headers: { Cookie: current.cookie },
    });
    assert.equal(revoke.status, 204);
    assert.equal((await status(origin, epochPairing)).status, 404, "epoch rotation must not silently upgrade a stale pairing");
  } finally {
    try { owner?.terminate(); } catch { /* ignore */ }
    await stopRuntime(runtime);
  }
});

test("an already active Display makes a new host pairing claim fail before binding", async () => {
  const { runtime, origin, wsOrigin, browserOrigin } = await startRuntime(deterministicRegistry([400001, 400002]));
  let owner: WebSocket | undefined;
  let display: WebSocket | undefined;
  try {
    const current = await createOwnerRoom(runtime, origin, wsOrigin, browserOrigin, "مالك");
    owner = current.ws;
    const first = await createPairing(origin);
    assert.equal((await claim(origin, current.code, current.cookie, first.code)).status, 200);
    const firstStatus = await status(origin, first);
    const firstBody = await firstStatus.json() as { displayToken?: string };
    assert.ok(firstBody.displayToken);

    display = await open(`${wsOrigin}/ws?mode=display&code=${encodeURIComponent(current.code)}`, browserOrigin);
    const displayState = nextMessage(display);
    display.send(JSON.stringify({
      t: "HELLO",
      protocolVersion: 2,
      displayToken: firstBody.displayToken,
      displayClientId: "dc_pairing_active_01",
    }));
    assert.equal((await displayState).t, "STATE");

    const second = await createPairing(origin);
    const secondClaim = await claim(origin, current.code, current.cookie, second.code);
    assert.equal(secondClaim.status, 409);
    assert.deepEqual(await secondClaim.json(), { ok: false, code: "DISPLAY_IN_USE" });
    const secondStatus = await status(origin, second);
    assert.equal(secondStatus.status, 200);
    assert.deepEqual(await secondStatus.json(), { ok: true, status: "pending", expiresAt: second.expiresAt });
  } finally {
    try { display?.terminate(); } catch { /* ignore */ }
    try { owner?.terminate(); } catch { /* ignore */ }
    await stopRuntime(runtime);
  }
});

test("two pending TVs may receive the same room epoch, but only one distinct Display can become active", async () => {
  const { runtime, origin, wsOrigin, browserOrigin } = await startRuntime(deterministicRegistry([410001, 410002]));
  let owner: WebSocket | undefined;
  let displayA: WebSocket | undefined;
  let displayB: WebSocket | undefined;
  let staleA: WebSocket | undefined;
  let staleB: WebSocket | undefined;
  try {
    const current = await createOwnerRoom(runtime, origin, wsOrigin, browserOrigin, "مالك");
    owner = current.ws;
    const tvA = await createPairing(origin);
    const tvB = await createPairing(origin);

    assert.equal((await claim(origin, current.code, current.cookie, tvA.code)).status, 200);
    assert.equal((await claim(origin, current.code, current.cookie, tvB.code)).status, 200);

    const bodyA = await (await status(origin, tvA)).json() as { roomCode?: string; displayToken?: string };
    const bodyB = await (await status(origin, tvB)).json() as { roomCode?: string; displayToken?: string };
    assert.equal(bodyA.roomCode, current.code);
    assert.equal(bodyB.roomCode, current.code);
    assert.ok(bodyA.displayToken);
    assert.ok(bodyB.displayToken);
    assert.equal(verifyDisplayToken(current.room, config.sessionSecret, bodyA.displayToken, 0), true);
    assert.equal(verifyDisplayToken(current.room, config.sessionSecret, bodyB.displayToken, 0), true);

    const displayUrl = `${wsOrigin}/ws?mode=display&code=${encodeURIComponent(current.code)}`;
    displayA = await open(displayUrl, browserOrigin);
    const publicStateMessage = nextMessage(displayA);
    displayA.send(JSON.stringify({
      t: "HELLO",
      protocolVersion: 2,
      displayToken: bodyA.displayToken,
      displayClientId: "dc_pairing_race_a_01",
    }));
    const publicState = await publicStateMessage;
    assert.equal(publicState.t, "STATE");
    if (publicState.t !== "STATE") throw new Error("paired display state missing");
    assert.equal(publicState.view.self.role, "spectator");
    assert.equal(publicState.view.self.isOwner, false);
    assert.equal(publicState.view.myPrompt, undefined);
    assert.equal(publicState.view.isImpostor, undefined);
    assert.equal(publicState.view.voteTargets, undefined);
    assert.equal(JSON.stringify(publicState.view).includes(current.uid), false, "TV projection must not contain the real owner uid");

    displayB = await open(displayUrl, browserOrigin);
    const rejectedMessage = nextMessage(displayB);
    const displayBClosed = once(displayB, "close");
    displayB.send(JSON.stringify({
      t: "HELLO",
      protocolVersion: 2,
      displayToken: bodyB.displayToken,
      displayClientId: "dc_pairing_race_b_02",
    }));
    const rejected = await rejectedMessage;
    assert.equal(rejected.t, "ERROR");
    if (rejected.t !== "ERROR") throw new Error("second paired display rejection missing");
    assert.equal(rejected.code, "DISPLAY_IN_USE");
    await displayBClosed;
    displayB = undefined;

    const revokedMessage = nextMessage(displayA);
    const displayAClosed = once(displayA, "close");
    const revoke = await fetch(`${origin}/api/rooms/${current.code}/display-link`, {
      method: "DELETE",
      headers: { Cookie: current.cookie },
    });
    assert.equal(revoke.status, 204);
    const revoked = await revokedMessage;
    assert.equal(revoked.t, "ROOM_CLOSED");
    if (revoked.t !== "ROOM_CLOSED") throw new Error("paired display revocation missing");
    assert.equal(revoked.reason, "display_revoked");
    await displayAClosed;
    displayA = undefined;

    assert.equal((await status(origin, tvA)).status, 404, "revocation invalidates pairing A's old epoch");
    assert.equal((await status(origin, tvB)).status, 404, "revocation invalidates pairing B's old epoch");

    for (const [token, clientId] of [
      [bodyA.displayToken, "dc_pairing_stale_a_03"],
      [bodyB.displayToken, "dc_pairing_stale_b_04"],
    ] as const) {
      const ws = await open(displayUrl, browserOrigin);
      if (clientId.endsWith("03")) staleA = ws;
      else staleB = ws;
      const responseMessage = nextMessage(ws);
      const closed = once(ws, "close");
      ws.send(JSON.stringify({ t: "HELLO", protocolVersion: 2, displayToken: token, displayClientId: clientId }));
      const response = await responseMessage;
      assert.equal(response.t, "ERROR");
      if (response.t !== "ERROR") throw new Error("stale paired display rejection missing");
      assert.equal(response.code, "UNAUTHORIZED");
      await closed;
      if (clientId.endsWith("03")) staleA = undefined;
      else staleB = undefined;
    }
  } finally {
    try { staleB?.terminate(); } catch { /* ignore */ }
    try { staleA?.terminate(); } catch { /* ignore */ }
    try { displayB?.terminate(); } catch { /* ignore */ }
    try { displayA?.terminate(); } catch { /* ignore */ }
    try { owner?.terminate(); } catch { /* ignore */ }
    await stopRuntime(runtime);
  }
});

test("expired and nonexistent pairing codes share the same owner-facing failure", async () => {
  let now = 1_000;
  const registry = deterministicRegistry([500001], () => now, 100);
  const { runtime, origin, wsOrigin, browserOrigin } = await startRuntime(registry);
  let owner: WebSocket | undefined;
  try {
    const current = await createOwnerRoom(runtime, origin, wsOrigin, browserOrigin, "مالك");
    owner = current.ws;
    const pairing = await createPairing(origin);
    now = pairing.expiresAt;
    const expired = await claim(origin, current.code, current.cookie, pairing.code);
    const nonexistent = await claim(origin, current.code, current.cookie, "999998");
    assert.equal(expired.status, 400);
    assert.equal(nonexistent.status, 400);
    assert.deepEqual(await expired.json(), await nonexistent.json());
    assert.equal((await status(origin, pairing)).status, 404);
  } finally {
    try { owner?.terminate(); } catch { /* ignore */ }
    await stopRuntime(runtime);
  }
});

test("claim brute-force limit actually triggers per authenticated owner identity", async () => {
  const { runtime, origin, wsOrigin, browserOrigin } = await startRuntime(deterministicRegistry([]));
  let owner: WebSocket | undefined;
  try {
    const current = await createOwnerRoom(runtime, origin, wsOrigin, browserOrigin, "مالك");
    owner = current.ws;
    const limit = config.abuseLimits.displayPairingClaimIdentity.limit;
    for (let attempt = 0; attempt < limit; attempt += 1) {
      const response = await claim(origin, current.code, current.cookie, "888888");
      assert.equal(response.status, 400, `attempt ${attempt + 1} should reach generic pairing rejection`);
    }
    const limited = await claim(origin, current.code, current.cookie, "888888");
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { ok: false, code: "RATE_LIMITED" });
  } finally {
    try { owner?.terminate(); } catch { /* ignore */ }
    await stopRuntime(runtime);
  }
});

test("pairing creation is disabled during drain and claim accepts JSON only", async () => {
  const { runtime, origin, wsOrigin, browserOrigin } = await startRuntime(deterministicRegistry([600001]));
  let owner: WebSocket | undefined;
  try {
    const current = await createOwnerRoom(runtime, origin, wsOrigin, browserOrigin, "مالك");
    owner = current.ws;
    const pairing = await createPairing(origin);
    const wrongType = await fetch(`${origin}/api/rooms/${current.code}/display-pairings/claim`, {
      method: "POST",
      headers: { Cookie: current.cookie, "Content-Type": "text/plain" },
      body: pairing.code,
    });
    assert.equal(wrongType.status, 415);

    runtime.beginDrain(30_000);
    const creation = await fetch(`${origin}/api/display-pairings`, { method: "POST" });
    assert.equal(creation.status, 503);
    assert.deepEqual(await creation.json(), { ok: false, code: "SERVER_RESTARTING" });
  } finally {
    try { owner?.terminate(); } catch { /* ignore */ }
    await stopRuntime(runtime);
  }
});
