import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientView } from "../../../shared/types.js";
import {
  disposeAudio,
  isMuted,
  playAction,
  playCaught,
  playChallengeSurvived,
  playCountdownTick,
  playEscaped,
  playGameOver,
  playHold,
  playJoin,
  playPromptReveal,
  playVoteReceived,
  playVotingStart,
  setMuted,
  unlockAudio,
} from "./gameAudio.js";
import {
  HostAudioEventController,
  visibleCountdownSecond,
  type HostAudioEvent,
  type HostAudioSnapshot,
} from "./hostAudioEvents.js";

function snapshotFromView(view: ClientView): HostAudioSnapshot {
  return {
    roomCode: view.room.code,
    phase: view.room.phase,
    currentRound: view.room.currentRound,
    challengeIndex: view.challenge?.index,
    submittedVotes: view.votesProgress?.submitted,
    totalVotes: view.votesProgress?.total,
    playerUids: view.players.map((player) => player.uid),
    result: view.result
      ? {
          groupFound: view.result.groupFound,
          roundComplete: view.result.roundComplete,
          challengeIndex: view.result.challengeIndex,
        }
      : undefined,
  };
}

function playEvents(events: HostAudioEvent[]): void {
  for (const event of events) {
    switch (event.type) {
      case "countdownTick":
        playCountdownTick(event.step);
        break;
      case "action":
        playAction();
        break;
      case "hold":
        playHold();
        break;
      case "promptReveal":
        playPromptReveal();
        break;
      case "votingStart":
        playVotingStart();
        break;
      case "voteReceived":
        playVoteReceived(event.count);
        break;
      case "caught":
        playCaught();
        break;
      case "escaped":
        playEscaped();
        break;
      case "challengeSurvived":
        playChallengeSurvived();
        break;
      case "gameOver":
        playGameOver();
        break;
      case "join":
        playJoin();
        break;
    }
  }
}

export function useHostGameAudio(view: ClientView): {
  muted: boolean;
  toggleMuted: () => void;
} {
  const controllerRef = useRef<HostAudioEventController | null>(null);
  if (!controllerRef.current) controllerRef.current = new HostAudioEventController();

  const [muted, setMutedState] = useState(() => isMuted());

  useEffect(() => {
    playEvents(controllerRef.current!.update(snapshotFromView(view)));
  }, [view]);

  useEffect(() => {
    if (view.room.phase !== "COUNTDOWN") return;

    const observe = () => {
      const step = visibleCountdownSecond(view.room.phaseEndsAt, Date.now());
      playEvents(controllerRef.current!.observeCountdown(step));
    };

    observe();
    const timer = window.setInterval(observe, 100);
    return () => window.clearInterval(timer);
  }, [view.room.code, view.room.phase, view.room.phaseEndsAt]);

  useEffect(() => {
    // Keep trying on real Host gestures. Calling unlockAudio() while already
    // running is cheap, and unlike a one-shot flag this also recovers after
    // BFCache/pagehide disposal or browser audio interruptions.
    const tryUnlock = () => {
      void unlockAudio();
    };

    document.addEventListener("pointerdown", tryUnlock, true);
    document.addEventListener("keydown", tryUnlock, true);
    return () => {
      document.removeEventListener("pointerdown", tryUnlock, true);
      document.removeEventListener("keydown", tryUnlock, true);
    };
  }, []);

  useEffect(() => {
    const dispose = () => {
      void disposeAudio();
    };
    window.addEventListener("pagehide", dispose);
    return () => window.removeEventListener("pagehide", dispose);
  }, []);

  const toggleMuted = useCallback(() => {
    const next = !muted;
    if (!next) void unlockAudio();
    setMuted(next);
    setMutedState(next);
  }, [muted]);

  return { muted, toggleMuted };
}
