export type GamePhase =
  | "LOBBY"
  | "QUESTION"
  | "ANSWERING"
  | "REVEAL"
  | "COUNTDOWN"
  | "ACTION"
  | "HOLD"
  | "PROMPT_REVEAL"
  | "DISCUSSION"
  | "VOTING"
  | "RESULT"
  | "GAME_OVER"
  | "CLOSED";

export type Role = "host" | "player" | "spectator";
export type GameMode = "HANDS" | "POINT" | "NUMBER";
export type PlayStyle = "TEAM" | "INDIVIDUAL";
export type RequestId = string;

export interface GameModeInfo {
  id: GameMode;
  icon: string;
  label: string;
  fullLabel: string;
  description: string;
  onboardingInstructions: string[];
  normalInstruction: string;
  impostorInstruction: string;
  actionLabel: string;
}

export type CategoryId =
  | "family"
  | "friends"
  | "food"
  | "travel"
  | "football"
  | "ramadan"
  | "majlis"
  | "work"
  | "general";

export type ErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_CLOSED"
  | "ROOM_NOT_IN_LOBBY"
  | "ROOM_LOCKED"
  | "DUPLICATE_NAME"
  | "INVALID_NAME"
  | "NOT_HOST"
  | "NOT_PLAYER"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "ANSWER_ALREADY_SUBMITTED"
  | "VOTE_ALREADY_SUBMITTED"
  | "INVALID_ANSWER"
  | "INVALID_VOTE"
  | "INVALID_PHASE"
  | "NOT_ENOUGH_PLAYERS"
  | "NO_CATEGORY_SELECTED"
  | "NO_MODE_SELECTED"
  | "KICKED"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "INTERNAL";

export interface PublicPlayer {
  uid: string;
  name: string;
  /** Stable numeric identity for the occupied seat; color/status remains supplementary. */
  seatNumber: number;
  connected: boolean;
  isHost: boolean;
}

export interface RevealedAnswer {
  uid: string;
  name: string;
  answer: string;
}

export interface CategoryInfo {
  id: CategoryId;
  label: string;
}

export interface VoteTallyEntry {
  uid: string;
  name: string;
  votes: number;
}

export interface ScoreEntry {
  uid: string;
  name: string;
  score: number;
  rank: number;
  roundDelta?: number;
}

export interface RoundResult {
  impostorUid?: string;
  impostorName?: string;
  groupFound: boolean;
  roundComplete: boolean;
  challengeIndex: number;
  maxChallenges: number;
  mode: GameMode;
  requiredVotes: number;
  normalQuestion?: string;
  impostorQuestion?: string;
  category?: CategoryId;
  voteTally: VoteTallyEntry[];
}

export interface GameOverInfo {
  totalRounds: number;
  caughtRounds: number;
  escapedRounds: number;
}

export interface ClientView {
  self: {
    uid: string;
    role: Role;
    name?: string;
    connected: boolean;
  };
  room: {
    code: string;
    phase: GamePhase;
    currentRound: number;
    totalRounds: number;
    maxPlayers: number;
    minPlayers: number;
    hostUid: string;
    hostConnected: boolean;
    hostCloseDeadline?: number;
    hostPause?: {
      reason: "HOST_DISCONNECTED";
      originalPhase: GamePhase;
    };
    admissionLocked: boolean;
    playStyle: PlayStyle;
    selectedModes: GameMode[];
    availableModes: GameModeInfo[];
    categories: CategoryId[];
    availableCategories: CategoryInfo[];
    joinUrl: string;
    phaseEndsAt?: number;
  };
  players: PublicPlayer[];
  settingsEditable?: boolean;
  /** Host-only list. A blocked signed anonymous identity is not a physical-person ban. */
  blockedPlayers?: Array<{ uid: string; name: string }>;
  nextRoundWarning?: string;
  challenge?: {
    mode: GameMode;
    index: number;
    max: number;
  };
  isImpostor?: boolean;
  myPrompt?: { mode: GameMode; text: string };
  publicPrompt?: { mode: GameMode; text: string };
  myReady?: boolean;
  readyProgress?: { submitted: number; total: number };
  myQuestion?: string;
  myAnswerSubmitted?: boolean;
  answersProgress?: { submitted: number; total: number };
  reveal?: RevealedAnswer[];
  myVoteSubmitted?: boolean;
  votesProgress?: { submitted: number; total: number; requiredVotes: number };
  liveVoteTally?: VoteTallyEntry[];
  voteTargets?: Array<{ uid: string; name: string }>;
  result?: RoundResult;
  gameOver?: GameOverInfo;
  scoreboard?: ScoreEntry[];
}

type RequestMeta = { rid?: RequestId };

export type ClientMessage =
  | ({ t: "HELLO"; protocolVersion?: 2 } & RequestMeta)
  | ({ t: "CREATE_ROOM" } & RequestMeta)
  | ({ t: "JOIN_ROOM"; code: string; name: string } & RequestMeta)
  | ({ t: "LEAVE_ROOM" } & RequestMeta)
  | ({
      t: "SET_SETTINGS";
      totalRounds?: number;
      categories?: CategoryId[];
      selectedModes?: GameMode[];
      playStyle?: PlayStyle;
    } & RequestMeta)
  | ({ t: "SET_ADMISSION"; locked: boolean } & RequestMeta)
  | ({ t: "UNBLOCK_PLAYER"; uid: string } & RequestMeta)
  | ({ t: "START_GAME" } & RequestMeta)
  | ({ t: "MARK_READY" } & RequestMeta)
  | ({ t: "SUBMIT_ANSWER"; answer: string } & RequestMeta)
  | ({ t: "START_VOTING" } & RequestMeta)
  | ({ t: "SUBMIT_VOTE"; targetUid: string } & RequestMeta)
  | ({ t: "NEXT_ROUND" } & RequestMeta)
  | ({ t: "KICK_PLAYER"; uid: string } & RequestMeta)
  | ({ t: "CLOSE_ROOM" } & RequestMeta)
  | ({ t: "REMATCH" } & RequestMeta)
  | { t: "PING"; sampleId?: string; clientMonoMs?: number };

export type ServerMessage =
  | { t: "HELLO_OK"; uid: string; protocolVersion?: 2; serverMs?: number }
  | { t: "STATE"; view: ClientView }
  | { t: "ACK"; rid: RequestId }
  | { t: "ERROR"; code: ErrorCode; message?: string; rid?: RequestId }
  | { t: "ROOM_CLOSED"; reason?: string }
  | { t: "KICKED" }
  | { t: "PONG"; sampleId?: string; serverMs?: number };

export type AnalyticsEvent =
  | "room_created"
  | "game_started"
  | "game_completed"
  | "selected_category"
  | "player_count";
