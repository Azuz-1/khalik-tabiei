import type { GamePhase } from "../../../shared/types.js";

export type CountdownStep = 1 | 2 | 3 | 4 | 5;

export type HostAudioEvent =
  | { type: "countdownTick"; step: CountdownStep }
  | { type: "action" }
  | { type: "hold" }
  | { type: "promptReveal" }
  | { type: "discussionWarning" }
  | { type: "votingStart" }
  | { type: "voteReceived"; count: number }
  | { type: "caught" }
  | { type: "escaped" }
  | { type: "challengeSurvived" }
  | { type: "gameOver" }
  | { type: "join"; count: number };

export interface HostAudioSnapshot {
  roomCode: string;
  phase: GamePhase;
  currentRound: number;
  challengeIndex?: number;
  submittedVotes?: number;
  totalVotes?: number;
  /**
   * Authoritative server deadline for the current phase. For COUNTDOWN this is
   * a per-attempt constant, so it doubles as public countdown-attempt identity:
   * a Host reconnect restarts the same Challenge's countdown without any phase
   * change, and only a fresh deadline distinguishes that new attempt from more
   * snapshots of the old one.
   */
  phaseEndsAt?: number;
  playerUids: string[];
  result?: {
    groupFound: boolean;
    roundComplete: boolean;
    challengeIndex: number;
  };
}

export function visibleCountdownSecond(
  phaseEndsAt: number | undefined,
  now: number,
): CountdownStep | null {
  if (phaseEndsAt == null || !Number.isFinite(phaseEndsAt)) return null;
  const remaining = Math.max(0, phaseEndsAt - now);
  return Math.max(1, Math.min(5, Math.ceil(remaining / 1_000))) as CountdownStep;
}

function resultKey(snapshot: HostAudioSnapshot): string | null {
  if (!snapshot.result) return null;
  const result = snapshot.result;
  return [
    snapshot.roomCode,
    snapshot.currentRound,
    result.challengeIndex,
    result.roundComplete ? "round" : "challenge",
    result.groupFound ? "caught" : "survived",
  ].join(":");
}

/**
 * Stateful, browser-independent event de-duplicator for Host/TV audio.
 * The first snapshot only primes state so refresh/reconnect does not replay
 * historical phase/result/join sounds.
 */
export class HostAudioEventController {
  private initialized = false;
  private roomCode = "";
  private phase: GamePhase | null = null;
  private currentRound = 0;
  private challengeIndex: number | undefined;
  private submittedVotes = 0;
  private totalVotes = 0;
  private votingPlayerUids = new Set<string>();
  private seenPlayerUids = new Set<string>();
  private playedResultKeys = new Set<string>();
  private lastCountdownStep: CountdownStep | null = null;
  private countdownDeadline: number | null = null;
  private countdownPaused = false;
  private discussionWarningPlayed = false;

  update(snapshot: HostAudioSnapshot): HostAudioEvent[] {
    if (!this.initialized || snapshot.roomCode !== this.roomCode) {
      this.prime(snapshot);
      return [];
    }

    const events: HostAudioEvent[] = [];
    const previousPhase = this.phase;
    const previousRound = this.currentRound;
    const previousChallengeIndex = this.challengeIndex;

    const newGameLifecycle =
      (snapshot.phase === "LOBBY" && previousPhase !== "LOBBY") ||
      snapshot.currentRound < previousRound;
    if (newGameLifecycle) this.resetPerGameDedupe();

    const redealtCurrentRound =
      !newGameLifecycle &&
      snapshot.phase === "QUESTION" &&
      previousPhase !== null &&
      previousPhase !== "QUESTION" &&
      snapshot.currentRound === previousRound &&
      snapshot.challengeIndex != null &&
      previousChallengeIndex != null &&
      snapshot.challengeIndex <= previousChallengeIndex;
    if (redealtCurrentRound) this.resetCurrentRoundDedupe(snapshot.currentRound);

    let newPlayers = 0;
    for (const uid of snapshot.playerUids) {
      if (!this.seenPlayerUids.has(uid)) newPlayers += 1;
      this.seenPlayerUids.add(uid);
    }
    if (snapshot.phase === "LOBBY" && newPlayers > 0) {
      events.push({ type: "join", count: newPlayers });
    }

    const countdownDeadline =
      snapshot.phase === "COUNTDOWN" ? snapshot.phaseEndsAt ?? null : null;
    const countdownPaused = snapshot.phase === "COUNTDOWN" && countdownDeadline === null;
    const restartedCountdown =
      snapshot.phase === "COUNTDOWN" &&
      previousPhase === "COUNTDOWN" &&
      countdownDeadline !== null &&
      (this.countdownPaused ||
        (this.countdownDeadline !== null && countdownDeadline !== this.countdownDeadline));
    if (restartedCountdown) this.lastCountdownStep = null;
    this.countdownPaused = countdownPaused;
    if (countdownDeadline !== null) this.countdownDeadline = countdownDeadline;
    else if (snapshot.phase !== "COUNTDOWN") this.countdownDeadline = null;

    if (snapshot.phase !== previousPhase) {
      if (snapshot.phase === "COUNTDOWN" || previousPhase === "COUNTDOWN") {
        this.lastCountdownStep = null;
      }
      if (snapshot.phase === "DISCUSSION") this.discussionWarningPlayed = false;
      else if (previousPhase === "DISCUSSION") this.discussionWarningPlayed = false;

      switch (snapshot.phase) {
        case "ACTION":
          events.push({ type: "action" });
          break;
        case "HOLD":
          events.push({ type: "hold" });
          break;
        case "PROMPT_REVEAL":
          events.push({ type: "promptReveal" });
          break;
        case "VOTING":
          events.push({ type: "votingStart" });
          break;
        case "GAME_OVER":
          events.push({ type: "gameOver" });
          break;
        default:
          break;
      }
    }

    if (snapshot.phase === "VOTING") {
      const submitted = snapshot.submittedVotes ?? 0;
      const total = snapshot.totalVotes ?? this.totalVotes;
      if (previousPhase === "VOTING" && submitted > this.submittedVotes) {
        events.push({ type: "voteReceived", count: submitted - this.submittedVotes });
      }
      this.submittedVotes = submitted;
      this.totalVotes = total;
      this.votingPlayerUids = new Set(snapshot.playerUids);
    } else if (snapshot.phase === "RESULT" && previousPhase === "VOTING") {
      const participantShrank = [...this.votingPlayerUids].some(
        (uid) => !snapshot.playerUids.includes(uid),
      );
      const finalIncrement = participantShrank
        ? 0
        : Math.max(0, this.totalVotes - this.submittedVotes);
      if (finalIncrement > 0) {
        events.push({ type: "voteReceived", count: finalIncrement });
      }
      this.submittedVotes = 0;
      this.totalVotes = 0;
      this.votingPlayerUids.clear();
    } else {
      this.submittedVotes = 0;
      this.totalVotes = 0;
      this.votingPlayerUids.clear();
    }

    if (snapshot.phase === "RESULT" && snapshot.result) {
      const key = resultKey(snapshot);
      if (previousPhase !== "RESULT" && key && !this.playedResultKeys.has(key)) {
        if (!snapshot.result.roundComplete) {
          events.push({ type: "challengeSurvived" });
        } else if (snapshot.result.groupFound) {
          events.push({ type: "caught" });
        } else {
          events.push({ type: "escaped" });
        }
      }
      if (key) this.playedResultKeys.add(key);
    }

    this.phase = snapshot.phase;
    this.currentRound = snapshot.currentRound;
    this.challengeIndex = snapshot.challengeIndex;
    return events;
  }

