import type { ClientView } from "../../../shared/types.js";

/**
 * Presentation-only privacy curtain state for the private challenge screen.
 *
 * The curtain lives in component state only (never a module-level cache), so
 * every fresh entry into QUESTION — the next challenge, a new stint, a new match
 * after rematch — starts covered. While the screen stays mounted it re-covers
 * whenever the observable private deal changes, readiness drops (readiness only
 * grows within one deal, so a drop means the server dealt again, e.g. a
 * role-blind redeal), or the phone reconnects. Extra re-covering is harmless; a
 * missed one is not, so every rule errs toward covering.
 *
 * This decides nothing about the game: the server's per-recipient projection
 * remains the only security boundary.
 */

export interface CurtainState {
  dealKey: string;
  submitted: number;
  online: boolean;
  revealed: boolean;
}

/** Everything the client can observe that identifies the private deal it is looking at. */
export function privateDealKey(view: ClientView): string {
  return JSON.stringify([
    view.room.code,
    view.room.currentRound,
    view.room.completedChallenges,
    view.challenge?.index ?? null,
    view.challenge?.max ?? null,
    view.challenge?.mode ?? null,
    view.isImpostor === true,
    view.myPrompt?.text ?? null,
    view.readyProgress?.total ?? null,
  ]);
}

export function initialCurtain(dealKey: string, submitted: number, online: boolean): CurtainState {
  return { dealKey, submitted, online, revealed: false };
}

/** Returns `state` itself when nothing changed, so callers can compare by identity. */
export function advanceCurtain(state: CurtainState, dealKey: string, submitted: number, online: boolean): CurtainState {
  const newDeal = dealKey !== state.dealKey;
  const readinessDropped = submitted < state.submitted;
  const reconnected = online && !state.online;
  if (newDeal || readinessDropped || reconnected) return initialCurtain(dealKey, submitted, online);
  if (submitted === state.submitted && online === state.online) return state;
  return { ...state, submitted, online };
}

export function revealCurtain(state: CurtainState): CurtainState {
  return state.revealed ? state : { ...state, revealed: true };
}

export function coverCurtain(state: CurtainState): CurtainState {
  return state.revealed ? { ...state, revealed: false } : state;
}
