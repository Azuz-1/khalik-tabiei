export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "0.0.0.0",
  /** Optional fixed public origin (e.g. https://game.example.com). */
  publicOrigin: process.env.PUBLIC_ORIGIN ?? "",
  /** Max accepted WS message size in bytes (defensive). */
  maxMessageBytes: 8 * 1024,
  /** Heartbeat interval. */
  heartbeatMs: 30_000,
};
