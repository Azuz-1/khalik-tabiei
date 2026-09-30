import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { WebSocket } from "ws";
import { createGameServer } from "../src/index.js";
import { config } from "../src/config.js";
import { newSessionToken, readAnonymousSession } from "../src/auth/session.js";
import { Connection } from "../src/net/connection.js";
import { FakeSocket } from "./helpers.js";

test("display epoch pruning reclaims closed rooms without resetting live room revocation", async () => {
  const runtime = createGameServer();
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const create = (name: string) => {
    const cookie = `kt_session=${newSessionToken(config.sessionSecret)}`;
    const session = readAnonymousSession({ headers: { cookie } }, config.sessionSecret)!;
    const conn = new Connection(new FakeSocket() as unknown as WebSocket, origin, "127.0.0.1");
    conn.authenticate(session.uid);
    runtime.manager.register(conn);
    runtime.manager.handle(conn, { t: "CREATE_ROOM", name });
    const code = runtime.manager.roomCodeForUidForTests(session.uid)!;
    return { cookie, conn, code };
  };
  const revoke = async (owner: ReturnType<typeof create>) => {
    const response = await fetch(`${origin}/api/rooms/${owner.code}/display-link`, {
      method: "DELETE", headers: { Cookie: owner.cookie },
    });
    assert.equal(response.status, 204);
  };
  const tokenPath = async (owner: ReturnType<typeof create>) => {
    const response = await fetch(`${origin}/api/rooms/${owner.code}/display-link`, {
      headers: { Cookie: owner.cookie },
    });
    assert.equal(response.status, 200);
    return (await response.json() as { path: string }).path;
  };
  try {
    const live = create("المستمر");
    const closed = create("المنتهي");
    const replacement = create("الجديد");
    await revoke(live);
    await revoke(closed);
    assert.equal(runtime.displayEpochCountForTests(), 2);
    const livePath = await tokenPath(live);
    runtime.manager.handle(closed.conn, { t: "CLOSE_ROOM" });
    assert.equal(runtime.manager.roomForTests(closed.code), undefined);
    await revoke(replacement);
    assert.equal(runtime.displayEpochCountForTests(), 2);
    assert.equal(await tokenPath(live), livePath, "live revocation epoch remains unchanged");
  } finally {
    runtime.dispose();
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
  }
});
