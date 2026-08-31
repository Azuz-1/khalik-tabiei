import type { WebSocket } from "ws";
import type { ServerMessage } from "../../../shared/types.js";

let counter = 0;

/**
 * One live browser socket. `uid` is set after a valid HELLO. `roomCode` tracks
 * which room this socket is currently viewing. `origin` is the public origin
 * this client connected through (used to build correct QR/join URLs behind a
 * tunnel or custom domain).
 */
export class Connection {
  readonly id: number;
  readonly ws: WebSocket;
  uid: string | null = null;
  roomCode: string | null = null;
  origin: string;
  alive = true;

  constructor(ws: WebSocket, origin: string) {
    this.id = ++counter;
    this.ws = ws;
    this.origin = origin;
  }

  send(msg: ServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
