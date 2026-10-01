/** Never retain error text, stacks, arbitrary names, or URLs in analytics. */
export function errorClass(reason: unknown): string {
  try {
    const name = reason && typeof reason === "object" && "name" in reason ? reason.name : undefined;
    return typeof name === "string" && [
      "Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError",
      "EvalError", "AggregateError", "AbortError", "SecurityError", "QuotaExceededError",
      "NetworkError", "NotSupportedError", "InvalidStateError",
    ].includes(name) ? name : "unknown";
  } catch {
    return "unknown";
  }
}

export function assetName(source: string, origin: string): string | undefined {
  try {
    const url = new URL(source, origin);
    if (url.origin !== origin) return undefined;
    // Production Vite chunk identity is useful for matching archived releases.
    // Reject dev paths, player-controlled paths, queries, and third-party URLs.
    const match = url.pathname.match(/^\/assets\/([A-Za-z][A-Za-z0-9_-]{0,32}-[A-Za-z0-9_-]{8,16}\.js)$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function sourceCoordinate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 1_000_000 ? value : undefined;
}
