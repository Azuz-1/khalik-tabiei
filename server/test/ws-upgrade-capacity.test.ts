import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { config } from "../src/config.js";
import { newSessionToken, SESSION_COOKIE } from "../src/auth/session.js";
import { createGameServer } from "../src/index.js";

function malformedUpgrade(port: number, cookie: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(2_000, () => socket.destroy(new Error("malformed upgrade did not close")));
    socket.once("connect", () => {
      socket.write([
        "GET /ws HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        `Cookie: ${cookie}`,
        "",
        "",
      ].join("\r\n"));
    });
    socket.once("error", reject);
    socket.once("close", (hadError) => {
      if (!hadError) resolve();
    });
  });
}

test("malformed WebSocket upgrades release their capacity lease", async () => {
  const runtime = createGameServer();
  await new Promise<void>((resolve, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = runtime.server.address();
    assert.ok(address && typeof address !== "string");
    const cookie = `${SESSION_COOKIE}=${newSessionToken(config.sessionSecret)}`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await malformedUpgrade(address.port, cookie);
      assert.equal(runtime.capacity.active, 0, `attempt ${attempt + 1} leaked a capacity lease`);
      assert.equal(runtime.capacity.activeForIp("127.0.0.1"), 0);
    }
  } finally {
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
  }
});
