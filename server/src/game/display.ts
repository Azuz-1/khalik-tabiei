import { createHmac, timingSafeEqual } from "node:crypto";
import type { RoomState } from "./state.js";

const DISPLAY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function payload(room: Pick<RoomState, "code" | "hostUid" | "createdAt">): string {
  return `${room.code}\n${room.hostUid}\n${room.createdAt}`;
}

/**
 * Bearer capability for the optional public display surface.
 *
 * It is bound to one concrete room instance (code + owner + creation time), so
 * a future room that happens to reuse the same short code cannot reuse an old
 * display URL.
 */
export function createDisplayToken(
  room: Pick<RoomState, "code" | "hostUid" | "createdAt">,
  secret: string,
): string {
  return createHmac("sha256", secret).update(payload(room)).digest("base64url");
}

export function verifyDisplayToken(
  room: Pick<RoomState, "code" | "hostUid" | "createdAt">,
  secret: string,
  candidate: unknown,
): boolean {
  if (typeof candidate !== "string" || !DISPLAY_TOKEN_PATTERN.test(candidate)) return false;
  const expected = createDisplayToken(room, secret);
  const expectedBytes = Buffer.from(expected, "ascii");
  const candidateBytes = Buffer.from(candidate, "ascii");
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}
