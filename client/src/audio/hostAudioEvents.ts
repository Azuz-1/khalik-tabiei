import type { GamePhase } from "../../../shared/types.js";

export type CountdownStep = 1 | 2 | 3 | 4 | 5;

export type HostAudioEvent =
  | { type: "countdownTick"; step: CountdownStep }
  | { type: "action" }
  | { type: "hold" }
  | { type: "promptReveal" }
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

  update(snapshot: HostAudioSnapshot): HostAudioEvent[] {
    if (!this.initialized || snapshot.roomCode !== this.roomCode) {
      this.prime(snapshot);
      return [];
    }

    const events: HostAudioEvent[] = [];
    const previousPhase = this.phase;
    const previousRound = this.currentRound;
    const previousChallengeIndex = this.challengeIndex;

    // A rematch keeps the same room code and players but starts a fresh game.
    // Reset only per-game event dedupe; keep seen player UIDs so returning to
    // the Lobby does not create fake join sounds for existing participants.
    const newGameLifecycle =
      (snapshot.phase === "LOBBY" && previousPhase !== "LOBBY") ||
      snapshot.currentRound < previousRound;
    if (newGameLifecycle) this.resetPerGameDedupe();

    // If an explicit retry/redeal path ever restarts this Round at QUESTION,
    // allow the new physical attempt to make its own result sound even when
    // room/round/challenge identifiers collide with a result already heard.
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

    if (snapshot.phase !== previousPhase) {
      if (snapshot.phase === "COUNTDOWN" || previousPhase === "COUNTDOWN") {
        this.lastCountdownStep = null;
      }

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
      // The server computes RESULT before broadcasting the final real vote, so
      // the Host may never receive a VOTING snapshot with submitted === total.
      // Recover that one aggregate increment only when the participant set did
      // not shrink. A KICK/LEAVE can also turn 3/4 into RESULT with no new vote;
      // that transition must not synthesize a fake fourth vote sound.
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

  private resetPerGameDedupe(): void {
    this.playedResultKeys.clear();
    this.submittedVotes = 0;
    this.totalVotes = 0;
    this.votingPlayerUids.clear();
    this.lastCountdownStep = null;
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

    if (snapshot.phase === "RESULT") {
      const key = resultKey(snapshot);
      if (key) this.playedResultKeys.add(key);
    }
  }
}
