import { test } from "node:test";
import assert from "node:assert/strict";

async function browserHarness() {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const timers = new Map<number, { callback: () => void; delay: number; interval: boolean }>();
  const events = new Map<string, () => void>();
  let sequence = 0;
  let mono = 0;
  const override = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    static instances: Socket[] = [];
    readyState = 0;
    sent: any[] = [];
    closes: string[] = [];
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    constructor() { Socket.instances.push(this); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    // Model a blackhole that never completes the closing handshake.
    close(_code?: number, reason = "") { this.readyState = 2; this.closes.push(reason); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(message: any) { this.onmessage?.({ data: JSON.stringify(message) }); }
  }
  const schedule = (callback: () => void, delay: number, interval: boolean) => {
    const id = ++sequence;
    timers.set(id, { callback, delay, interval });
    return id;
  };
  override("window", {
    setTimeout: (callback: () => void, delay: number) => schedule(callback, delay, false),
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: (callback: () => void, delay: number) => schedule(callback, delay, true),
    clearInterval: (id: number) => timers.delete(id),
    addEventListener: (name: string, callback: () => void) => events.set(name, callback),
    localStorage: { getItem: () => null, setItem: () => {} },
  });
  override("document", { visibilityState: "visible", addEventListener: (name: string, callback: () => void) => events.set(name, callback) });
  override("location", { protocol: "http:", host: "example.test" });
  override("performance", { now: () => mono });
  override("fetch", async () => ({ ok: true }));
  override("WebSocket", Socket);
  const moduleUrl = new URL(process.env.SOCKET_REPRO_MODULE ?? "../../client/src/net/socket.ts", import.meta.url);
  moduleUrl.searchParams.set("harness", String(Math.random()));
  const socketModule = await import(moduleUrl.href);
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  await flush();
  const fire = (delay: number, interval: boolean) => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay && timer.interval === interval);
    assert.ok(entry, `expected ${delay}ms timer`);
    if (!interval) timers.delete(entry[0]);
    entry[1].callback();
  };
  return {
    Socket, socketModule, events, flush, fire,
    setMono: (value: number) => { mono = value; },
    restore: () => {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as any)[key];
      }
    },
  };
}

test("an OPEN blackholed socket recovers without waiting for a close event", async () => {
  const browser = await browserHarness();
  try {
    const first = browser.Socket.instances[0]!;
    first.open();
    first.receive({ t: "HELLO_OK", uid: "u", serverMs: 1_000 });
    browser.setMono(30_000);
    browser.fire(10_000, true);
    assert.equal(first.closes.at(-1), "heartbeat timeout");
    assert.equal(browser.socketModule.actions.createRoom("مالك"), null, "stale socket stops accepting actions immediately");
    browser.events.get("online")!();
    await browser.flush();
    assert.equal(browser.Socket.instances.length, 2, "fresh session/socket attempt proceeds despite missing onclose");
    first.receive({ t: "HELLO_OK", uid: "stale" });
    const second = browser.Socket.instances[1]!;
    second.open();
    second.receive({ t: "HELLO_OK", uid: "u", serverMs: 31_000 });
    assert.ok(browser.socketModule.actions.createRoom("مالك"));
    assert.equal(second.sent.at(-1).t, "CREATE_ROOM");
  } finally { browser.restore(); }
});

test("votes use the displayed context, suppress rapid repeats and reject outdated/expired UI", async () => {
  const browser = await browserHarness();
  try {
    const socket = browser.Socket.instances[0]!;
    socket.open();
    socket.receive({ t: "HELLO_OK", uid: "u", serverMs: 1_000 });
    const view = {
      self: { uid: "u", role: "player" },
      room: { code: "ABCDE", phase: "VOTING", phaseEndsAt: 100_000 },
      players: [], voteTargets: [{ uid: "target", name: "لاعب" }],
      voteContext: "ctx-current", myVoteSubmitted: false,
    };
    socket.receive({ t: "STATE", view });
    assert.equal(browser.socketModule.actions.submitVote("target", "ctx-stale"), null);
    const rid = browser.socketModule.actions.submitVote("target", "ctx-current");
    assert.ok(rid);
    assert.equal(socket.sent.at(-1).voteContext, "ctx-current");
    assert.equal(browser.socketModule.actions.submitVote("target", "ctx-current"), null);
    assert.equal(socket.sent.filter((message) => message.t === "SUBMIT_VOTE").length, 1);
    socket.receive({ t: "VOTE_IGNORED", rid, reason: "STALE_CHALLENGE" });
    socket.receive({ t: "STATE", view: { ...view, voteContext: "ctx-next" } });
    assert.equal(browser.socketModule.actions.submitVote("target", "ctx-current"), null);
    socket.receive({ t: "STATE", view: { ...view, voteContext: "ctx-next", room: { ...view.room, phaseEndsAt: 500 } } });
    assert.equal(browser.socketModule.actions.submitVote("target", "ctx-next"), null);
    browser.events.get("offline")!();
    assert.equal(browser.socketModule.actions.createRoom("مالك"), null, "offline browser signal blocks actions before onclose");
  } finally { browser.restore(); }
});

