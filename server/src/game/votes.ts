import type { VoteTallyEntry } from "../../../shared/types.js";

export interface VoteParticipant {
  uid: string;
  name: string;
}

/** Pure aggregate projection. Voter identity never leaves the supplied Map. */
export function aggregateVoteTally(
  participants: readonly VoteParticipant[],
  votes: ReadonlyMap<string, string>,
): VoteTallyEntry[] {
  const tally = new Map(participants.map((player) => [player.uid, 0]));
  for (const targetUid of votes.values()) {
    if (tally.has(targetUid)) tally.set(targetUid, (tally.get(targetUid) ?? 0) + 1);
  }

  return participants.map((player) => ({
    uid: player.uid,
    name: player.name,
    votes: tally.get(player.uid) ?? 0,
  }));
}
