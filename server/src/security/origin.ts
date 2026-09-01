/** Exact browser-origin validation for cookie-authenticated WebSockets. */
export function canonicalOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function isAllowedWebSocketOrigin(
  rawOrigin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
  requireOrigin: boolean,
): boolean {
  if (!rawOrigin) return !requireOrigin;
  const origin = canonicalOrigin(rawOrigin);
  return origin !== null && allowedOrigins.has(origin);
}

export function webSocketOrigin(httpOrigin: string): string {
  const url = new URL(httpOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}
