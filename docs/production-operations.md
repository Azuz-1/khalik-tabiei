# Production operations

## State and topology

Room/game state is intentionally in process memory. A process/container restart loses active rooms. The signed anonymous identity cookie authenticates the browser identity; it is not durable room storage and cannot reconstruct a room after process loss.

Run one authoritative application instance unless room state, timers, request dedupe, and broadcasts are moved to shared infrastructure. Multiple independent instances behind a load balancer are not safe simply because the client reconnects; different instances would hold different authoritative state. This repository does not implement shared Redis/pubsub/state replication.

Default transport limits are configurable through environment variables. The current defaults are 4,000 concurrent sockets globally and 64 per IP, intentionally leaving room for Host + ten phones and reconnect overlap behind one shared NAT. Empty never-used Lobby reclamation defaults to 20 minutes. Hosting plans still need memory/CPU/socket limits appropriate to expected concurrency; these defaults are abuse/capacity guards, not a production load-test result.

## Liveness and readiness

- `GET /healthz` is process liveness and remains HTTP 200 while the server is draining.
- `GET /readyz` is admission readiness. It returns HTTP 200 normally and HTTP 503 as soon as graceful drain starts.
- `/api/session` returns HTTP 503 during drain, so new bootstrap identities are not admitted.
- New WebSocket upgrades are rejected with HTTP 503 during drain.

## Graceful shutdown

`SIGTERM` or `SIGINT` starts an idempotent drain. The default deadline is 10 seconds (`DRAIN_TIMEOUT_MS`). At drain start:

1. readiness flips false immediately;
2. existing authenticated WebSockets receive `SERVER_RESTARTING` with the absolute deadline;
3. RoomManager rejects CREATE_ROOM, JOIN_ROOM, START_GAME, and REMATCH with `SERVER_RESTARTING`;
4. already-running authoritative actions may continue until the deadline so an in-flight vote/result is not rewritten merely because deployment started;
5. at the deadline existing WebSockets close with code 1012 and the HTTP server closes; lingering sockets are then terminated.

The drain is best-effort continuity, not state persistence. If a game has not completed before process exit, its in-memory state is lost.

## Runtime image

Production builds compile the server TypeScript to JavaScript. `tsx` and TypeScript remain development/build tooling rather than production runtime dependencies. The Dockerfile is multi-stage: the build stage installs the full toolchain and builds client/server; the runtime stage installs only server production dependencies, copies compiled server/client output and third-party notices, and runs as the non-root `node` user.

Tajawal is pinned through `@fontsource/tajawal@5.3.0`; Vite emits the requested 400/500/700/800/900 Arabic/Latin WOFF2 assets into the local client build. The app no longer requests Google Fonts and CSP permits fonts/styles from self only. The upstream Tajawal SIL OFL 1.1 notice is retained under `client/THIRD_PARTY_NOTICES/`.

No deployment is performed by Stage D.
