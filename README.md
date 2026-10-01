# خلك طبيعي

Arabic RTL browser party game for Saudi/Gulf groups playing in the same place. No account or installed app is required. The Node server owns membership, roles, prompts, clocks, votes and results; phones use authenticated anonymous WebSocket sessions.

This README describes the existing deployed competitive rules at `70fc5c47` and the proposed reliability candidate. Earlier documentation describing no points, an obligatory nonplaying host, untimed discussion or live target totals is superseded by the current code. The candidate preserves the existing rules.

## Devices and modes

The room owner is a real named player with a phone, private role and vote. Management controls appear on safe surfaces. An optional public TV/laptop display joins by six-digit pairing or a revocable capability link. The display cannot control the game or receive private prompts. The legacy separate-host wire path remains supported.

| Mode | Physical response |
| --- | --- |
| HANDS — ارفع يدك | Raise a hand when the prompt applies; otherwise keep it down. |
| POINT — أشر على شخص | Point at the person matching the prompt. |
| NUMBER — ارفع أصابعك | Answer from 0 to 5 with fingers; zero is a closed fist. |

Choose any nonempty mode subset. Digital controls mark readiness and cast votes; physical responses happen together on the authoritative action cue. Phones start behind a role-neutral privacy curtain. The impostor knows the mode and their role, but receives no prompt before public reveal.

## Joining

The owner creates a room and names themselves. Players join from the lobby's QR code, a shared or copied `/join/CODE` link, or by typing the 5-character room code on the home screen, then enter a name. There is no account, email or password. Reconnecting with the same browser session restores the same seat.

## Current rules

- 3–10 players, including the named owner.
- Match length is exactly **3, 6, 9 or 12 challenges**, default 9. The legacy settings field `totalRounds` carries this challenge total.
- One fixed impostor per stint: at most 1 challenge with 3 players, 2 with 4 players, and 3 with 5–10 players. Capture or the match limit can end it earlier.
- Each challenge selects a fresh prompt and consumes a balanced shuffled mode bag. Reconnect/redeal preserves the selected mode.
- Capture requires a strict majority of **ballots actually cast**, including the impostor's ballot. Zero ballots never catch anyone. Missing ballots become abstentions at the deadline. One correct ballot can catch if it is the only ballot cast.
- The impostor earns one point per survived challenge. Normal players earn the length of their uninterrupted correct-vote streak ending at the final vote of that stint. A wrong or missing vote breaks the streak. Points settle at stint end; result screens explain changes and display rankings.
- Live voting shows submitted/total only. Target totals and voter mappings are hidden. Intermediate survived results hide impostor identity/tally; final stint results reveal identity and an anonymous aggregate tally.

| Stage | Duration / progression |
| --- | --- |
| QUESTION | Private reading/readiness; role-blind recovery for an unready disconnected participant after 30 seconds. |
| COUNTDOWN | 5 seconds. |
| ACTION | 1 second. |
| HOLD | 5 seconds to look around. |
| PROMPT_REVEAL | 2.5 seconds. |
| DISCUSSION | 45 seconds, then automatic voting. |
| VOTING | 15 seconds, or earlier once all ballots resolve. |
| Intermediate survived RESULT | 4 seconds. |
| Full stint RESULT | 20 seconds, or owner advances. |
| GAME_OVER | Match scores and rematch controls. |

The owner can end a running match at any time with «إنهاء اللعبة». Everyone returns to the lobby of the same room with their seats kept, so settings can change and a new match can start without rejoining. The ended match's points are discarded and any in-flight ballot from it is ignored. «إغلاق الغرفة» (from the lobby or game over) is separate: it closes the room and everyone must join a new room.

Owner disconnect does not pause the game clock. Authority transfers after 60 seconds to an eligible connected successor; the old owner returns as a player. Existing membership/redeal/abstention policies govern other departures.

## Prompts and replayability

900 active imitation prompts: 300 per mode. The 110 legacy TEXT_PAIR pairs remain in source but are not selectable. CHOOSE, Face and runtime AI generation are not part of the product.

