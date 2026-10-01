import test from "node:test";
import assert from "node:assert/strict";
import { assetName, errorClass, sourceCoordinate } from "../../client/src/clientErrorDiagnostics.js";
import { parseClientTelemetryBatch } from "../src/clientTelemetry.js";

test("error diagnostics preserve canonical class and chunk coordinates without raw text or URLs", () => {
  const secretError = new TypeError("private player, code, prompt, and vote");
  assert.equal(errorClass(secretError), "TypeError");
  assert.equal(errorClass({ name: "private player name", message: "secret" }), "unknown");
  assert.equal(errorClass({ get name() { throw new Error("getter must not break reporting"); } }), "unknown");
  assert.equal(assetName("https://game.example/assets/App-ABCDef12.js?room=SECRET#private", "https://game.example"), "App-ABCDef12.js");
  for (const url of ["https://other.example/assets/App-ABCDef12.js", "/join/SECRET", "/src/App.tsx", "/assets/player-secret.js"]) {
    assert.equal(assetName(url, "https://game.example"), undefined);
  }
  assert.equal(sourceCoordinate(321), 321);
  for (const value of [0, -1, 1.5, 1_000_001, "21", NaN, Infinity]) assert.equal(sourceCoordinate(value), undefined);

  const parsed = parseClientTelemetryBatch({ events: [{ event: "client_error", props: {
    kind: "runtime", routeBucket: "home", online: true,
    surface: "home", phase: "none", errorClass: "TypeError",
    bundleId: "index-AbCdeF12.js", sourceAsset: "App-ABCDef12.js", line: 321, column: 17,
    message: "private player", stack: "private stack", url: "/join/SECRET",
    playerName: "private player", roomCode: "SECRET", prompt: "private prompt", votes: "private votes",
  } }] });
  assert.deepEqual(parsed?.[0]?.props, {
    kind: "runtime", routeBucket: "home", online: true,
    surface: "home", phase: "none", errorClass: "TypeError",
    bundleId: "index-AbCdeF12.js", sourceAsset: "App-ABCDef12.js", line: 321, column: 17,
  });
});

test("ingestion drops unrecognized diagnostics values rather than accepting arbitrary error names and paths", () => {
  const parsed = parseClientTelemetryBatch({ events: [{ event: "client_error", props: {
    kind: "secret", routeBucket: "/join/SECRET", online: "SECRET", surface: "private name", phase: "private room",
    errorClass: "private exception", bundleId: "https://game.example/secret", sourceAsset: "/src/private", line: 23, column: 0,
  } }] });
  assert.deepEqual(parsed?.[0]?.props, {});
  const numeric = parseClientTelemetryBatch({ events: [{ event: "client_error", props: {
    kind: "promise", sourceAsset: "App-ABCDef12.js", line: 1.5, column: -2,
  } }] });
  assert.deepEqual(numeric?.[0]?.props, { kind: "promise", sourceAsset: "App-ABCDef12.js" });
});
