/**
 * WebSocket client + reactive store. Owns the single connection to the
 * authoritative server, bootstraps an HttpOnly anonymous session, auto-reconnects,
 * and exposes typed action helpers plus a `useGame()` hook.
 *
 * The client is intentionally "dumb": it renders whatever `view` the server
 * sends and never computes game logic locally.
 */
import { useSyncExternalStore } from "react";
import type {
  ClientMessage,
  ClientView,
  ErrorCode,
  ServerMessage,
  CategoryId,
} from "../../../shared/types.js";

export interface GameState {
  status: "connecting" | "online" | "offline";
  uid: string | null;
  view: ClientView | null;
  /** Last error from the server, with a monotonically increasing id. */
  error: { code: ErrorCode; id: number } | null;
  /** A transient full-screen notice (room closed / kicked). */
  notice: string | null;
}

let state: GameState = {
  status: "connecting",
  uid: null,
  view: null,
  error: null,
  notice: null,
};

const listeners = new Set<() => void>();
let errorSeq = 0;

function set(patch: Partial<GameState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

// ---- connection ----------------------------------------------------------

let ws: WebSocket | null = null;
let reconnectDelay = 500;
let reconnectTimer: number | undefined;
let connecting = false;

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

async function connectNow(): Promise<void> {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (connecting) return;
  connecting = true;
  set({ status: "connecting" });
  try {
    const response = await fetch("/api/session", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("session bootstrap failed");
  } catch {
    connecting = false;
    set({ status: "offline" });
    scheduleReconnect();
    return;
  }
  ws = new WebSocket(wsUrl());
  connecting = false;

  ws.onopen = () => {
    reconnectDelay = 500;
    send({ t: "HELLO" });
  };
  ws.onmessage = (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data as string) as ServerMessage;
    } catch {
      return;
    }
    dispatch(msg);
  };
  ws.onclose = () => {
    set({ status: "offline" });
    scheduleReconnect();
  };
  ws.onerror = () => {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  };
}

function connect(): void {
  void connectNow();
}

function scheduleReconnect(): void {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 1.7, 8000);
    connect();
  }, reconnectDelay);
}

function dispatch(msg: ServerMessage): void {
  switch (msg.t) {
    case "HELLO_OK":
      set({ status: "online", uid: msg.uid, view: null });
      break;
    case "STATE":
      set({ status: "online", view: msg.view, uid: msg.view.self.uid });
      break;
    case "ERROR":
      errorSeq += 1;
      set({ error: { code: msg.code, id: errorSeq } });
      break;
    case "ROOM_CLOSED":
      set({ view: null, notice: "الغرفة مقفلة" });
      break;
    case "KICKED":
      set({ view: null, notice: "تم إخراجك من الغرفة" });
      break;
    case "PONG":
      break;
  }
}

export function send(msg: ClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ---- lifecycle & tab visibility ------------------------------------------

if (typeof window !== "undefined") {
  connect();
  // Reconnect promptly when the user returns to the tab / regains network.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") connect();
  });
  window.addEventListener("online", () => connect());
}

// ---- store hook -----------------------------------------------------------

export function useGame(): GameState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function clearNotice(): void {
  set({ notice: null });
}

/** Return to the home screen locally (e.g. after leaving a room). */
export function resetToHome(): void {
  try {
    history.replaceState(null, "", "/");
  } catch {
    /* ignore */
  }
  set({ view: null, notice: null });
}

// ---- typed actions --------------------------------------------------------

export const actions = {
  createRoom: () => send({ t: "CREATE_ROOM" }),
  joinRoom: (code: string, name: string) => send({ t: "JOIN_ROOM", code, name }),
  leaveRoom: () => {
    send({ t: "LEAVE_ROOM" });
  },
  setSettings: (patch: { totalRounds?: number; categories?: CategoryId[] }) =>
    send({ t: "SET_SETTINGS", ...patch }),
  startGame: () => send({ t: "START_GAME" }),
  submitAnswer: (answer: string) => send({ t: "SUBMIT_ANSWER", answer }),
  startVoting: () => send({ t: "START_VOTING" }),
  submitVote: (targetUid: string) => send({ t: "SUBMIT_VOTE", targetUid }),
  nextRound: () => send({ t: "NEXT_ROUND" }),
  kick: (uid: string) => send({ t: "KICK_PLAYER", uid }),
  closeRoom: () => send({ t: "CLOSE_ROOM" }),
  rematch: () => send({ t: "REMATCH" }),
};
