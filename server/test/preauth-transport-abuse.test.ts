import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createGameServer } from "../src/index.js";

test("valid pre-HELLO flood is bounded and policy-closed without mutating rooms", async () => {
  const runtime = createGameServer();
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  const session = await fetch(`http://127.0.0.1:${address.port}/api/session`);
  const cookie = session.headers.get("set-cookie")!.split(";")[0];
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
    headers: { Cookie: cookie, Origin: "http://127.0.0.1:8080" },
  });
  const messages: Array<{ t: string; code?: string }> = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  try {
    await once(ws, "open");
    const closed = once(ws, "close");
    for (let index = 0; index < 200; index++) ws.send(JSON.stringify({ t: "PING" }));
    // A queued valid mutation behind the abuse must remain inert after policy close.
    ws.send(JSON.stringify({ t: "HELLO", protocolVersion: 2 }));
    ws.send(JSON.stringify({ t: "CREATE_ROOM", name: "المهاجم" }));
    const [code] = await closed;
    assert.equal(code, 1008);
    assert.equal(messages.filter((m) => m.code === "UNAUTHORIZED").length, 80);
    assert.equal(messages.filter((m) => m.code === "RATE_LIMITED").length, 3);
    assert.equal(messages.length, 83);
    assert.equal(runtime.manager.roomCount, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(runtime.capacity.active, 0);
  } finally {
    ws.terminate();
    runtime.dispose();
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
  }
});
