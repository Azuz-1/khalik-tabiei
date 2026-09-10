# Anonymous client telemetry event contract

Client-originated telemetry is intentionally limited to five event families. The browser may inspect local capability APIs in order to classify the environment, but only coarse allowlisted properties are sent to the server.

- `client_started`: coarse device/browser/OS/viewport/capability buckets.
- `client_performance`: navigation and page-load timing aggregates.
- `client_vital`: LCP, CLS, and coarse interaction-delay measurements.
- `client_session_summary`: foreground/background/connectivity/orientation counters over a time window.
- `client_error`: only the error kind (`runtime`, `resource`, `promise`) and coarse surface/online state.

Never add raw user-agent, URL/path, room code, player/session UID, exact physical screen dimensions, IP, stack trace, error message, canvas/audio fingerprint, installed fonts, media-device enumeration, localStorage identifier, or any cross-session identifier to this contract.

`server/src/clientTelemetry.ts` sanitizes the incoming batch before dispatching it, and `server/src/analytics.ts` applies the event-specific allowlist again before persistence. The signed session exists only to rate-limit ingestion and is not persisted with an event.
