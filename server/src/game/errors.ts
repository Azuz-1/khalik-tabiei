import type { ErrorCode } from "../../../shared/types.js";

/**
 * A typed, expected game error. These are safe to surface to clients (the
 * frontend maps `code` to Arabic copy). Never leak stack traces to players.
 */
export class GameError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = "GameError";
    this.code = code;
  }
}

export function isGameError(e: unknown): e is GameError {
  return e instanceof GameError;
}
