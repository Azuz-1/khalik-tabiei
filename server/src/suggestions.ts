import { FixedWindowLimiter } from "./security/rateLimit.js";

export type SuggestionCategory = "idea" | "content" | "bug" | "other";

export interface StoredSuggestion {
  occurredAt: string;
  category: SuggestionCategory;
  text: string;
  deploymentSha: string;
}

export type SuggestionSink = (suggestion: StoredSuggestion) => void | Promise<void>;

export type SuggestionSubmitResult =
  | { ok: true; category: SuggestionCategory; lengthBucket: "short" | "medium" | "long" }
  | { ok: false; code: "INVALID" | "CONTACT_INFO" | "RATE_LIMITED" | "UNAVAILABLE" | "STORAGE_FAILED" };

const CATEGORIES = new Set<SuggestionCategory>(["idea", "content", "bug", "other"]);
const MIN_LENGTH = 4;
const MAX_LENGTH = 600;

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 0x6f0));
}

function containsContactInfo(value: string): boolean {
  const email = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u;
  if (email.test(value)) return true;
  const compactDigits = normalizeDigits(value).replace(/[\s().-]/g, "");
  return /(?:\+?966|00966|0)?5\d{8}/.test(compactDigits);
}

export function cleanSuggestionText(raw: unknown): { text?: string; code?: "INVALID" | "CONTACT_INFO" } {
  if (typeof raw !== "string") return { code: "INVALID" };
  const text = raw
    .normalize("NFC")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const length = [...text].length;
  if (length < MIN_LENGTH || length > MAX_LENGTH) return { code: "INVALID" };
  if (containsContactInfo(text)) return { code: "CONTACT_INFO" };
  return { text };
}

function lengthBucket(length: number): "short" | "medium" | "long" {
  if (length < 80) return "short";
  if (length < 240) return "medium";
  return "long";
}

export class SuggestionService {
  private readonly identityLimit: FixedWindowLimiter;
  private readonly ipLimit: FixedWindowLimiter;

  constructor(
    private readonly sink: SuggestionSink | null,
    private readonly deploymentSha = "unknown",
    now: () => number = Date.now,
  ) {
    // Shared-home Wi-Fi stays roomy, while one signed browser cannot spam the inbox.
    this.identityLimit = new FixedWindowLimiter(4, 10 * 60_000, 20_000, now);
    this.ipLimit = new FixedWindowLimiter(40, 10 * 60_000, 20_000, now);
  }

  async submit(ip: string, uid: string, payload: unknown): Promise<SuggestionSubmitResult> {
    if (!this.sink) return { ok: false, code: "UNAVAILABLE" };
    if (!this.ipLimit.allow(ip) || !this.identityLimit.allow(uid)) return { ok: false, code: "RATE_LIMITED" };
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, code: "INVALID" };
    const record = payload as Record<string, unknown>;
    if (typeof record.category !== "string" || !CATEGORIES.has(record.category as SuggestionCategory)) {
      return { ok: false, code: "INVALID" };
    }
    const cleaned = cleanSuggestionText(record.text);
    if (!cleaned.text) return { ok: false, code: cleaned.code ?? "INVALID" };

    const category = record.category as SuggestionCategory;
    try {
      await this.sink({
        occurredAt: new Date().toISOString(),
        category,
        text: cleaned.text,
        deploymentSha: this.deploymentSha.slice(0, 64) || "unknown",
      });
    } catch {
      return { ok: false, code: "STORAGE_FAILED" };
    }

    return { ok: true, category, lengthBucket: lengthBucket([...cleaned.text].length) };
  }

  cleanup(): void {
    this.identityLimit.cleanup();
    this.ipLimit.cleanup();
  }
}

export interface SupabaseSuggestionOptions {
  url: string;
  secretKey: string;
  fetchImpl?: typeof fetch;
}

function normalizedBaseUrl(raw: string): string {
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error("suggestion Supabase URL must use https");
  return url.toString().replace(/\/$/, "");
}

export function createSupabaseSuggestionSink(options: SupabaseSuggestionOptions): SuggestionSink {
  const baseUrl = normalizedBaseUrl(options.url);
  const secretKey = options.secretKey.trim();
  if (!secretKey) throw new Error("suggestion Supabase secret key is empty");
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (suggestion) => {
    const response = await fetchImpl(`${baseUrl}/rest/v1/suggestions`, {
      method: "POST",
      headers: {
        apikey: secretKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        occurred_at: suggestion.occurredAt,
        category: suggestion.category,
        message: suggestion.text,
        deployment_sha: suggestion.deploymentSha,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`suggestion sink failed with HTTP ${response.status}`);
  };
}

export function createConfiguredSuggestionService(env: NodeJS.ProcessEnv = process.env): SuggestionService {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  const deploymentSha = env.RENDER_GIT_COMMIT ?? env.GITHUB_SHA ?? "unknown";
  if (!url || !secretKey) return new SuggestionService(null, deploymentSha);
  try {
    return new SuggestionService(createSupabaseSuggestionSink({ url, secretKey }), deploymentSha);
  } catch {
    return new SuggestionService(null, deploymentSha);
  }
}
