import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import { isTrialRequest } from "../src/auth/session.js";
import { ClientTelemetryIngestor } from "../src/clientTelemetry.js";
import type { AnalyticsTrackOptions } from "../src/analytics.js";
import { applyTrialFlag } from "../../client/src/trialFlag.js";
import { authenticatedConnection, joinPlayer, lastMessage, testUid } from "./helpers.js";

type Recorded = { event: string; props: Record<string, unknown>; options?: AnalyticsTrackOptions };

function recordingManager() {
  const events: Recorded[] = [];
  const manager = new RoomManager({
    rng: () => 0,
    analytics: (event, props, options) => { events.push({ event, props: props ?? {}, ...(options ? { options } : {}) }); },
  });
  return { manager, events };
}

test("only the exact kt_trial=1 cookie marks a trial request", () => {
  assert.equal(isTrialRequest({ headers: { cookie: "kt_session=abc; kt_trial=1" } }), true);
  assert.equal(isTrialRequest({ headers: { cookie: "kt_trial=0" } }), false);
  assert.equal(isTrialRequest({ headers: { cookie: "kt_trial=true" } }), false);
  assert.equal(isTrialRequest({ headers: {} }), false);
});

test("rooms created by a trial connection label every room event as trial; others do not", () => {
  const { manager, events } = recordingManager();
  try {
    const trialOwner = authenticatedConnection(manager, testUid(1));
    trialOwner.conn.trial = true;
    manager.handle(trialOwner.conn, { t: "CREATE_ROOM", name: "المالك" });
    const trialCode = lastMessage(trialOwner.socket, "STATE")!.view.room.code;
    joinPlayer(manager, trialCode, 2);
    joinPlayer(manager, trialCode, 3);
    manager.handle(trialOwner.conn, { t: "START_GAME" });

    const realOwner = authenticatedConnection(manager, testUid(9));
    manager.handle(realOwner.conn, { t: "CREATE_ROOM", name: "لاعب" });

    const trialSession = events.find((entry) => entry.event === "room_created")!.props.roomSessionId;
    const trialEvents = events.filter((entry) => entry.props.roomSessionId === trialSession);
    assert.ok(trialEvents.some((entry) => entry.event === "game_started"));
    assert.ok(trialEvents.every((entry) => entry.options?.trial === true), "every trial room event is labelled");
    const realCreated = events.filter((entry) => entry.event === "room_created").at(-1)!;
    assert.notEqual(realCreated.props.roomSessionId, trialSession);
    assert.equal(realCreated.options, undefined, "a normal room is not labelled");
  } finally { manager.dispose(); }
});

test("client telemetry from a trial browser is labelled trial", () => {
  const calls: Array<AnalyticsTrackOptions | undefined> = [];
  const ingestor = new ClientTelemetryIngestor((_event, _props, options) => { calls.push(options); });
  const body = { events: [{ event: "client_started", props: { routeBucket: "home" } }] };
  assert.equal(ingestor.ingest("u1", body, { trial: true }).ok, true);
  assert.equal(ingestor.ingest("u2", body).ok, true);
  assert.deepEqual(calls, [{ trial: true }, undefined]);
});

test("?trial=1 sets and ?trial=0 clears the marker; other URLs leave it alone", () => {
  const written: string[] = [];
  assert.equal(applyTrialFlag("?trial=1", true, (cookie) => written.push(cookie)), "on");
  assert.equal(applyTrialFlag("?trial=0", false, (cookie) => written.push(cookie)), "off");
  assert.equal(applyTrialFlag("?code=ABCDE", true, (cookie) => written.push(cookie)), null);
  assert.match(written[0]!, /^kt_trial=1; Max-Age=31536000; Path=\/; SameSite=Lax; Secure$/);
  assert.match(written[1]!, /^kt_trial=; Max-Age=0; Path=\/; SameSite=Lax$/);
  assert.equal(written.length, 2);
});
