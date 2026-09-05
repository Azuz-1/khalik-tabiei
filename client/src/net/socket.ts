import { useSyncExternalStore } from "react";
import type {
  CategoryId,
  ClientMessage,
  ClientView,
  ErrorCode,
  GameMode,
  PlayStyle,
  ServerMessage,
} from "../../../shared/types.js";
import { serverClock } from "./clock.js";

export interface GameState {
  status: "connecting" | "online" | "offline";
  uid: string | null;
  view: ClientView | null;
  error: { code: ErrorCode; id: number } | null;
  notice: string | null;
  transportFeedback: { text: string; id: number } | null;
  pendingActions: readonly string[];
}

let state: GameState = {
  status: "connecting",
  uid: null,
  view: null,
  error: null,
  notice: null,
  transportFeedback: null,
  pendingActions: [],
};

const listeners = new Set<() => void>();
const pending = new Map<string, { type: string; socket: WebSocket; timeout: number }>();
let errorSeq = 0;
let feedbackSeq = 0;
let requestSeq = 0;
let sampleSeq = 0;
let ws: WebSocket | null = null;
let reconnectDelay = 500;
let reconnectTimer: number | undefined;
let heartbeatTimer: number | undefined;
let connectGeneration = 0;
let bootstrapAbort: AbortController | null = null;
let lastInboundMono = 0;

const BOOTSTRAP_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 7_000;
const HELLO_TIMEOUT_MS = 5_000;
const ACTION_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 10_000;
const STALE_BACKGROUND_MS = 45_000;

type ActionMessage = Exclude<ClientMessage, { t: "HELLO" } | { t: "PING" }>;