  observeCountdown(step: CountdownStep | null): HostAudioEvent[] {
    if (this.phase !== "COUNTDOWN" || step == null) return [];
    if (step === this.lastCountdownStep) return [];
    this.lastCountdownStep = step;
    return [{ type: "countdownTick", step }];
  }

  observeDiscussionWarning(phaseEndsAt: number | undefined, now: number): HostAudioEvent[] {
    if (
      this.phase !== "DISCUSSION" ||
      this.discussionWarningPlayed ||
      phaseEndsAt == null ||
      !Number.isFinite(phaseEndsAt)
    ) return [];
    const remaining = phaseEndsAt - now;
    if (remaining <= 0 || remaining > 10_000) return [];
    this.discussionWarningPlayed = true;
    return [{ type: "discussionWarning" }];
  }

  private resetPerGameDedupe(): void {
    this.playedResultKeys.clear();
    this.submittedVotes = 0;
    this.totalVotes = 0;
    this.votingPlayerUids.clear();
    this.lastCountdownStep = null;
    this.countdownDeadline = null;
    this.countdownPaused = false;
    this.discussionWarningPlayed = false;
  }

  private resetCurrentRoundDedupe(round: number): void {
    const prefix = `${this.roomCode}:${round}:`;
    for (const key of [...this.playedResultKeys]) {
      if (key.startsWith(prefix)) this.playedResultKeys.delete(key);
    }
    this.submittedVotes = 0;
    this.totalVotes = 0;
    this.votingPlayerUids.clear();
    this.lastCountdownStep = null;
    this.countdownDeadline = null;
    this.countdownPaused = false;
    this.discussionWarningPlayed = false;
  }

  private prime(snapshot: HostAudioSnapshot): void {
    this.initialized = true;
    this.roomCode = snapshot.roomCode;
    this.phase = snapshot.phase;
    this.currentRound = snapshot.currentRound;
    this.challengeIndex = snapshot.challengeIndex;
    this.submittedVotes = snapshot.phase === "VOTING" ? snapshot.submittedVotes ?? 0 : 0;
    this.totalVotes = snapshot.phase === "VOTING" ? snapshot.totalVotes ?? 0 : 0;
    this.votingPlayerUids = snapshot.phase === "VOTING"
      ? new Set(snapshot.playerUids)
      : new Set<string>();
    this.seenPlayerUids = new Set(snapshot.playerUids);
    this.playedResultKeys = new Set<string>();
    this.lastCountdownStep = null;
    this.countdownDeadline =
      snapshot.phase === "COUNTDOWN" ? snapshot.phaseEndsAt ?? null : null;
    this.countdownPaused = snapshot.phase === "COUNTDOWN" && this.countdownDeadline === null;
    this.discussionWarningPlayed = false;

    if (snapshot.phase === "RESULT") {
      const key = resultKey(snapshot);
      if (key) this.playedResultKeys.add(key);
    }
  }
}
