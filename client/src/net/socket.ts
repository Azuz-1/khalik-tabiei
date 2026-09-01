import { useSyncExternalStore } from "react";
import type {
  CategoryId,
  ClientMessage,
  ClientView,
  ErrorCode,
  GameMode,
  ServerMessage,
} from "../../../shared/types.js";

export interface GameState {
  status: "connecting" | "online" | "offline";
  uid: string | null;
  view: ClientView | null;
  error: { code: ErrorCode; id: number } | null;
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
let ws: WebSocket | null = null;
let reconnectDelay = 500;
let reconnectTimer: number | undefined;
let connecting = false;

function set(patch: Partial<GameState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function wsUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

async function connectNow(): Promise<void> {
  const socketBusy =
    ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
  if (socketBusy || connecting) return;

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
  ws.onmessage = (event) => {
    try {
      dispatch(JSON.parse(event.data as string) as ServerMessage);
    } catch {
      // Ignore malformed server frames. The server is authoritative.
    }
  };
  ws.onclose = () => {
    set({ status: "offline" });
    scheduleReconnect();
  };
  ws.onerror = () => {
    try {
      ws?.close();
    } catch {
      // Ignore close races.
    }
  };
}

function connect(): void {
  void connectNow();
}

function scheduleReconnect(): void {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 1.7, 8_000);
    connect();
  }, reconnectDelay);
}

function dispatch(message: ServerMessage): void {
  switch (message.t) {
    case "HELLO_OK":
      set({ status: "online", uid: message.uid, view: null });
      break;
    case "STATE":
      set({ status: "online", view: message.view, uid: message.view.self.uid });
      break;
    case "ERROR":
      errorSeq += 1;
      set({ error: { code: message.code, id: errorSeq } });
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

export function send(message: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

if (typeof window !== "undefined") {
  connect();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") connect();
  });
  window.addEventListener("online", connect);
}

export function useGame(): GameState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => state,
  );
}

export function clearNotice(): void {
  set({ notice: null });
}

export function resetToHome(): void {
  try {
    history.replaceState(null, "", "/");
  } catch {
    // Ignore History API failures.
  }
  set({ view: null, notice: null });
}

export const actions = {
  createRoom: () => send({ t: "CREATE_ROOM" }),
  joinRoom: (code: string, name: string) => send({ t: "JOIN_ROOM", code, name }),
  leaveRoom: () => send({ t: "LEAVE_ROOM" }),
  setSettings: (patch: {
    totalRounds?: number;
    categories?: CategoryId[];
    selectedModes?: GameMode[];
  }) => send({ t: "SET_SETTINGS", ...patch }),
  startGame: () => send({ t: "START_GAME" }),
  markReady: () => send({ t: "MARK_READY" }),
  submitAnswer: (answer: string) => send({ t: "SUBMIT_ANSWER", answer }),
  startVoting: () => send({ t: "START_VOTING" }),
  submitVote: (targetUid: string) => send({ t: "SUBMIT_VOTE", targetUid }),
  nextRound: () => send({ t: "NEXT_ROUND" }),
  kick: (uid: string) => send({ t: "KICK_PLAYER", uid }),
  closeRoom: () => send({ t: "CLOSE_ROOM" }),
  rematch: () => send({ t: "REMATCH" }),
};
