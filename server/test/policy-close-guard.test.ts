import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { Connection } from "../src/net/connection.js";
import { FakeSocket, testUid } from "./helpers.js";

test("policy close makes later incoming frames inert immediately", () => {
  const socket = new FakeSocket();
  const conn = new Connection(socket as unknown as WebSocket, "http://localhost:8080", "127.0.0.1");

  assert.equal(conn.canProcessIncoming(), true);
  assert.equal(conn.authenticate(testUid(1)), true);

  conn.closePolicy("sustained abuse");

  assert.equal(socket.closeCalls[0]?.code, 1008);
  assert.equal(conn.canProcessIncoming(), false);
  assert.equal(conn.authenticate(testUid(2)), false);
  assert.equal(conn.send({ t: "PONG" }), false);

  // Repeated close attempts are idempotent and cannot enqueue more close frames.
  conn.closePolicy("second close");
  assert.equal(socket.closeCalls.length, 1);
});
