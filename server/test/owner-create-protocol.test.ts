import test from "node:test";
import assert from "node:assert/strict";
import { validateClientMessage } from "../src/security/messages.js";

test("CREATE_ROOM accepts the owner player name through the wire validator", () => {
  const valid = validateClientMessage({ t: "CREATE_ROOM", name: "المالك", rid: "create-owner" }, true);
  assert.deepEqual(valid, { t: "CREATE_ROOM", name: "المالك", rid: "create-owner" });
});

test("production cannot fall back to the legacy external Host room shape", () => {
  assert.equal(validateClientMessage({ t: "CREATE_ROOM" }, true), null);
  assert.deepEqual(validateClientMessage({ t: "CREATE_ROOM" }, false), { t: "CREATE_ROOM" });
});

test("CREATE_ROOM keeps strict field and abuse bounds", () => {
  assert.equal(validateClientMessage({ t: "CREATE_ROOM", name: "س".repeat(129) }, true), null);
  assert.equal(validateClientMessage({ t: "CREATE_ROOM", name: "المالك", unexpected: true }, true), null);
});
