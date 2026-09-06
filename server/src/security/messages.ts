import type { ClientMessage } from "../../../shared/types.js";
import {
  ANSWER_MAX,
  CATEGORY_IDS,
  GAME_MODE_IDS,
  NAME_MAX,
  NAME_MIN,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROUND_OPTIONS,
  UID_RE,
} from "../../../shared/constants.js";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: JsonObject, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function boundedString(value: unknown, min: number, max: number): value is string {
  if (typeof value !== "string") return false;
  const length = [...value].length;
  return length >= min && length <= max;
}

function noFields(value: JsonObject): boolean {
  return exactKeys(value, ["t"]);
}

export function validateClientMessage(value: unknown): ClientMessage | null {
  if (!isObject(value) || typeof value.t !== "string") return null;

  switch (value.t) {
    case "HELLO":
    case "CREATE_ROOM":
    case "LEAVE_ROOM":
    case "START_GAME":
    case "MARK_READY":
    case "START_VOTING":
    case "NEXT_ROUND":
    case "CLOSE_ROOM":
    case "REMATCH":
    case "PING":
      return noFields(value) ? (value as ClientMessage) : null;

    case "JOIN_ROOM": {
      if (!exactKeys(value, ["t", "code", "name"])) return null;
      const codeRe = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
      if (typeof value.code !== "string" || !codeRe.test(value.code.toUpperCase())) return null;
      if (!boundedString(value.name, NAME_MIN, NAME_MAX)) return null;
      return value as ClientMessage;
    }

    case "SET_SETTINGS": {
      if (!exactKeys(value, ["t"], ["totalRounds", "categories", "selectedModes", "playStyle"])) {
        return null;
      }
      if (
        !Object.hasOwn(value, "totalRounds") &&
        !Object.hasOwn(value, "categories") &&
        !Object.hasOwn(value, "selectedModes") &&
        !Object.hasOwn(value, "playStyle")
      ) {
        return null;
      }

      if (
        value.totalRounds !== undefined &&
        (typeof value.totalRounds !== "number" ||
          !ROUND_OPTIONS.includes(value.totalRounds as (typeof ROUND_OPTIONS)[number]))
      ) {
        return null;
      }

      // Kept parseable so the authoritative engine can explicitly reject the
      // hidden legacy setting rather than silently accepting malformed input.
      if (value.categories !== undefined) {
        if (!Array.isArray(value.categories) || value.categories.length > CATEGORY_IDS.length) {
          return null;
        }
        if (!value.categories.every((category) => CATEGORY_IDS.includes(category))) return null;
        if (new Set(value.categories).size !== value.categories.length) return null;
      }

      if (value.selectedModes !== undefined) {
        if (
          !Array.isArray(value.selectedModes) ||
          value.selectedModes.length > GAME_MODE_IDS.length
        ) {
          return null;
        }
        if (!value.selectedModes.every((mode) => GAME_MODE_IDS.includes(mode))) return null;
        if (new Set(value.selectedModes).size !== value.selectedModes.length) return null;
      }

      if (
        value.playStyle !== undefined &&
        value.playStyle !== "TEAM" &&
        value.playStyle !== "INDIVIDUAL"
      ) {
        return null;
      }

      return value as ClientMessage;
    }

    case "SUBMIT_ANSWER":
      return exactKeys(value, ["t", "answer"]) &&
        boundedString(value.answer, 1, ANSWER_MAX)
        ? (value as ClientMessage)
        : null;

    case "SUBMIT_VOTE":
      return exactKeys(value, ["t", "targetUid"]) &&
        typeof value.targetUid === "string" &&
        UID_RE.test(value.targetUid)
        ? (value as ClientMessage)
        : null;

    case "KICK_PLAYER":
      return exactKeys(value, ["t", "uid"]) &&
        typeof value.uid === "string" &&
        UID_RE.test(value.uid)
        ? (value as ClientMessage)
        : null;

    default:
      return null;
  }
}

export function parseClientMessage(raw: unknown, maxBytes: number): ClientMessage | null {
  let text: string;

  if (typeof raw === "string") {
    text = raw;
  } else if (Buffer.isBuffer(raw)) {
    text = raw.toString("utf8");
  } else if (raw instanceof ArrayBuffer) {
    text = Buffer.from(raw).toString("utf8");
  } else if (Array.isArray(raw) && raw.every(Buffer.isBuffer)) {
    text = Buffer.concat(raw as Buffer[]).toString("utf8");
  } else {
    return null;
  }

  if (Buffer.byteLength(text, "utf8") > maxBytes) return null;

  try {
    return validateClientMessage(JSON.parse(text));
  } catch {
    return null;
  }
}