function set(patch: Partial<GameState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function syncPendingState(): void {
  set({ pendingActions: [...new Set([...pending.values()].map((entry) => entry.type))] });
}

function feedback(text: string): void {
  feedbackSeq += 1;
  set({ transportFeedback: { text, id: feedbackSeq } });
}

function wsUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

function newRid(): string {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${requestSeq.toString(36)}`.slice(0, 32);
}

function clearPending(rid: string, socket: WebSocket): boolean {
  const entry = pending.get(rid);
  if (!entry || entry.socket !== socket) return false;
  window.clearTimeout(entry.timeout);
  pending.delete(rid);
  syncPendingState();
  return true;
}

function failPendingForSocket(socket: WebSocket): void {
  let changed = false;
  for (const [rid, entry] of pending) {
    if (entry.socket !== socket) continue;
    window.clearTimeout(entry.timeout);
    pending.delete(rid);
    changed = true;
  }
  if (changed) {
    syncPendingState();
    feedback("انقطع الاتصال قبل ما نتأكد من تنفيذ الطلب. ما أعدنا إرساله تلقائيًا.");
  }
}

function sendClockSample(socket: WebSocket): void {
  if (socket !== ws || socket.readyState !== WebSocket.OPEN || state.status !== "online") return;
  sampleSeq += 1;
  const sampleId = `s-${sampleSeq}`;
  const clientMonoMs = serverClock.beginSample(sampleId);
  socket.send(JSON.stringify({ t: "PING", sampleId, clientMonoMs } satisfies ClientMessage));
}

function startHeartbeat(socket: WebSocket): void {
  window.clearInterval(heartbeatTimer);
  sendClockSample(socket);
  heartbeatTimer = window.setInterval(() => sendClockSample(socket), HEARTBEAT_MS);
}

function authenticated(socket: WebSocket, message: Extract<ServerMessage, { t: "HELLO_OK" | "STATE" }>): void {
  if (socket !== ws) return;
  const firstAuthenticatedFrame = state.status !== "online";
  reconnectDelay = 500;
  lastInboundMono = performance.now();
  if (message.t === "HELLO_OK" && message.serverMs !== undefined) serverClock.seed(message.serverMs);
  set({ status: "online" });
  if (firstAuthenticatedFrame) startHeartbeat(socket);
}

function dispatch(socket: WebSocket, message: ServerMessage): void {
  if (socket !== ws) return;
  lastInboundMono = performance.now();
  switch (message.t) {
    case "HELLO_OK":
      authenticated(socket, message);
      set({ uid: message.uid, view: null });
      break;
    case "STATE":
      authenticated(socket, message);
      set({ view: message.view, uid: message.view.self.uid });
      break;
    case "ACK":
      clearPending(message.rid, socket);
      break;
    case "ERROR":
      if (message.rid) clearPending(message.rid, socket);
      errorSeq += 1;
      set({ error: { code: message.code, id: errorSeq } });
      break;
    case "ROOM_CLOSED":
      set({ view: null, notice: "الغرفة مقفلة" });
      break;
    case "KICKED":
      set({ view: null, notice: "المضيف طلعك من الغرفة" });
      break;
    case "PONG":
      if (message.sampleId && message.serverMs !== undefined) {
        serverClock.acceptSample(message.sampleId, message.serverMs, performance.now());
      }
      break;
  }
}

async function bootstrap(generation: number): Promise<boolean> {
  bootstrapAbort?.abort();
  const controller = new AbortController();
  bootstrapAbort = controller;
  const timeout = window.setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);
  try {
    const response = await fetch("/api/session", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    return generation === connectGeneration && response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
    if (bootstrapAbort === controller) bootstrapAbort = null;
  }
}

async function connectNow(): Promise<void> {
  const generation = ++connectGeneration;
  bootstrapAbort?.abort();
  const superseded = ws;
  if (superseded && (superseded.readyState === WebSocket.OPEN || superseded.readyState === WebSocket.CONNECTING)) {
    failPendingForSocket(superseded);
    try { superseded.close(1000, "superseded"); } catch { /* close race */ }
  }
  ws = null;
  window.clearInterval(heartbeatTimer);
  set({ status: "connecting" });

  if (!(await bootstrap(generation)) || generation !== connectGeneration) {
    if (generation === connectGeneration) {
      set({ status: "offline" });
      scheduleReconnect();
    }
    return;
  }

  const socket = new WebSocket(wsUrl());
  ws = socket;
  let helloComplete = false;
  const connectTimeout = window.setTimeout(() => {
    if (socket === ws && socket.readyState === WebSocket.CONNECTING) {
      try { socket.close(4000, "connect timeout"); } catch { /* close race */ }
    }
  }, CONNECT_TIMEOUT_MS);
  let helloTimeout: number | undefined;

  socket.onopen = () => {
    if (socket !== ws || generation !== connectGeneration) {
      try { socket.close(1000, "stale attempt"); } catch { /* close race */ }
      return;
    }
    window.clearTimeout(connectTimeout);
    socket.send(JSON.stringify({ t: "HELLO", protocolVersion: 2 } satisfies ClientMessage));
    helloTimeout = window.setTimeout(() => {
      if (!helloComplete && socket === ws) {
        try { socket.close(4001, "hello timeout"); } catch { /* close race */ }
      }
    }, HELLO_TIMEOUT_MS);
  };

  socket.onmessage = (event) => {
    if (socket !== ws || generation !== connectGeneration) return;
    try {
      const message = JSON.parse(event.data as string) as ServerMessage;
      if (message.t === "HELLO_OK" || message.t === "STATE") {
        helloComplete = true;
        window.clearTimeout(helloTimeout);
      }
      dispatch(socket, message);
    } catch {
      feedback("وصل رد غير صالح من الخادم. بنعيد الاتصال إذا استمرت المشكلة.");
    }
  };

  socket.onclose = () => {
    window.clearTimeout(connectTimeout);
    window.clearTimeout(helloTimeout);
    if (socket !== ws || generation !== connectGeneration) return;
    failPendingForSocket(socket);
    window.clearInterval(heartbeatTimer);
    ws = null;
    set({ status: "offline" });
    scheduleReconnect();
  };

  socket.onerror = () => {
    if (socket !== ws) return;
    try { socket.close(); } catch { /* close race */ }
  };
}

function connect(): void {
  const current = ws;
  if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) return;
  void connectNow();
}

function scheduleReconnect(): void {
  window.clearTimeout(reconnectTimer);
  const jitter = 0.8 + Math.random() * 0.4;
  reconnectTimer = window.setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 1.7, 8_000);
    connect();
  }, Math.round(reconnectDelay * jitter));
}

export function send(message: ClientMessage): boolean {
  const socket = ws;
  if (!socket || socket.readyState !== WebSocket.OPEN || state.status !== "online") {
    feedback("الاتصال مو جاهز للحين. جرّب بعد ما يرجع الاتصال.");
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}

function sendAction(message: ActionMessage): string | null {
  const socket = ws;
  if (!socket || socket.readyState !== WebSocket.OPEN || state.status !== "online") {
    feedback("الاتصال مو جاهز، لذلك ما أرسلنا الطلب.");
    return null;
  }
  const rid = newRid();
  const timeout = window.setTimeout(() => {
    const entry = pending.get(rid);
    if (!entry || entry.socket !== socket) return;
    pending.delete(rid);
    syncPendingState();
    feedback("ما وصل تأكيد للطلب. ما راح نعيده تلقائيًا؛ تأكد من حالة اللعبة قبل المحاولة.");
  }, ACTION_TIMEOUT_MS);
  pending.set(rid, { type: message.t, socket, timeout });
  syncPendingState();
  socket.send(JSON.stringify({ ...message, rid }));
  return rid;
}

if (typeof window !== "undefined") {
  connect();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const socket = ws;
    const stale = !socket || socket.readyState !== WebSocket.OPEN || performance.now() - lastInboundMono > STALE_BACKGROUND_MS;
    serverClock.resetSamples();
    if (stale) {
      if (socket) {
        failPendingForSocket(socket);
        try { socket.close(4002, "stale background connection"); } catch { /* close race */ }
      }
      if (ws === socket) ws = null;
      window.clearInterval(heartbeatTimer);
      connect();
    } else {
      sendClockSample(socket);
      window.setTimeout(() => sendClockSample(socket), 350);
      window.setTimeout(() => sendClockSample(socket), 1_000);
    }
  });
  window.addEventListener("online", connect);
}

export function useGame(): GameState {
  return useSyncExternalStore(
    (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
    () => state,
  );
}

export function clearNotice(): void { set({ notice: null }); }
export function clearTransportFeedback(): void { set({ transportFeedback: null }); }

export function resetToHome(): void {
  try { history.replaceState(null, "", "/"); } catch { /* History API can be unavailable. */ }
  set({ view: null, notice: null });
}

export const actions = {
  createRoom: () => sendAction({ t: "CREATE_ROOM" }),
  joinRoom: (code: string, name: string) => sendAction({ t: "JOIN_ROOM", code, name }),
  leaveRoom: () => sendAction({ t: "LEAVE_ROOM" }),
  setSettings: (patch: { totalRounds?: number; categories?: CategoryId[]; selectedModes?: GameMode[]; playStyle?: PlayStyle }) => sendAction({ t: "SET_SETTINGS", ...patch }),
  setAdmission: (locked: boolean) => sendAction({ t: "SET_ADMISSION", locked }),
  unblockPlayer: (uid: string) => sendAction({ t: "UNBLOCK_PLAYER", uid }),
  startGame: () => sendAction({ t: "START_GAME" }),
  markReady: () => sendAction({ t: "MARK_READY" }),
  submitAnswer: (answer: string) => sendAction({ t: "SUBMIT_ANSWER", answer }),
  startVoting: () => sendAction({ t: "START_VOTING" }),
  submitVote: (targetUid: string) => sendAction({ t: "SUBMIT_VOTE", targetUid }),
  nextRound: () => sendAction({ t: "NEXT_ROUND" }),
  kick: (uid: string) => sendAction({ t: "KICK_PLAYER", uid }),
  closeRoom: () => sendAction({ t: "CLOSE_ROOM" }),
  rematch: () => sendAction({ t: "REMATCH" }),
};
