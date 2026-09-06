import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateClientMessage } from "../src/security/messages.js";

test("runtime protocol accepts only TEAM and INDIVIDUAL play styles", () => {
  assert.ok(validateClientMessage({ t: "SET_SETTINGS", playStyle: "TEAM" }));
  assert.ok(validateClientMessage({ t: "SET_SETTINGS", playStyle: "INDIVIDUAL" }));
  assert.equal(validateClientMessage({ t: "SET_SETTINGS", playStyle: "SOLO" }), null);
  assert.equal(validateClientMessage({ t: "SET_SETTINGS" }), null);
});

test("official integration command runs TEAM then INDIVIDUAL real WebSocket suites", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { scripts?: Record<string, string> };
  const command = pkg.scripts?.["test:integration"] ?? "";
  assert.ok(command.includes("server/test/integration.mjs"));
  assert.ok(command.includes("server/test/integration-individual.mjs"));
  assert.ok(command.includes("&&"), "the second suite must not run after a TEAM failure");
});
