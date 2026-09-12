import test from "node:test";
import assert from "node:assert/strict";
import {
  DisplayPairingRegistry,
  normalizeDisplayPairingCode,
  type DisplayPairingBinding,
} from "../src/game/displayPairing.js";

const bindingA: DisplayPairingBinding = {
  roomCode: "ABCDE",
  roomCreatedAt: 1_000,
  hostUid: "host-a",
  displayEpoch: 0,
};
const bindingB: DisplayPairingBinding = {
  roomCode: "FGHJK",
  roomCreatedAt: 2_000,
  hostUid: "host-b",
  displayEpoch: 3,
};

function ids() {
  let value = 0;
  return () => `pairing-${++value}`;
}

function secrets() {
  let value = 0;
  return () => `secret-${String(++value).padStart(32, "0")}`;
}

test("generated pairing codes are exactly six numeric digits and preserve leading zeroes", () => {
  const registry = new DisplayPairingRegistry({ randomCode: () => 42, createId: ids(), createSecret: secrets() });
  const created = registry.create();
  assert.equal(created.code, "000042");
  assert.match(created.code, /^[0-9]{6}$/u);
});

test("active codes stay unique and generator collisions retry safely", () => {
  const values = [111111, 111111, 222222];
  const registry = new DisplayPairingRegistry({
    randomCode: () => values.shift() ?? 333333,
    createId: ids(),
    createSecret: secrets(),
  });
  assert.equal(registry.create().code, "111111");
  assert.equal(registry.create().code, "222222");
  assert.equal(registry.size, 2);
});

test("allocation fails safely after bounded code collision retries", () => {
  const registry = new DisplayPairingRegistry({ randomCode: () => 111111, createId: ids(), createSecret: secrets() });
  registry.create();
  assert.throws(() => registry.create(), /unable to allocate display pairing code/);
  assert.equal(registry.size, 1);
});

test("expired sessions are removed and their human codes may be reused", () => {
  let now = 10_000;
  const registry = new DisplayPairingRegistry({
    now: () => now,
    ttlMs: 100,
    randomCode: () => 123456,
    createId: ids(),
    createSecret: secrets(),
  });
  const first = registry.create();
  now = first.expiresAt;
  assert.equal(registry.size, 0);
  const second = registry.create();
  assert.equal(second.code, "123456");
  assert.notEqual(second.id, first.id);
});

test("wrong TV secret cannot read a pairing while the correct secret can", () => {
  const registry = new DisplayPairingRegistry({ randomCode: () => 123456, createId: ids(), createSecret: secrets() });
  const created = registry.create();
  assert.equal(registry.read(created.id, "wrong-secret-wrong-secret"), null);
  assert.deepEqual(registry.read(created.id, created.secret), { status: "pending", expiresAt: created.expiresAt });
});

test("unclaimed pairing is pending and claimed pairing returns an immutable exact binding", () => {
  const registry = new DisplayPairingRegistry({ randomCode: () => 123456, createId: ids(), createSecret: secrets() });
  const created = registry.create();
  assert.equal(registry.read(created.id, created.secret)?.status, "pending");

  const submitted = { ...bindingA };
  assert.equal(registry.claim(created.code, submitted), true);
  submitted.hostUid = "mutated-after-claim";
  const firstRead = registry.read(created.id, created.secret);
  assert.equal(firstRead?.status, "claimed");
  if (!firstRead || firstRead.status !== "claimed") throw new Error("claimed binding missing");
  assert.deepEqual(firstRead.binding, bindingA);
  firstRead.binding.hostUid = "mutated-read-copy";
  const secondRead = registry.read(created.id, created.secret);
  assert.equal(secondRead?.status, "claimed");
  if (!secondRead || secondRead.status !== "claimed") throw new Error("claimed binding missing");
  assert.deepEqual(secondRead.binding, bindingA);
});

test("same exact room claim is idempotent but another room cannot rebind the pairing", () => {
  const registry = new DisplayPairingRegistry({ randomCode: () => 123456, createId: ids(), createSecret: secrets() });
  const created = registry.create();
  assert.equal(registry.claim(created.code, bindingA), true);
  assert.equal(registry.claim("123 456", { ...bindingA }), true);
  assert.equal(registry.claim(created.code, bindingB), false);
  const read = registry.read(created.id, created.secret);
  assert.equal(read?.status, "claimed");
  if (!read || read.status !== "claimed") throw new Error("claimed binding missing");
  assert.deepEqual(read.binding, bindingA);
});

test("pairing code normalization accepts spaces and hyphens but rejects malformed values", () => {
  assert.equal(normalizeDisplayPairingCode("482 731"), "482731");
  assert.equal(normalizeDisplayPairingCode("482-731"), "482731");
  assert.equal(normalizeDisplayPairingCode(" 482 - 731 "), "482731");
  for (const value of ["48273", "4827310", "482A731", "", null, undefined, 482731]) {
    assert.equal(normalizeDisplayPairingCode(value), null);
  }
});

test("registry maximum is enforced while expiry cleanup prevents unbounded growth", () => {
  let now = 0;
  let nextCode = 100000;
  const registry = new DisplayPairingRegistry({
    now: () => now,
    ttlMs: 50,
    maxActive: 2,
    randomCode: () => nextCode++,
    createId: ids(),
    createSecret: secrets(),
  });
  registry.create();
  registry.create();
  assert.equal(registry.size, 2);
  assert.throws(() => registry.create(), /display pairing capacity reached/);

  now = 51;
  assert.equal(registry.size, 0);
  registry.create();
  registry.create();
  assert.equal(registry.size, 2);
});

test("clear releases all pairing state without timers or lingering capacity", () => {
  const registry = new DisplayPairingRegistry({ randomCode: () => 654321, createId: ids(), createSecret: secrets() });
  registry.create();
  assert.equal(registry.size, 1);
  registry.clear();
  assert.equal(registry.size, 0);
});
