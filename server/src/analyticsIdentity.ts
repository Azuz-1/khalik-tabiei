import { createHmac } from "node:crypto";

const DEVELOPMENT_ANALYTICS_SECRET =
  "development-only-khalik-tabiei-analytics-secret-v2";

const ANALYTICS_ID_DOMAIN =
  "khalik-tabiei:analytics-player:v2\0";

export function analyticsSecretProblem(secret: unknown): string | null {
  if (
    typeof secret !== "string" ||
    Buffer.byteLength(secret, "utf8") < 32
  ) {
    return "ANALYTICS_SECRET must contain at least 32 bytes";
  }

  if (/^(change[-_ ]?me|secret|password|example|test)+$/i.test(secret)) {
    return "ANALYTICS_SECRET must not be a placeholder";
  }

  if (new Set(secret).size < 10) {
    return "ANALYTICS_SECRET does not have enough character diversity";
  }

  return null;
}

function configuredAnalyticsSecret(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const supplied = env.ANALYTICS_SECRET?.trim();

  if (supplied && !analyticsSecretProblem(supplied)) {
    return supplied;
  }

  if (env.NODE_ENV === "production" && env.ANALYTICS !== "off") {
    throw new Error(
      `Configuration error: ${
        analyticsSecretProblem(supplied) ??
        "ANALYTICS_SECRET is required"
      }`,
    );
  }

  return DEVELOPMENT_ANALYTICS_SECRET;
}

export function analyticsPlayerId(
  identity: string,
  secret = configuredAnalyticsSecret(),
): string {
  const digest = createHmac("sha256", secret)
    .update(ANALYTICS_ID_DOMAIN)
    .update(identity)
    .digest("hex");

  return `ap2_${digest.slice(0, 32)}`;
}
