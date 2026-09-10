import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AnalyticsEvent } from "../../shared/types.js";
import type { AnalyticsProps } from "../src/analytics.js";
import { ClientTelemetryIngestor } from "../src/clientTelemetry.js";
import { createGameServer } from "../src/index.js";

test("client telemetry endpoint requires a signed session and never forwards identifiers", async () => {
  const recorded: Array<{ event: AnalyticsEvent; props: AnalyticsProps }> = [];
  const clientTelemetry = new ClientTelemetryIngestor((event, props = {}) => { recorded.push({ event, props }); });
  const runtime = createGameServer({ clientTelemetry });
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("test server address missing");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const body = JSON.stringify({
      events: [{
        event: "client_performance",
        props: {
          navigationType: "navigate",
          loadMs: 1234,
          routeBucket: "home",
          uid: "u_private",
          roomCode: "ABCDE",
        },
      }],
    });

    const unauthenticated = await fetch(`${base}/api/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(unauthenticated.status, 401);

    const bootstrap = await fetch(`${base}/api/session`);
    assert.equal(bootstrap.status, 200);
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const accepted = await fetch(`${base}/api/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body,
    });
    assert.equal(accepted.status, 204);
    assert.deepEqual(recorded, [{
      event: "client_performance",
      props: { navigationType: "navigate", loadMs: 1234, routeBucket: "home" },
    }]);
  } finally {
    runtime.dispose();
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
  }
});
