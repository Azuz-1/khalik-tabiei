import type { PublicPlayer } from "../../../shared/types.js";

/** Live player chips. In host lobby, the host can kick players. */
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
      {players.map((p) => (
        <span key={p.uid} className={`chip${p.connected ? "" : " off"}`}>
          <span className="dot" />
          {p.name}
          {p.uid === selfUid ? " (أنت)" : ""}
          {canKick && onKick ? (
            <button
              className="kick"
              aria-label={`إخراج ${p.name}`}
              onClick={() => onKick(p.uid)}
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
      <div className="num">
        {submitted} <span style={{ color: "var(--muted)" }}>/ {total}</span>
      </div>
      <div className="subtitle center">{verb}</div>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
