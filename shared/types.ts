export type GamePhase = "LOBBY" | "QUESTION" | "ANSWERING" | "REVEAL" | "DISCUSSION" | "VOTING" | "RESULT" | "GAME_OVER" | "CLOSED";
export type Role = "host" | "player" | "spectator";
export type GameMode = "HANDS" | "POINT" | "NUMBER";
export interface GameModeInfo { id: GameMode; icon: string; label: string; description: string; }
export type CategoryId = "family" | "friends" | "food" | "travel" | "football" | "ramadan" | "majlis" | "work" | "general";
export type ErrorCode = "ROOM_NOT_FOUND" | "ROOM_FULL" | "ROOM_CLOSED" | "ROOM_NOT_IN_LOBBY" | "DUPLICATE_NAME" | "INVALID_NAME" | "NOT_HOST" | "NOT_PLAYER" | "ALREADY_IN_ROOM" | "NOT_IN_ROOM" | "ANSWER_ALREADY_SUBMITTED" | "VOTE_ALREADY_SUBMITTED" | "INVALID_ANSWER" | "INVALID_VOTE" | "INVALID_PHASE" | "NOT_ENOUGH_PLAYERS" | "NO_CATEGORY_SELECTED" | "NO_MODE_SELECTED" | "KICKED" | "RATE_LIMITED" | "BAD_REQUEST" | "UNAUTHORIZED" | "INTERNAL";
export interface PublicPlayer { uid: string; name: string; score: number; connected: boolean; isHost: boolean; }
export interface RevealedAnswer { uid: string; name: string; answer: string; }
export interface CategoryInfo { id: CategoryId; label: string; }
export interface RoundResult {
  /** Present only once the round is over; omitted after survived challenge 1/2. */
  impostorUid?: string;
  impostorName?: string;
  groupFound: boolean;
  roundComplete: boolean;
  challengeIndex: number;
  maxChallenges: number;
  mode: GameMode;
  /** Revealed only when the round is over. */
  prompt?: string;
  normalQuestion?: string;
  impostorQuestion?: string;
  category?: CategoryId;
  voteTally: Array<{ uid: string; name: string; votes: number }>;
  /** Empty while the same impostor must remain secret for another challenge. */
  voteBreakdown: Array<{ voterUid: string; voterName: string; targetUid: string; targetName: string; correct: boolean; voterWasImpostor: boolean; points: number }>;
  roundScores: Array<{ uid: string; delta: number }>;
}
export interface ScoreboardRow { uid: string; name: string; score: number; rank: number; }
export interface GameOverInfo { winners: Array<{ uid: string; name: string }>; ranking: ScoreboardRow[]; }
export interface ClientView {
  self: { uid: string; role: Role; name?: string; connected: boolean };
  room: { code: string; phase: GamePhase; currentRound: number; totalRounds: number; maxPlayers: number; minPlayers: number; hostUid: string; selectedModes: GameMode[]; availableModes: GameModeInfo[]; categories: CategoryId[]; availableCategories: CategoryInfo[]; joinUrl: string; phaseEndsAt?: number };
  players: PublicPlayer[];
  settingsEditable?: boolean;
  challenge?: { mode: GameMode; index: number; max: number };
  isImpostor?: boolean;
  myPrompt?: { mode: GameMode; text: string };
  myReady?: boolean;
  readyProgress?: { submitted: number; total: number };
  myQuestion?: string;
  myAnswerSubmitted?: boolean;
  answersProgress?: { submitted: number; total: number };
  reveal?: RevealedAnswer[];
  myVoteSubmitted?: boolean;
  myVoteTargetUid?: string;
  votesProgress?: { submitted: number; total: number };
  voteTargets?: Array<{ uid: string; name: string }>;
  result?: RoundResult;
  scoreboard?: ScoreboardRow[];
  gameOver?: GameOverInfo;
}
export type ClientMessage =
  | { t: "HELLO" } | { t: "CREATE_ROOM" } | { t: "JOIN_ROOM"; code: string; name: string } | { t: "LEAVE_ROOM" }
  | { t: "SET_SETTINGS"; totalRounds?: number; categories?: CategoryId[]; selectedModes?: GameMode[] } | { t: "START_GAME" }
  | { t: "MARK_READY" } | { t: "SUBMIT_ANSWER"; answer: string } | { t: "START_VOTING" } | { t: "SUBMIT_VOTE"; targetUid: string }
  | { t: "NEXT_ROUND" } | { t: "KICK_PLAYER"; uid: string } | { t: "CLOSE_ROOM" } | { t: "REMATCH" } | { t: "PING" };
export type ServerMessage = { t: "HELLO_OK"; uid: string } | { t: "STATE"; view: ClientView } | { t: "ERROR"; code: ErrorCode; message?: string } | { t: "ROOM_CLOSED"; reason?: string } | { t: "KICKED" } | { t: "PONG" };
export type AnalyticsEvent = "room_created" | "game_started" | "game_completed" | "selected_category" | "player_count";
