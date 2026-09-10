import { test } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { config } from "../src/config.js";
import { newSessionToken, SESSION_COOKIE } from "../src/auth/session.js";
import { createGameServer } from "../src/index.js";

function malformedUpgrade(port: number, cookie: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let response = "";
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(response);
    };

    socket.setEncoding("utf8");
    socket.setTimeout(2_000, () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error("malformed upgrade was not rejected"));
    });
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
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.includes("\r\n\r\n")) finish();
    });
    socket.once("end", finish);
    socket.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

async function waitForCapacityRelease(active: () => number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (active() === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(active(), 0, "capacity lease did not release after the rejected upgrade socket closed");
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
      const response = await malformedUpgrade(address.port, cookie);
      assert.match(response, /^HTTP\/1\.1 400 /, `attempt ${attempt + 1} did not reach ws handshake validation`);
      await waitForCapacityRelease(() => runtime.capacity.active);
      assert.equal(runtime.capacity.activeForIp("127.0.0.1"), 0);
    }
  } finally {
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
  }
});
