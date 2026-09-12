import type { GameMode } from "../../../shared/types.js";
import type { RoomState } from "./state.js";
import { IMITATION_PROMPTS } from "./imitationPrompts.data.js";

const historyByRoom = new WeakMap<RoomState, Set<string>>();

function history(room: RoomState): Set<string> {
  let value = historyByRoom.get(room);
  if (!value) {
    value = new Set<string>();
    historyByRoom.set(room, value);
  }
  return value;
}

export function sessionPromptSeen(room: RoomState, promptId: string): boolean {
  return history(room).has(promptId);
}

export function markSessionPromptSeen(room: RoomState, promptId: string): void {
  history(room).add(promptId);
}

export function sessionModeExhausted(room: RoomState, mode: GameMode): boolean {
  const seen = history(room);
  return IMITATION_PROMPTS
    .filter((prompt) => prompt.mode === mode)
    .every((prompt) => seen.has(prompt.id));
}

export function resetSessionMode(room: RoomState, mode: GameMode): void {
  const seen = history(room);
  for (const prompt of IMITATION_PROMPTS) {
    if (prompt.mode === mode) seen.delete(prompt.id);
  }
}

export function sessionPromptIdsForTests(room: RoomState): ReadonlySet<string> {
  return history(room);
}