Current-match duplicate protection and exact room-session history remain separate. Room-session history survives rematches and roster/mode changes; exhausting a mode recycles only that mode. Browsers keep a bounded versioned exact-bitset of publicly revealed prompts. The server unions validated current-participant histories as an advisory freshness preference. Malformed, unavailable or exhausted history fails open without blocking play. The hint has no authority over identity, roles, voting or timers. See [cross-room novelty](docs/cross-room-novelty.md).

## Security and reliability

- HMAC-authenticated anonymous identity in an HttpOnly, SameSite cookie; production uses Secure cookies and persistent strong secrets.
- Exact production Origin checks, strict runtime schemas, size limits, quotas, policy-close guards, admission limits and outbound backpressure.
- Recipient-specific serialized views enforce pre-reveal secrecy; internal prompt IDs and future prompts are not sent. UI hiding adds protection.
- Candidate ballots use an opaque challenge UUID, given only to eligible voting participants. Stale/closed ballots report an explicit ignored outcome; same-target duplicates are idempotent. Changed targets and unauthorized actions remain failures.
- Mutations are never automatically replayed after reconnect. Pending controls provide feedback and suppress rapid duplicate taps. Candidate heartbeat recovery replaces silent OPEN sockets without waiting for a close handshake.
- Candidate render/import recovery gives Arabic reload UI. Bounded diagnostics retain error class, surface/phase and same-origin hashed source coordinates, without raw messages, stacks, private URLs or gameplay content.

Deploy matching client/server builds together. Cached older tabs cannot supply the new ballot context and must refresh; their generic error copy cannot be retroactively changed. See [transport release notes](docs/release-20260930-transport.md).

## Run and verify

Node.js 20.19+; CI uses Node 22.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Open `http://localhost:8080`; development mode is `npm run dev`. There is no lint script.

Run real protocol suites and their server in one local network namespace:

```sh
node server/test/run-release-integration.mjs
node server/test/run-release-integration.mjs --production
```

The existing `npm run test:integration` and `npm run test:integration:multigroup` also work with an externally started local server. `playwright.config.mjs` is the CI browser suite; `playwright.release.config.mjs` adds isolated local ports/output folders and optional `PLAYWRIGHT_CHROMIUM_PATH`. Browser emulation is not real iPhone/Android validation.

## Operations

Rooms and state are single-instance/in-memory. Restart/deployment loses active rooms; signed identity cannot recreate them. Independent instances behind a load balancer are unsupported. Announce/drain active rooms before an approved production deployment.

| Setting | Production requirement |
| --- | --- |
| NODE_ENV | `production`. |
| SESSION_SECRET | Strong persistent secret, at least 32 bytes. |
| ANALYTICS_SECRET | Strong persistent separate secret unless `ANALYTICS=off`. |
| PUBLIC_ORIGIN | Exact canonical HTTPS origin; Render hostname can provide it. |
| ALLOWED_ORIGINS | Optional additional exact HTTPS origins. |
| PORT / HOST | Defaults `8080` / `0.0.0.0`; local runner binds loopback. |
| TRUST_PROXY / RENDER | Match trusted edge topology. |

`/healthz` is liveness, `/readyz` is readiness (503 during drain), `/version` returns deployed SHA. Graceful shutdown gives notice without persisting rooms. Defaults of 500 rooms, 4,000 sockets globally and 64 per source IP are admission ceilings, not production capacity promises. See [production operations](docs/production-operations.md) and [measured capacity limitations](docs/release-20260930-security-capacity.md).

**Owner trials.** Open the game once with `?trial=1` (for example `https://<host>/?trial=1`) on each phone used for internal testing. Rooms created from that browser, and its client telemetry, are recorded with analytics environment `test` so launch metrics can exclude them. `?trial=0` removes the mark. It changes nothing in gameplay or identity.

**Link previews.** `index.html` carries Arabic Open Graph tags; the server replaces `__PUBLIC_ORIGIN__` with `PUBLIC_ORIGIN` so WhatsApp gets an absolute image URL (`/og.jpg`).

## Release evidence

- [Release assessment](docs/release-20260930.md)
- [External benchmark](docs/release-20260930-benchmark.md)
- [Ballot/reconnect corrections](docs/release-20260930-transport.md)
- [Runtime attribution/diagnostics](docs/release-20260930-runtime.md)
- [Security/capacity assessment](docs/release-20260930-security-capacity.md)

Automated/simulated persona testing does not establish market demand or replace real Saudi group playtests.