test("connect and hello deadlines retry without a completed close handshake", async () => {
  const browser = await browserHarness();
  try {
    const first = browser.Socket.instances[0]!;
    browser.fire(7_000, false);
    assert.equal(first.closes.at(-1), "connect timeout");
    browser.events.get("online")!();
    await browser.flush();
    const second = browser.Socket.instances[1]!;
    second.open();
    browser.fire(5_000, false);
    assert.equal(second.closes.at(-1), "hello timeout");
    browser.events.get("online")!();
    await browser.flush();
    assert.equal(browser.Socket.instances.length, 3);
    first.receive({ t: "HELLO_OK", uid: "stale" });
    assert.equal(browser.socketModule.actions.createRoom("مالك"), null, "superseded socket cannot authenticate its successor");
  } finally { browser.restore(); }
});

test("lost membership reconnect clears stale room, explains recovery and never retries JOIN or old votes", async () => {
  const browser = await browserHarness();
  try {
    const first = browser.Socket.instances[0]!;
    first.open();
    first.receive({ t: "HELLO_OK", uid: "u", serverMs: 1_000 });
    const view = {
      self: { uid: "u", role: "player" }, room: { code: "ABCDE", phase: "VOTING", phaseEndsAt: 100_000 },
      players: [], voteTargets: [{ uid: "target", name: "لاعب" }], voteContext: "old-context", myVoteSubmitted: false,
    };
    first.receive({ t: "STATE", view });
    assert.ok(browser.socketModule.actions.submitVote("target", "old-context"));
    browser.events.get("offline")!();
    browser.events.get("online")!();
    await browser.flush();
    const second = browser.Socket.instances[1]!;
    second.open();
    second.receive({ t: "HELLO_OK", uid: "u", serverMs: 1_000 });
    const snapshot = browser.socketModule.getGameSnapshot();
    assert.equal(snapshot.status, "online");
    assert.equal(snapshot.view, null);
    assert.match(snapshot.notice, /لم تعد الغرفة متاحة أو انتهى مكانك فيها/);
    assert.equal(second.sent.some((message) => message.t === "JOIN_ROOM" || message.t === "SUBMIT_VOTE"), false);
    assert.equal(browser.socketModule.actions.submitVote("target", "old-context"), null);
    assert.ok(browser.socketModule.actions.createRoom("مالك"));
    assert.equal(second.sent.at(-1).t, "CREATE_ROOM");
  } finally { browser.restore(); }
});

test("intentional leave stays quiet across interrupted transport and closure permits fresh home actions", async () => {
  const browser = await browserHarness();
  try {
    const first = browser.Socket.instances[0]!;
    first.open();
    first.receive({ t: "HELLO_OK", uid: "u", serverMs: 1_000 });
    first.receive({ t: "STATE", view: { self: { uid: "u", role: "player" }, room: { code: "ABCDE", phase: "LOBBY" }, players: [] } });
    assert.ok(browser.socketModule.actions.leaveRoom());
    browser.events.get("offline")!();
    browser.events.get("online")!();
    await browser.flush();
    const second = browser.Socket.instances[1]!;
    second.open();
    second.receive({ t: "HELLO_OK", uid: "u", serverMs: 1_000 });
    assert.equal(browser.socketModule.getGameSnapshot().notice, null, "requested exit is not described as unexpected room loss");
    second.receive({ t: "STATE", view: { self: { uid: "u", role: "player" }, room: { code: "FGHJK", phase: "LOBBY" }, players: [] } });
    second.receive({ t: "ROOM_CLOSED" });
    assert.equal(browser.socketModule.getGameSnapshot().view, null);
    assert.match(browser.socketModule.getGameSnapshot().notice, /تنشئ غرفة جديدة أو تدخل برمز جديد/);
    browser.socketModule.clearNotice();
    const joinRid = browser.socketModule.actions.joinRoom("FGHJK", "لاعب");
    second.receive({ t: "ERROR", code: "ROOM_NOT_FOUND", rid: joinRid });
    assert.equal(browser.socketModule.getGameSnapshot().error.code, "ROOM_NOT_FOUND");
    assert.equal(browser.socketModule.getGameSnapshot().view, null);
    assert.ok(browser.socketModule.actions.createRoom("مالك"));
  } finally { browser.restore(); }
});
