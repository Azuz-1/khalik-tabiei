# Security and capacity assessment — 2026-09-30

Independent specialist review of the existing `خلك طبيعي` repository, baseline `70fc5c47`, with candidate changes on `release/rc-investigation-20260930`. This assessment uses source review, targeted tests, and an isolated local HTTP/WebSocket harness. It does not represent a penetration test, real-device assessment, or production capacity certification.

## Result

Two concrete boundary/resource defects were found and fixed without changing gameplay rules:

1. **High priority — valid messages before HELLO bypassed message quotas.** A socket with a valid signed upgrade cookie could send valid PING or gameplay messages until the eight-second authentication deadline. These frames incurred parsing and response work without the generic message limiter. The candidate meters valid pre-HELLO frames using the signed upgrade identity for participants and the IP for sessionless displays. The existing three-strike policy close makes later queued HELLO/game actions inert.
2. **Medium priority — display revocation metadata outlived its room.** `displayEpochs` retained a key per revoked room incarnation until server shutdown, even after that room was closed or expired. The candidate prunes obsolete incarnations before revocation writes and on the existing heartbeat. Live room epochs remain unchanged; stale-room capability validation still fails.

The scoped security/resource suite completed **63 tests, 63 passed, zero failures/cancellations/skips**. Local capacity evidence reached **500 rooms / 1,500 simulated participant sockets**, with no unexpected action failures, no cross-room STATE delivery, and correct initial private role/prompt projections. Room 501 was rejected by the shipped room ceiling while an existing participant remained responsive. Explicit cleanup reached zero rooms and zero active socket leases in both baseline and candidate.

## What changed

| File | Purpose | Verification |
| --- | --- | --- |
| `server/src/index.ts` | Meter valid pre-authentication frames; prune expired/closed display epoch metadata before writes and on heartbeat | Two new regressions plus existing scoped suite |
| `server/test/preauth-transport-abuse.test.ts` | Real socket sends 200 valid pre-HELLO PING frames, followed by queued HELLO and CREATE_ROOM | Exactly 80 UNAUTHORIZED + 3 RATE_LIMITED responses; close 1008; no room; lease released |
| `server/test/display-epoch-cleanup.test.ts` | Revoke two owners' display capabilities, close one room, revoke a new room | Obsolete metadata reclaimed; live room capability path unchanged |
| `docs/evidence/security-capacity/local-capacity.mjs` | Reproducible local staged-load experiment | Baseline and candidate full JSONL evidence |

The diagnostic epoch count is returned only by the internal server factory for tests; it is not exposed by an HTTP endpoint.

## Boundary review

| Boundary | Source and tested behavior | Residual limit |
| --- | --- | --- |
| Anonymous identity | Random 256-bit cookie payload with HMAC; timing-safe signature check; public UID derived from signed token; production weak secrets fail closed | Bearer credential access still grants that anonymous identity; cookie expiry is a browser attribute, not a signed server-side expiry |
| Browser socket origin | Exact scheme/host/port allowlist; production requires Origin and HTTPS configuration | Development intentionally permits absent Origin; proxy IP modes depend on the configured trusted edge |
| Private roles/prompts | Recipient-specific projection with no normal prompt to the impostor or nonparticipant before reveal; internal prompt IDs withheld | Local load asserts the initial QUESTION projection; other phases are covered by scoped projection tests |
| Voting privacy | Live recipient views expose submitted/total and the recipient's own submission status, without target totals or voter-to-target mapping; survived intermediate result hides identity/tally | Aggregate result totals become public at the intended completed stint |
| Candidate vote context | Final source emits context only to connected participant VOTING views; display projection contains no vote context | Full candidate vote/retry integration evidence is owned by the transport reviewer and main release report |
| Oversized/malformed frames | ws `maxPayload` and pre-parse byte bounds; strict keys/schema; bounded fields; invalid traffic strikes and policy-close guard | JSON parsing still occurs for in-bound frames; quotas/capacity bound admitted work rather than making abusive traffic free |
| Authentication lifetime | Eight-second HELLO timeout and one-time authenticate; candidate quota covers valid frames during that window | Closing WebSockets are finalized by ws/heartbeat rather than instant lease reclamation before the close event |
| Outbound backpressure | Connection terminates when bufferedAmount exceeds configured threshold; send failures terminate safely | Dedicated saturated slow-reader throughput was not measured; buffer handling is covered by tests/source review |
| Timers and state | Generation-guarded phase callbacks; room timers cleared on closure/disposal; idempotent disconnect and lease release; heartbeat disposes dead sockets | Capacity experiment keeps rooms in QUESTION and tests reconnect pressure; it is not a long-running full-match soak |
| Display capabilities | Exact room incarnation, current owner and revocation epoch bound to signed capability; display is read-only; only one distinct display identity active | Pairing registry and status endpoint have separate quotas/caps; local load did not include TVs |

