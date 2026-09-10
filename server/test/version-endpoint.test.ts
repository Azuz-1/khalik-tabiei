import { test } from "node:test";
import assert from "node:assert/strict";
import { createGameServer } from "../src/index.js";

test("/version reports the deployed Render commit without caching", async () => {
  const runtime = createGameServer();
  await new Promise<void>((resolve, reject) => {
    runtime.server.once("error", reject);
    runtime.server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = runtime.server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/version`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      sha: process.env.RENDER_GIT_COMMIT?.trim() || "unknown",
    });
  } finally {
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
  }
});
