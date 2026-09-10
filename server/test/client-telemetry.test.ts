import test from "node:test";
import assert from "node:assert/strict";
import type { AnalyticsEvent } from "../../shared/types.js";
import { ClientTelemetryIngestor, parseClientTelemetryBatch } from "../src/clientTelemetry.js";
import type { AnalyticsProps } from "../src/analytics.js";

test("client telemetry accepts bounded scalar batches and rejects malformed envelopes", () => {
  const parsed = parseClientTelemetryBatch({
    events: [{
      event: "client_started",
      props: {
        deviceClass: "phone",
        browserFamily: "samsung",
        viewportBucket: "sm",
        touch: true,
      },
    }],
  });
  assert.equal(parsed?.length, 1);
  assert.deepEqual(parsed?.[0]?.props, {
    deviceClass: "phone",
    browserFamily: "samsung",
    viewportBucket: "sm",
    touch: true,
  });

  assert.equal(parseClientTelemetryBatch({ events: [] }), null);
  assert.equal(parseClientTelemetryBatch({ events: [{ event: "game_started", props: {} }] }), null);
  assert.equal(parseClientTelemetryBatch({ events: [{ event: "client_started", props: { nested: { nope: true } } }] }), null);
});

test("client telemetry strips identity, raw user-agent, paths and unknown properties before analytics", () => {
  const recorded: Array<{ event: AnalyticsEvent; props: AnalyticsProps }> = [];
  const ingestor = new ClientTelemetryIngestor((event, props = {}) => { recorded.push({ event, props }); });

  const result = ingestor.ingest("u_transient_rate_limit_only", {
    events: [{
      event: "client_started",
      props: {
        deviceClass: "phone",
        browserFamily: "safari",
        osFamily: "ios",
        routeBucket: "join",
        uid: "u_should_never_store",
        roomCode: "ABCDE",
        userAgent: "raw ua should never store",
        pathname: "/join/ABCDE",
        screenWidthExact: 430,
      },
    }],
  });

  assert.deepEqual(result, { ok: true, count: 1 });
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], {
    event: "client_started",
    props: {
      deviceClass: "phone",
      browserFamily: "safari",
      osFamily: "ios",
      routeBucket: "join",
    },
  });
});

test("client telemetry limits request floods independently of gameplay", () => {
  const ingestor = new ClientTelemetryIngestor(() => {});
  const body = { events: [{ event: "client_error", props: { kind: "runtime", routeBucket: "home", online: true } }] };
  for (let index = 0; index < 30; index += 1) assert.equal(ingestor.ingest("same-session", body).ok, true);
  assert.deepEqual(ingestor.ingest("same-session", body), { ok: false, code: "RATE_LIMITED" });
  assert.equal(ingestor.ingest("different-session", body).ok, true);
});