## Shipped caps and cleanup

These values are operational limits, not evidence that production hardware can sustain all of them simultaneously.

| Resource | Shipped default / source bound |
| --- | --- |
| Active rooms | 500 |
| Players per room | 10 |
| Total socket leases | 4,000 |
| Socket leases per IP | 64 |
| Connections per signed UID | 4 |
| Incoming frame | 8 KiB |
| Outgoing buffered bytes threshold | 512 KiB |
| HELLO timeout | 8 seconds |
| Heartbeat | 30 seconds; a socket that fails a ping is terminated on the following heartbeat |
| Generic messages | 80 per signed identity per 10 seconds; candidate also meters pre-HELLO valid frames |
| Connection admission | 300 per IP / 60 per identity per minute |
| Session request admission | 300 per IP / 120 per identity per minute |
| Room creation admission | 36 per IP / 3 per identity per minute |
| Tracked abuse-limiter keys | At most 20,000 per limiter; bounded eviction and expiry cleanup |
| Request replay cache | At most 5,000 identities × 128 IDs; five-minute retention; periodic/lazy expiry |
| Idle rooms | No live room connection and >30 minutes without updates; GC every minute |
| Empty lobby | 20 minutes since meaningful use, with no players; synchronously reclaimed before room-cap admission |
| Display epochs after candidate fix | Stale keys pruned on heartbeat and before writes; continuous revocation cannot grow beyond current room incarnations plus the next admitted write |

The 4,000 socket ceiling means 500 rooms each with 10 simultaneously connected players cannot all fit. The measured experiment used three participants per room, so it stayed below that independent socket ceiling. A shared NAT is limited by 64 concurrent sockets unless operators explicitly configure a different bound.

## Local load method

One source-selected isolated runtime and all simulated clients run in the **same Node process** on loopback. Memory, CPU, and event-loop measurements therefore include the server, simulated clients, harness, and HTTP client infrastructure. They must not be labeled server-only measurements.

Baseline and candidate used the same script, incremental tiers, three distinct signed identities per room, shipped game timers, and two concurrent reconnect cycles per room at each tier. Each party was started into QUESTION. One participant in every party disconnected, the other two observed the disconnected roster state, and then all three converged after authenticated reconnect. The participant's initial private projection was checked before the reconnect experiment. Each tier also samples PING/PONG RTT across up to 60 clients for four rounds.

Local admission overrides are deliberately explicit: `RATE_LIMIT_SESSION_IP_LIMIT`, `RATE_LIMIT_CONNECTION_IP_LIMIT`, and `RATE_LIMIT_ROOM_CREATION_IP_LIMIT` are 10,000; `MAX_SOCKETS_PER_IP` is 4,000. Every simulated house shares a single loopback IP. These coarse overrides allow measuring room/socket behavior instead of stopping at shared-IP quotas. Per-identity and gameplay quotas, maximum rooms, total socket ceiling, incoming/outgoing size bounds, lifecycle behavior, and gameplay timers retain shipped values.

Runtime evidence: Node v24.19.0, Linux, reported Intel Xeon Platinum 8573C, 9 logical CPUs, 9.73 GiB system memory. The runner is shared and the processes run sequentially. This is one run per version, not statistical proof of a performance improvement. No production endpoint was stressed.

All paired cells below are **baseline / candidate**. The final candidate evidence was generated after the pre-HELLO quota fix (`index.ts` modification 11:23:14, candidate evidence completion 11:24:20, both +02:00).

