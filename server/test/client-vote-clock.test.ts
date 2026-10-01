import { test } from "node:test";
import assert from "node:assert/strict";
import { browserHarness } from "./client-browser-harness.js";

// Runs in its own process: the client clock is a module singleton.
test("a skewed device clock cannot block a vote before the clock is server-anchored", async () => {
  const browser = await browserHarness();
  try {
    const socket = browser.Socket.instances[0]!;
    socket.open();
    // Reload into a live room: the server answers HELLO with STATE (no HELLO_OK
    // serverMs), so there is no server anchor yet. The device clock is 30 s ahead.
    const deviceNow = Date.now();
    const view = {
      self: { uid: "u", role: "player" },
      room: { code: "ABCDE", phase: "VOTING", phaseEndsAt: deviceNow - 30_000 + 10_000 },
      players: [], voteTargets: [{ uid: "target", name: "لاعب" }],
      voteContext: "ctx-current", myVoteSubmitted: false,
    };
    socket.receive({ t: "STATE", view });
    assert.ok(browser.socketModule.actions.submitVote("target", "ctx-current"), "server decides; the local guard stays out of the way");
    assert.equal(socket.sent.filter((message) => message.t === "SUBMIT_VOTE").length, 1);
  } finally { browser.restore(); }
});

test("once server-anchored, an expired voting deadline is still blocked locally", async () => {
  const browser = await browserHarness();
  try {
    const socket = browser.Socket.instances[0]!;
    socket.open();
    const ping = () => socket.sent.filter((message) => message.t === "PING").at(-1);
    const view = {
      self: { uid: "u", role: "player" },
      room: { code: "ABCDE", phase: "VOTING", phaseEndsAt: 50_000 },
      players: [], voteTargets: [{ uid: "target", name: "لاعب" }],
      voteContext: "ctx-current", myVoteSubmitted: false,
    };
    socket.receive({ t: "STATE", view });
    socket.receive({ t: "PONG", sampleId: ping().sampleId, serverMs: 60_000 });
    assert.equal(browser.socketModule.actions.submitVote("target", "ctx-current"), null);
    assert.equal(socket.sent.filter((message) => message.t === "SUBMIT_VOTE").length, 0);
  } finally { browser.restore(); }
});
