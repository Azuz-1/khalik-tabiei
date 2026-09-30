import { test } from "node:test";
import assert from "node:assert/strict";
import { browserHarness } from "./client-browser-harness.js";

async function onlineHarness() {
  const browser = await browserHarness();
  const socket = browser.Socket.instances[0]!;
  socket.open();
  socket.receive({ t: "HELLO_OK", uid: "u", serverMs: 1_000 });
  return { browser, socket };
}

const pings = (socket: { sent: any[] }) => socket.sent.filter((message) => message.t === "PING").length;

for (const signal of ["online", "pageshow", "visibilitychange"] as const) {
  test(`${signal}: an OPEN socket that stays silent is replaced within the probe window`, async () => {
    const { browser, socket } = await onlineHarness();
    try {
      browser.setMono(1_000);
      const before = pings(socket);
      browser.events.get(signal)!();
      assert.equal(pings(socket), before + 1, "resume sends an immediate liveness ping");
      browser.setMono(4_100);
      browser.fire(3_000, false);
      assert.equal(socket.closes.at(-1), "liveness probe timeout");
      assert.equal(browser.socketModule.actions.createRoom("مالك"), null, "the dead socket stops taking actions");
      assert.equal(browser.socketModule.getGameSnapshot().status, "offline", "the UI shows reconnecting and recovery is scheduled");
    } finally { browser.restore(); }
  });
}

test("a live socket that answers the probe is kept", async () => {
  const { browser, socket } = await onlineHarness();
  try {
    browser.setMono(1_000);
    browser.events.get("online")!();
    const ping = socket.sent.at(-1);
    browser.setMono(1_200);
    socket.receive({ t: "PONG", sampleId: ping.sampleId, serverMs: 2_000 });
    browser.setMono(4_100);
    browser.fire(3_000, false);
    assert.equal(socket.closes.length, 0);
    assert.equal(browser.Socket.instances.length, 1);
    assert.ok(browser.socketModule.actions.createRoom("مالك"));
  } finally { browser.restore(); }
});

test("online with no socket starts a connection instead of probing", async () => {
  const browser = await browserHarness();
  try {
    const first = browser.Socket.instances[0]!;
    first.open();
    first.receive({ t: "HELLO_OK", uid: "u", serverMs: 1_000 });
    browser.events.get("offline")!();
    assert.equal(first.closes.at(-1), "device offline");
    browser.events.get("online")!();
    await browser.flush();
    assert.equal(browser.Socket.instances.length, 2);
  } finally { browser.restore(); }
});