| Rooms | Active sockets | RTT p95 ms | Reconnect convergence p95 ms | Process RSS MiB | Event loop p95 ms |
| --- | --- | --- | --- | --- | --- |
| 1 | 3 | 0.74 / 0.49 | 2.36 / 5.32 | 82.01 / 83.28 | 15.68 / 12.46 |
| 5 | 15 | 4.32 / 4.22 | 10.46 / 6.18 | 82.76 / 83.90 | 13.75 / 11.69 |
| 20 | 60 | 3.35 / 2.15 | 17.49 / 13.06 | 94.76 / 95.65 | 14.47 / 12.23 |
| 50 | 150 | 2.06 / 2.24 | 39.55 / 27.25 | 109.01 / 109.28 | 12.38 / 14.32 |
| 100 | 300 | 1.80 / 2.87 | 48.92 / 68.90 | 140.39 / 140.90 | 13.41 / 17.99 |
| 250 | 750 | 1.48 / 1.98 | 105.17 / 149.18 | 200.26 / 199.28 | 15.04 / 16.15 |
| 500 | 1,500 | 2.04 / 1.67 | 324.07 / 260.44 | 276.64 / 277.78 | 14.32 / 14.02 |

The practical trend is rising reconnect convergence cost as many parties reconnect at once. Candidate p99 convergence reached 267.76 ms and maximum 273.08 ms at 500 rooms; baseline p99 was 338.88 ms and maximum 341.25 ms. Neither run crossed a hard functional failure before the room ceiling. The candidate was slower at 100 and 250 rooms and faster at 500; shared-runner noise and the single run prohibit attributing that variation to a code change.

At 500 rooms the candidate tier consumed 2,133.62 ms combined process CPU over 2,110.66 ms elapsed, versus baseline 1,878.06 ms CPU over 1,861.13 ms elapsed. CPU includes admissions, creating the new groups, reconnect bursts, serialization, and simulated-client processing. Candidate maximum event-loop delay at that tier was 84.21 ms; this does not establish cue timing under real networks or browsers.

Both versions rejected the next room with RATE_LIMITED, retained 500 existing rooms, and answered an existing participant's PING (baseline 0.22 ms, candidate 0.05 ms). Explicit room closure plus socket closure produced zero rooms and zero active leases. RSS did not immediately decline; Node allocator/GC behavior and bounded replay-cache retention mean that returning room/lease counters to zero is stronger evidence of those resources being reclaimed than interpreting immediate RSS as a leak.

## Evidence and reproduction

- `docs/evidence/security-capacity/baseline.jsonl`: complete baseline environment, seven tiers, ceiling check and cleanup.
- `docs/evidence/security-capacity/candidate.jsonl`: same final-candidate measurements.
- `docs/evidence/security-capacity/baseline.stderr` and `candidate.stderr`: development-secret warning only.
- `docs/evidence/security-capacity/fix-regressions.tap`: complete two-test plan; 2 passed.
- `docs/evidence/security-capacity/security-suite.tap`: complete 63-test plan; 63 passed. Serial execution was used after an earlier parallel invocation produced incomplete output despite exit 0; that incomplete output is not counted as successful evidence.

```bash
CAPACITY_SOURCE=/workspace/scratch/aa60808fbb3a/khalik-security-baseline PORT=8082 LABEL=baseline node --import tsx docs/evidence/security-capacity/local-capacity.mjs
CAPACITY_SOURCE=/workspace/scratch/aa60808fbb3a/khalik-tabiei PORT=8083 LABEL=candidate node --import tsx docs/evidence/security-capacity/local-capacity.mjs
ANALYTICS=off node --import tsx --test --test-concurrency=1 --test-reporter=tap server/test/security.test.ts server/test/view-security.test.ts server/test/intermediate-result-security.test.ts server/test/prompt-novelty-view-security.test.ts server/test/policy-close-guard.test.ts server/test/display.test.ts server/test/display-pairing-http.test.ts server/test/room-manager.test.ts server/test/hardening-b.test.ts server/test/display-epoch-cleanup.test.ts server/test/preauth-transport-abuse.test.ts
```

## Remaining verification limits

Production-region throughput, Render instance CPU/RAM headroom, 4,000 active sockets, 10-player rooms at high concurrency, TVs at high concurrency, long full-match soak, throttled/mobile-network timing, and slow-reader saturation are not established by this experiment. The existing limits should not be enlarged for production based solely on these local measurements. The main release owner owns broad integration/build/browser checks and any production approval; this review performs no deployment, schema change, commit, or push.
