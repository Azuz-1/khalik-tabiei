import type { WebSocket } from "ws";
import type { ServerMessage } from "../../../shared/types.js";

let counter = 0;

/** One live browser socket with bounded writes and one-time authentication. */
export class Connection {
  readonly id: number;
  readonly ws: WebSocket;
  readonly origin: string;
  readonly ip: string;
  uid: string | null = null;
  roomCode: string | null = null;
  alive = true;
  private disconnected = false;
  private policyClosing = false;
  private authTimer: NodeJS.Timeout | null = null;

  constructor(
    ws: WebSocket,
    origin: string,
    ip: string,
    private readonly maxBufferedBytes = 512 * 1024,
  ) {
    this.id = ++counter;
    this.ws = ws;
    this.origin = origin;
    this.ip = ip;
  }

  authenticate(uid: string): boolean {
    if (this.uid !== null || this.policyClosing) return false;
    this.uid = uid;
    this.clearAuthenticationTimeout();
    return true;
  }

  startAuthenticationTimeout(ms: number): void {
    this.clearAuthenticationTimeout();
    this.authTimer = setTimeout(() => {
      if (this.uid === null) this.closePolicy("authentication timeout");
    }, ms);
    this.authTimer.unref?.();
  }

  clearAuthenticationTimeout(): void {
    if (this.authTimer) clearTimeout(this.authTimer);
    this.authTimer = null;
  }

  /** Returns true only once, making close/error cleanup idempotent. */
  markDisconnected(): boolean {
    if (this.disconnected) return false;
    this.disconnected = true;
    this.clearAuthenticationTimeout();
    return true;
  }

  /** Once a policy close starts, queued/in-flight client frames are ignored. */
  canProcessIncoming(): boolean {
    return !this.policyClosing && !this.disconnected;
  }

  send(msg: ServerMessage): boolean {
    if (this.policyClosing || this.ws.readyState !== 1) return false;
    if (this.ws.bufferedAmount > this.maxBufferedBytes) {
      try {
        this.ws.terminate();
      } catch {
        /* close/error cleanup is idempotent */
      }
      return false;
    }
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      try {
        this.ws.terminate();
      } catch {
        /* ignore */
      }
      return false;
    }
  }

  closePolicy(reason: string): void {
    if (this.policyClosing) return;
    this.policyClosing = true;
    this.clearAuthenticationTimeout();
    try {
      this.ws.close(1008, reason.slice(0, 80));
    } catch {
      try {
        this.ws.terminate();
      } catch {
        /* ignore */
      }
    }
  }
}
