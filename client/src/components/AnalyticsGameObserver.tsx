import { useEffect } from "react";
import { useGame } from "../net/socket.js";

let matchActive = false;

function routeBucket(): string {
  if (/^\/join\//.test(location.pathname)) return "join";
  return location.pathname === "/" ? "home" : "other";
}

function reportMatchParticipation(view: NonNullable<ReturnType<typeof useGame>["view"]>): void {
  const body = {
    events: [{
      event: "client_session_summary",
      props: {
        summaryKind: "match_participation",
        playedMatch: true,
        phase: view.room.phase,
        isOwner: view.self.isOwner === true,
        playerCount: view.players.length,
        targetChallenges: view.room.targetChallenges,
        modeCount: view.room.selectedModes.length,
        routeBucket: routeBucket(),
      },
    }],
  };

  void fetch("/api/telemetry", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => { /* analytics must never affect gameplay */ });
}

/**
 * Reports one match-participation marker per browser match lifecycle.
 * The server adds a pseudonymous analytics id; this component never reads the
 * HttpOnly session token and never sends room codes, player names, prompts, or UIDs.
 */
export function AnalyticsGameObserver() {
  const game = useGame();

  useEffect(() => {
    const view = game.view;
    if (!view || view.self.role !== "player") {
      matchActive = false;
      return;
    }

    if (view.room.phase === "LOBBY" || view.room.phase === "GAME_OVER" || view.room.phase === "CLOSED") {
      matchActive = false;
      return;
    }

    if (matchActive) return;
    matchActive = true;
    reportMatchParticipation(view);
  }, [game.view]);

  return null;
}
