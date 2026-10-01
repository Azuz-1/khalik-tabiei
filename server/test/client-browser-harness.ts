import assert from "node:assert/strict";

/**
 * Loads a fresh copy of client/src/net/socket.ts against a fake window,
 * document, WebSocket and timer queue, so transport recovery can be driven
 * deterministically from node:test.
 */
export async function browserHarness() {
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
