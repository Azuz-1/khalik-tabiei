import test from "node:test";
import assert from "node:assert/strict";
import type { AnalyticsEvent } from "../../shared/types.js";
import { analyticsPlayerId, ClientTelemetryIngestor, parseClientTelemetryBatch } from "../src/clientTelemetry.js";
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

test("client telemetry strips raw identity and adds a separate pseudonymous analytics id", () => {
  const recorded: Array<{ event: AnalyticsEvent; props: AnalyticsProps }> = [];
  const ingestor = new ClientTelemetryIngestor((event, props = {}) => { recorded.push({ event, props }); });
  const identity = "u_transient_rate_limit_only";

  const result = ingestor.ingest(identity, {
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
      analyticsPlayerId: analyticsPlayerId(identity),
      deviceClass: "phone",
      browserFamily: "safari",
      osFamily: "ios",
      routeBucket: "join",
    },
  });
  assert.match(String(recorded[0]?.props.analyticsPlayerId), /^ap_[0-9a-f]{32}$/);
  assert.notEqual(recorded[0]?.props.analyticsPlayerId, identity);
  assert.equal(analyticsPlayerId(identity), analyticsPlayerId(identity));
  assert.notEqual(analyticsPlayerId(identity), analyticsPlayerId("u_other"));
});

test("match participation marker keeps only allowlisted aggregate dimensions and server identity", () => {
  const recorded: Array<{ event: AnalyticsEvent; props: AnalyticsProps }> = [];
  const ingestor = new ClientTelemetryIngestor((event, props = {}) => { recorded.push({ event, props }); });

  const result = ingestor.ingest("u_player", {
    events: [{
      event: "client_session_summary",
      props: {
        summaryKind: "match_participation",
        playedMatch: true,
        phase: "QUESTION",
        isOwner: false,
        playerCount: 5,
        targetChallenges: 6,
        modeCount: 3,
        routeBucket: "join",
        roomCode: "SECRET",
        playerName: "do not keep",
      },
    }],
  });

  assert.deepEqual(result, { ok: true, count: 1 });
  assert.deepEqual(recorded[0], {
    event: "client_session_summary",
    props: {
      analyticsPlayerId: analyticsPlayerId("u_player"),
      summaryKind: "match_participation",
      playedMatch: true,
      phase: "QUESTION",
      isOwner: false,
      playerCount: 5,
      targetChallenges: 6,
      modeCount: 3,
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
