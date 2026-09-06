# Transport hardening notes

## Protocol compatibility

The server accepts the current protocol-v2 client and older already-open clients during a rolling application update.

- Protocol-v2 clients may send a bounded `rid` on state-changing actions and receive `ACK` or a correlated `ERROR`.
- Older clients may omit `rid`; their actions continue to be validated and authorized normally. They do not need to understand `ACK` frames.
- Both legacy `{ "t": "PING" }` and protocol-v2 clock samples are accepted. Clock samples are transport-only and never count as meaningful room activity.
- The client never automatically replays votes, kick, leave, close, or rematch after a disconnect. A request timeout tells the user that execution could not be confirmed.
- Request deduplication is bounded and scoped to the authenticated signed anonymous identity, action payload, room, match generation, round, and phase. Reusing the same request ID with conflicting payload/context is rejected.

## Operational limits are configuration, not constants

Every abuse and request-cache limit introduced by this stage is a deployment
knob rather than a hardcoded constant. `readConfig()` builds a typed
`AbuseGuardLimits` object that is passed to `AbuseGuard`, and the request
idempotency bounds are passed to `RoomManager`. See `.env.example` for the full
list with defaults.

| Concern | Environment prefix | Default |
| --- | --- | --- |
| Socket opens per IP | `RATE_LIMIT_CONNECTION_IP` | 300 / 60s |
| Socket opens per identity | `RATE_LIMIT_CONNECTION_IDENTITY` | 60 / 60s |
| Session issuance per IP | `RATE_LIMIT_SESSION_IP` | 300 / 60s |
| Session issuance per identity | `RATE_LIMIT_SESSION_IDENTITY` | 120 / 60s |
| Room creation per IP | `RATE_LIMIT_ROOM_CREATION_IP` | 36 / 60s |
| Room creation per identity | `RATE_LIMIT_ROOM_CREATION_IDENTITY` | 3 / 60s |
| Tracked keys per limiter | `RATE_LIMIT_MAX_TRACKED_KEYS` | 20000 |
| Limiter sweep interval | `RATE_LIMIT_CLEANUP_INTERVAL_MS` | 60000 |
| Request id retention | `REQUEST_RETENTION_MS` | 300000 |
| Request ids per identity | `MAX_REQUESTS_PER_UID` | 128 |

Each rule reads `<PREFIX>_LIMIT` and `<PREFIX>_WINDOW_MS`. Values that are
absent, zero, negative or non-numeric fall back to the default, so a
misconfigured variable degrades to the shipped shield instead of disabling it.

The defaults are chosen for the shared-NAT shape this game actually ships into:
a regression test asserts that Host + ten players on a single IP, each doing
repeated session and socket rounds, stay allowed under the defaults. Per-action
gameplay quotas remain fixed in code — they are game rules, not operations.

## Clock synchronization

Countdown visuals and Host audio use the same monotonic server-time estimate. Heartbeat responses carry sample IDs and server timestamps; the client estimates offset using RTT and a small filtered sample set. Client time is never authoritative for game transitions.

## Admission and kick model

Lobby admission lock blocks fresh identities while existing reserved player seats can reconnect. A Host kick records the player's signed anonymous UID in a room-scoped block list until the Host explicitly allows that UID again.

This is an identity control, not a physical-person ban. A fresh anonymous identity is distinct. The implementation intentionally does not use blanket IP bans because parties commonly share one NAT/Wi-Fi connection.

## Live vote-board privacy

The shared Host/TV board intentionally receives live aggregate vote counts during VOTING. It never receives voter-to-target mappings, but the timing of aggregate changes can allow observers to infer when a vote arrived. Therefore the live board is aggregate-only, not fully anonymous against timing inference.
