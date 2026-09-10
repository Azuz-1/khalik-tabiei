import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClientView } from "../../../shared/types.js";
import type { RoomState } from "./state.js";
import { buildView } from "./view.js";

const DISPLAY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function capabilityPayload(
  room: Pick<RoomState, "code" | "hostUid" | "createdAt">,
  epoch: number,
): string {
  return `${room.code}\n${room.hostUid}\n${room.createdAt}\n${epoch}`;
}

function displayAlias(
  room: Pick<RoomState, "code" | "createdAt">,
  uid: string,
  secret: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${room.code}\n${room.createdAt}\n${uid}`)
    .digest("base64url")
    .slice(0, 16);
  return `d_${digest}`;
}

/**
 * Bearer capability for the optional public display surface.
 *
 * It is bound to one concrete room instance, its current owner, and a revocation
 * epoch. Room-code reuse, ownership transfer, or epoch rotation invalidates old
 * display URLs without exposing any participant credential.
 */
export function createDisplayToken(
  room: Pick<RoomState, "code" | "hostUid" | "createdAt">,
  secret: string,
  epoch = 0,
): string {
  return createHmac("sha256", secret).update(capabilityPayload(room, epoch)).digest("base64url");
}

export function verifyDisplayToken(
  room: Pick<RoomState, "code" | "hostUid" | "createdAt">,
  secret: string,
  candidate: unknown,
  epoch = 0,
): boolean {
  if (typeof candidate !== "string" || !DISPLAY_TOKEN_PATTERN.test(candidate)) return false;
  const expected = createDisplayToken(room, secret, epoch);
  const expectedBytes = Buffer.from(expected, "ascii");
  const candidateBytes = Buffer.from(candidate, "ascii");
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

/**
 * Public display projection. It intentionally starts from the spectator/public
 * projection and then constructs an allowlisted shape with room-local aliases.
 * Real anonymous-session UIDs never cross the Display boundary.
 */
export function buildDisplayView(room: RoomState, joinUrl: string, secret: string): ClientView {
  const source = buildView(room, `display:${room.createdAt}`, joinUrl);
  const alias = (uid: string) => displayAlias(room, uid, secret);

  const players = source.players.map((player, index) => ({
    ...player,
    uid: alias(player.uid),
    // Display seat labels are local to this room incarnation and therefore
    // cannot become a stable cross-room browser fingerprint.
    seatNumber: index + 1,
  }));

  const result = source.result
    ? {
        ...source.result,
        ...(source.result.impostorUid ? { impostorUid: alias(source.result.impostorUid) } : {}),
        ...(source.result.voteTally
          ? { voteTally: source.result.voteTally.map((entry) => ({ ...entry, uid: alias(entry.uid) })) }
          : {}),
      }
    : undefined;

  return {
    self: {
      uid: "display",
      role: "spectator",
      connected: true,
      isOwner: false,
    },
    room: {
      code: source.room.code,
      phase: source.room.phase,
      currentRound: source.room.currentRound,
      totalRounds: source.room.totalRounds,
      targetChallenges: source.room.targetChallenges,
      completedChallenges: source.room.completedChallenges,
      maxPlayers: source.room.maxPlayers,
      minPlayers: source.room.minPlayers,
      hostUid: alias(source.room.hostUid),
      hostConnected: source.room.hostConnected,
      admissionLocked: source.room.admissionLocked,
      playStyle: source.room.playStyle,
      selectedModes: source.room.selectedModes,
      availableModes: source.room.availableModes,
      categories: source.room.categories,
      availableCategories: source.room.availableCategories,
      joinUrl: source.room.joinUrl,
      ...(source.room.phaseEndsAt !== undefined ? { phaseEndsAt: source.room.phaseEndsAt } : {}),
    },
    players,
    ...(source.challenge ? { challenge: source.challenge } : {}),
    ...(source.publicPrompt ? { publicPrompt: source.publicPrompt } : {}),
    ...(source.readyProgress ? { readyProgress: source.readyProgress } : {}),
    ...(source.answersProgress ? { answersProgress: source.answersProgress } : {}),
    ...(source.reveal ? { reveal: source.reveal.map((entry) => ({ ...entry, uid: alias(entry.uid) })) } : {}),
    ...(source.votesProgress ? { votesProgress: source.votesProgress } : {}),
    ...(result ? { result } : {}),
    ...(source.gameOver ? { gameOver: source.gameOver } : {}),
    ...(source.scoreboard
      ? { scoreboard: source.scoreboard.map((entry) => ({ ...entry, uid: alias(entry.uid) })) }
      : {}),
  };
}
