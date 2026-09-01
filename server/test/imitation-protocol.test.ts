import { test } from "node:test";
import assert from "node:assert/strict";
import { validateClientMessage } from "../src/security/messages.js";

test("runtime validator accepts MARK_READY and selectedModes subsets", () => {
  assert.ok(validateClientMessage({ t: "MARK_READY" }));
  for (const selectedModes of [
    ["POINT"],
    ["POINT", "HANDS"],
    ["HANDS", "POINT", "NUMBER"],
  ]) {
    assert.ok(validateClientMessage({ t: "SET_SETTINGS", selectedModes }));
  }
});

test("runtime validator rejects unknown, duplicate, and oversized mode selections", () => {
  assert.equal(validateClientMessage({ t: "MARK_READY", extra: true }), null);
  assert.equal(validateClientMessage({ t: "SET_SETTINGS", selectedModes: ["TEXT_PAIR"] }), null);
  assert.equal(validateClientMessage({ t: "SET_SETTINGS", selectedModes: ["POINT", "POINT"] }), null);
  assert.equal(validateClientMessage({ t: "SET_SETTINGS", selectedModes: ["HANDS", "POINT", "NUMBER", "HANDS"] }), null);
});
