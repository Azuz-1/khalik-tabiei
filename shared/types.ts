/**
 * Shared type definitions for «خلك طبيعي».
 *
 * These types form the contract between the authoritative server and the
 * (untrusted) browser clients. They are imported by both `server/src` and
 * `client/src` so the wire protocol stays in sync.
 *
 * SECURITY NOTE: anything that appears in a type sent to *every* client is,
 * by definition, public. Secret round data (impostor identity, the two
 * questions before the result) must NEVER be placed in a broadcast view —
 * only in the private, per-recipient fields documented below.
 */

/** Authoritative game phase. The server owns this; clients only render it. */
export type GamePhase =
  | "LOBBY" // waiting for players, host configures settings
  | "QUESTION" // secret questions have been dealt; short "get ready" beat
  | "ANSWERING" // players type and submit their short answer
  | "REVEAL" // all answers shown together on the host screen
  | "DISCUSSION" // players argue in real life; host decides when to vote
  | "VOTING" // players secretly vote for the suspected impostor
  | "RESULT" // impostor + both questions + tally revealed, scores updated
  | "GAME_OVER" // final winner + ranking
  | "CLOSED"; // room permanently closed

/** Role of a connection relative to a room. */
export type Role = "host" | "player" | "spectator";

/** Category identifiers (stable keys; Arabic labels live in the content pack). */
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

/** Typed error codes. The frontend maps these to Arabic player-facing copy. */
export type ErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_CLOSED"
  | "ROOM_NOT_IN_LOBBY"
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
  | "KICKED"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "INTERNAL";

// ---------------------------------------------------------------------------
// Public, broadcast-safe shapes
// ---------------------------------------------------------------------------

/** Public information about a player. Contains NO secret round data. */
export interface PublicPlayer {
  uid: string;
  name: string;
  score: number;
  connected: boolean;
  isHost: boolean;
}

/** A revealed answer. Deliberately NOT tied to which question it answered. */
export interface RevealedAnswer {
  uid: string;
  name: string;
  answer: string;
}

/** Public label for a category (sent so the client need not hardcode Arabic). */
export interface CategoryInfo {
  id: CategoryId;
  label: string;
}

/** Result data — only ever present in RESULT / GAME_OVER phases. */
export interface RoundResult {
  impostorUid: string;
  impostorName: string;
  /** true if the group concentrated its top vote on the impostor. */
  groupFound: boolean;
  normalQuestion: string;
  impostorQuestion: string;
  category: CategoryId;
  voteTally: Array<{ uid: string; name: string; votes: number }>;
  /** Public only after RESULT: exactly who voted for whom. */
  voteBreakdown: Array<{
    voterUid: string;
    voterName: string;
    targetUid: string;
    targetName: string;
    correct: boolean;
    voterWasImpostor: boolean;
    points: number;
  }>;
  /** Per-player points earned this round (for the little "+1" flourishes). */
  roundScores: Array<{ uid: string; delta: number }>;
}

export interface ScoreboardRow {
  uid: string;
  name: string;
  score: number;
  rank: number;
}

export interface GameOverInfo {
  /** All top-scoring players. More than one entry represents a real tie. */
  winners: Array<{ uid: string; name: string }>;
  ranking: ScoreboardRow[];
}

/**
 * The single object a client renders from. The server computes ONE of these
 * per recipient, folding in only that recipient's private data.
 */
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
    /** Categories currently selected for the game. */
    categories: CategoryId[];
    /** All categories the host may choose from. */
    availableCategories: CategoryInfo[];
    joinUrl: string;
  };
  players: PublicPlayer[];

  // -- Host-only affordances -------------------------------------------------
  /** True when this recipient is the host and may edit settings (LOBBY). */
  settingsEditable?: boolean;

  // -- Private to THIS player (never broadcast) ------------------------------
  /** This player's own secret question (QUESTION / ANSWERING only). */
  myQuestion?: string;
  /** Whether this player has submitted their answer this round. */
  myAnswerSubmitted?: boolean;
  /** Whether this player has cast their vote this round. */
  myVoteSubmitted?: boolean;
  /** Whom this player voted for (echoed back only to themselves). */
  myVoteTargetUid?: string;

  // -- Public progress (counts only, never contents) -------------------------
  answersProgress?: { submitted: number; total: number };
  votesProgress?: { submitted: number; total: number };

  // -- Public reveal data ----------------------------------------------------
  /** Shown from REVEAL onward. Answers only — no question attribution. */
  reveal?: RevealedAnswer[];
  /** People this player may vote for (everyone active except themselves). */
  voteTargets?: Array<{ uid: string; name: string }>;

  // -- End-of-round / end-of-game -------------------------------------------
  result?: RoundResult;
  scoreboard?: ScoreboardRow[];
  gameOver?: GameOverInfo;
}

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

/** Messages sent from a browser client to the server. */
export type ClientMessage =
  | { t: "HELLO" }
  | { t: "CREATE_ROOM" }
  | { t: "JOIN_ROOM"; code: string; name: string }
  | { t: "LEAVE_ROOM" }
  | { t: "SET_SETTINGS"; totalRounds?: number; categories?: CategoryId[] }
  | { t: "START_GAME" }
  | { t: "SUBMIT_ANSWER"; answer: string }
  | { t: "START_VOTING" }
  | { t: "SUBMIT_VOTE"; targetUid: string }
  | { t: "NEXT_ROUND" }
  | { t: "KICK_PLAYER"; uid: string }
  | { t: "CLOSE_ROOM" }
  | { t: "REMATCH" }
  | { t: "PING" };

/** Messages sent from the server to a browser client. */
export type ServerMessage =
  | { t: "HELLO_OK"; uid: string }
  | { t: "STATE"; view: ClientView }
  | { t: "ERROR"; code: ErrorCode; message?: string }
  | { t: "ROOM_CLOSED"; reason?: string }
  | { t: "KICKED" }
  | { t: "PONG" };

/** Lightweight analytics event names (see analytics module). */
export type AnalyticsEvent =
  | "room_created"
  | "game_started"
  | "game_completed"
  | "selected_category"
  | "player_count";
