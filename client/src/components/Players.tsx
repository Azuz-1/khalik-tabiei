import type { PublicPlayer } from "../../../shared/types.js";
import { Avatar, seatLookup } from "../ui/Avatar.js";
import { Icon } from "../ui/Icon.js";

/** Live roster chips. The name carries identity; colour and presence dot are supplementary, and «منقطع» is spelled out. */
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
  const slotOf = seatLookup(players);
  return (
    <div className="players">
      {players.map((player) => {
        const self = player.uid === selfUid;
        return (
          <span key={player.uid} className={`chip${player.connected ? "" : " off"}${self ? " is-self" : ""}`}>
            <Avatar name={player.name} seat={slotOf(player.uid)} size="sm" offline={!player.connected} />
            <span className="chip-name" dir="auto">{player.name}{self ? " (أنت)" : ""}</span>
            {player.isHost ? <span className="chip-meta">· مالك الغرفة</span> : null}
            {!player.connected ? <span className="chip-status-off">منقطع</span> : null}
            {/* Stable seat identity stays in the DOM for room tooling; it is a long
                opaque number on phones, so it is not shown as visible chrome. */}
            <span className="seat-badge" hidden>{player.seatNumber}</span>
            {canKick && onKick && !player.isHost ? (
              <button
                type="button"
                className="kick"
                aria-label={`إخراج ${player.name}`}
                onClick={() => onKick(player.uid)}
              >
                <Icon name="close" />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
