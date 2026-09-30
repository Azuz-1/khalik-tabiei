import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script, createContext } from "node:vm";
import ts from "typescript";
import * as diagnostics from "../../client/src/clientErrorDiagnostics.js";

function telemetryHarness() {
  const events = new Map<string, (event: unknown) => void>();
  const timers: Array<() => void> = [];
  const requests: Array<{ events: Array<{ event: string; props: Record<string, unknown> }> }> = [];
  const context = createContext({
    exports: {},
    require: () => diagnostics,
    Uint8Array, Math, URL,
    crypto: { getRandomValues(bytes: Uint8Array) { bytes.fill(7); return bytes; } },
    get sessionStorage() { throw new Error("storage unavailable"); },
    performance: { now: () => 1_000 },
    location: { pathname: "/", origin: "https://game.example" },
    navigator: { onLine: true },
    innerWidth: 390, innerHeight: 844,
    document: {
      visibilityState: "visible", readyState: "loading", addEventListener() {},
      querySelector: () => ({ src: "https://game.example/assets/index-AbCdEf12.js" }),
    },
    window: {
      setTimeout(callback: () => void) { timers.push(callback); return timers.length; },
      setInterval() {},
      addEventListener(name: string, callback: (event: unknown) => void) { events.set(name, callback); },
    },
    fetch: async (_url: string, options: { body: string }) => { requests.push(JSON.parse(options.body)); return { ok: true }; },
  });
  const source = readFileSync(new URL("../../client/src/telemetry.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Script(compiled).runInContext(context);
  return { events, timers, requests, window: context.window, module: context.exports as { analyticsClientSessionId: string } };
}

test("telemetry initializes with missing randomUUID and denied storage, without persistent identity", () => {
  const harness = telemetryHarness();
  assert.match(harness.module.analyticsClientSessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("executed browser error handler bounds ten reports and strips private error/source contents", async () => {
  const harness = telemetryHarness();
  const onError = harness.events.get("error")!;
  for (let index = 0; index < 25; index += 1) onError({
    target: harness.window, error: { name: "SECRET_PLAYER", message: "SECRET_PROMPT", stack: "SECRET_VOTE" },
    filename: "https://game.example/assets/App-AbCdEf12.js?room=SECRET_ROOM", lineno: 32, colno: 17,
  });
  // Initialization schedules client_started first; the second timeout is flush.
  harness.timers[1]!();
  await Promise.resolve();
  const errors = harness.requests.flatMap((request) => request.events);
  assert.equal(errors.length, 10);
  for (const item of errors) {
    assert.equal(item.event, "client_error");
    assert.equal(item.props.kind, "runtime");
    assert.equal(item.props.errorClass, "unknown");
    assert.equal(item.props.sourceAsset, "App-AbCdEf12.js");
    assert.equal(item.props.bundleId, "index-AbCdEf12.js");
    assert.equal(item.props.line, 32);
    assert.equal(item.props.column, 17);
  }
  assert.doesNotMatch(JSON.stringify(errors), /SECRET_|https?:|message|stack|filename/);
});
