import type { PublicPlayer } from "../../../shared/types.js";

/** Live player chips. Seat number is visible; connection color is supplementary. */
export function Players({
  players,
  selfUid,
  canKick,
  onKick,
}: {
  players: PublicPlayer[];
  selfUid?: string;
  canKick?: boolean;
  onKick?: (uid: string) => void;
}) {
  return (
    <div className="players">
      {players.map((player) => (
        <span key={player.uid} className={`chip${player.connected ? "" : " off"}`}>
          <span className="seat-badge" aria-label={`مقعد ${player.seatNumber}`}>{player.seatNumber}</span>
          <span className="dot" aria-hidden="true" />
          <span>{player.name}{player.uid === selfUid ? " (أنت)" : ""}</span>
          <span className="sr-only">{player.connected ? "متصل" : "منقطع"}</span>
          {canKick && onKick ? (
            <button
              type="button"
              className="kick"
              aria-label={`إخراج ${player.name} من مقعد ${player.seatNumber}`}
              onClick={() => onKick(player.uid)}
            >
              ✕
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function Progress({ submitted, total, verb }: { submitted: number; total: number; verb: string }) {
  const pct = total > 0 ? Math.round((submitted / total) * 100) : 0;
  return (
    <div className="progress-big stack">
      <div className="num">{submitted} <span style={{ color: "var(--muted)" }}>/ {total}</span></div>
      <div className="subtitle center">{verb}</div>
      <div className="bar" role="progressbar" aria-label={verb} aria-valuemin={0} aria-valuemax={total} aria-valuenow={submitted}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
