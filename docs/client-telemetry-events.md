# Anonymous client telemetry event contract

Client-originated telemetry is intentionally limited to five event families. The browser may inspect local capability APIs in order to classify the environment, but only coarse allowlisted properties are sent to the server.

- `client_started`: coarse device/browser/OS/viewport/capability buckets.
- `client_performance`: navigation and page-load timing aggregates.
- `client_vital`: LCP, CLS, and coarse interaction-delay measurements.
- `client_session_summary`: foreground/background/connectivity/orientation counters over a time window.
- `client_error`: kind (`runtime`, `resource`, `promise`, `react`, `bootstrap`), canonical error class, coarse surface/phase/online state, entry bundle basename and optional same-origin hashed source asset plus bounded line/column. No raw message, stack, component stack, URL or private gameplay content. At most ten errors per page; the server validates diagnostic fields independently.

Never add raw user-agent, URL/path, room code, player/session UID, exact physical screen dimensions, IP, stack trace, error message, canvas/audio fingerprint, installed fonts, media-device enumeration, localStorage identifier, or any cross-session identifier to this contract.

`server/src/clientTelemetry.ts` sanitizes the incoming batch before dispatching it, and `server/src/analytics.ts` applies the event-specific allowlist again before persistence. A bounded page-session UUID correlates client events and is reused from sessionStorage when available; it is not authentication. The signed session used to authenticate/rate-limit ingestion is not persisted as the raw gameplay identity. Archive exact built bundles with their Git SHA for coordinate attribution; this change does not collect raw stacks or publish source maps.
