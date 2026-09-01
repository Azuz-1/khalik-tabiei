import type { ServerMessage } from "../../shared/types.js";
import { Connection } from "../src/net/connection.js";
import { RoomManager } from "../src/game/roomManager.js";
import type { WebSocket } from "ws";

export function testUid(index: number): string {
  return `u_${index.toString(16).padStart(24, "0")}`;
}

export class FakeSocket {
  readyState = 1;
  bufferedAmount = 0;
  messages: ServerMessage[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  terminated = false;

  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }
}

export function authenticatedConnection(
  manager: RoomManager,
  uid: string,
  origin = "http://localhost:8080",
): { conn: Connection; socket: FakeSocket } {
  const socket = new FakeSocket();
  const conn = new Connection(socket as unknown as WebSocket, origin, "127.0.0.1");
  if (!conn.authenticate(uid)) throw new Error("test authentication failed");
  manager.register(conn);
  return { conn, socket };
}

export function lastMessage<T extends ServerMessage["t"]>(
  socket: FakeSocket,
  type: T,
): Extract<ServerMessage, { t: T }> | undefined {
  return [...socket.messages].reverse().find((message) => message.t === type) as
    | Extract<ServerMessage, { t: T }>
    | undefined;
}

export function createRoom(manager: RoomManager, uid = testUid(1)) {
  const host = authenticatedConnection(manager, uid);
  manager.handle(host.conn, { t: "CREATE_ROOM" });
  const state = lastMessage(host.socket, "STATE");
  if (!state) throw new Error("room state missing");
  return { ...host, uid, code: state.view.room.code };
}

export function joinPlayer(
  manager: RoomManager,
  code: string,
  index: number,
  name = `لاعب${index}`,
) {
  const uid = testUid(index);
  const client = authenticatedConnection(manager, uid);
  manager.handle(client.conn, { t: "JOIN_ROOM", code, name });
  return { ...client, uid };
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
