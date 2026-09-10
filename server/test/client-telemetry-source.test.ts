import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../../client/src/telemetry.ts", import.meta.url)), "utf8");

test("client telemetry stays ephemeral and never creates a persistent browser identity", () => {
  assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie/.test(source), false);
  assert.equal(/crypto\.randomUUID|fingerprint|canvas\.toDataURL|enumerateDevices/.test(source), false);
  assert.match(source, /navigator\.userAgent/);
  assert.equal(/userAgent\s*:/.test(source), false, "raw user-agent must never be serialized as a telemetry property");
  assert.equal(/screen\.width|screen\.height/.test(source), false, "exact physical screen dimensions are intentionally not collected");
});
