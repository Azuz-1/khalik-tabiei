# خلك طبيعي — Real-time Arabic Social Deception Party Game

**خلك طبيعي** is a browser-based multiplayer party game for Saudi/Gulf groups
playing together in the same room. The current game is built around three
physical imitation modes:

- **🙋 HANDS — ارفع:** normal players see a private statement and raise a hand if it applies.
- **👉 POINT — أشر:** normal players see who to point at.
- **🔢 NUMBER — كم؟:** normal players answer with a number using their fingers.

One player is the **المتخفي**. They know that they are the impostor, but they do
**not** receive the current prompt. Everyone gets ready on their phone, the
shared screen runs a synchronized countdown, everyone responds physically at
the same time, the group discusses what looked suspicious, and players vote
secretly from their phones.

A round can continue for up to **three challenges with the same impostor**. If
the group catches the impostor, the round ends immediately. If the vote is tied
or the unique highest vote lands on the wrong player, the impostor survives and
moves to another challenge with a new prompt. Surviving challenge 3 ends the
round and awards the impostor **+2**.

**No app, no account, no email, no password.** Open the game on a TV, scan the
QR from player phones, type a name, and play.

- Player-facing UI is **Arabic + RTL**. Code, types, and technical docs are English.
- Multiplayer is authoritative and real-time over WebSockets; there is no mock game state.
- Private prompts and roles are projected per recipient on the server.
- The active playtest pack currently contains **30 imitation prompts**: 10 HANDS, 10 POINT, and 10 NUMBER.
- The repository still contains **110 legacy TEXT_PAIR question pairs** across 9 categories. They are retained as legacy content for future work but are **not selectable through the current UI or protocol settings**.
- **CHOOSE is not available in the current product.**

---

## Device roles

### Shared host screen

The TV/laptop/tablet creates the room, shows the QR and player list, lets the
host choose any non-empty subset of HANDS / POINT / NUMBER, starts the game,
runs the synchronized countdown, opens voting after discussion, and displays
results and scores.

The host screen is **not a player** and never receives the private imitation
prompt. If the person operating the host screen wants to play, they join from a
phone like everyone else.

### Player phone

Each phone is private. During a challenge:

- a **normal player** receives the current mode and prompt;
- the **impostor** receives `isImpostor: true` but receives neither prompt text nor `promptId`;
- each player presses **جاهز**;
- after the physical response and discussion, the phone is used for secret voting.

Reconnect with the same anonymous session cookie restores the same seat and the
correct private view for the current phase.

---

## Quick start

Requirements: **Node.js 20.19+**. CI and the production configuration use Node 22.

```bash
npm ci
npm run build
npm start
```

Open `http://localhost:8080` on the shared host screen and press **سو غرفة**.
Player phones can open the same reachable origin or scan the QR.

For testing from phones on the same Wi-Fi, use the host machine's LAN address
and configure the exact public origin, for example:

```bash
PUBLIC_ORIGIN=http://192.168.1.20:8080 npm start
```

### Development mode

```bash
npm run dev
```

This starts the server on port 8080 and Vite on port 5173 with WebSocket proxying.

---

## Public deployment

The application is a self-contained Node server with WebSocket support. It can
run behind Render, a container host, or another reverse proxy that preserves
WebSocket upgrades.

Production requires a stable high-entropy `SESSION_SECRET` and an exact
`PUBLIC_ORIGIN`. Rotating `SESSION_SECRET` intentionally invalidates anonymous
browser sessions.

Example container run:

```bash
docker build -t khalik .
docker run -p 8080:8080 \
  -e SESSION_SECRET='replace-with-at-least-32-random-bytes' \
  -e PUBLIC_ORIGIN='https://game.example.com' \
  khalik
```

---

## Current gameplay flow

1. The host creates a room and players join from phones.
2. In the lobby, the host chooses one, two, or all three active modes: HANDS,
   POINT, NUMBER. At least one mode must remain selected.
3. The host starts the game. The server chooses one impostor using the fairness
   history and chooses a mode through the balanced mode bag.
4. Normal players receive the prompt privately. The impostor is explicitly told
   that they are the impostor but receives no prompt.
5. Every player presses **جاهز**.
6. When everyone is ready, the authoritative server starts the shared countdown.
7. Everyone performs the physical response at the same time and holds it briefly.
8. The group discusses who looked suspicious.
9. The host opens voting. Each player votes secretly for another participant.
10. A unique highest vote on the impostor catches them and ends the round.
11. A tie or a unique highest vote on someone else lets the same impostor survive.
    If this was challenge 1 or 2, the host advances to a new challenge with the
    same impostor and a new prompt.
12. If the impostor survives challenge 3, the round ends and they receive +2.

The balanced mode bag uses every selected mode before refilling when possible
and avoids unnecessary repeats across bag boundaries.

---

## Game rules and scoring

The game supports **3–10 players** plus the non-playing shared host screen.

### Catch rule

The group catches the impostor only when the impostor is the **single unique
highest-voted player**. A tie at the top is a failed catch.

### Scoring

- **+1** to each normal player who voted for the impostor when the impostor is caught.
- **0** survival points after challenge 1 or 2. The round simply continues.
- **+2** to the impostor only if they survive **challenge 3**.
- The impostor does not receive a correct-vote point.

The highest total score after the selected number of rounds wins. Tied top
scores produce tied winners.

---

## Prompt content

### Active imitation prompts

Current active prompts live in:

```text
server/src/game/imitationPrompts.data.ts
```

Each item has an id, one of the active modes, prompt text, and optional content
flags:

```ts
{
  id: "H11",
  mode: "HANDS",
  text: "ارفع يدك إذا ...",
  flags: ["OPTIONAL_REVIEW_FLAG"],
}
```

Keep prompt ids unique. The server tracks used prompt ids and avoids reuse until
the relevant pool is exhausted.

### Legacy TEXT_PAIR content

`server/src/game/questions.data.ts` still contains the **110 curated TEXT_PAIR
pairs** and `questions.ts` still contains their selection service. This content
is intentionally retained for future work, but the current authoritative
settings reject category/TEXT_PAIR activation and the current client does not
expose it. Do not describe or ship it as an active mode without a separate
product decision and implementation.

CHOOSE is likewise not part of the current selectable mode catalog.

---

## Security model

The game contains secret information, so secrecy is enforced at the server/wire
boundary rather than by hiding frontend components.

- **Server-authoritative state.** The server owns room membership, phase,
  impostor selection, prompts, votes, scores, timers, and transitions.
- **Anonymous authenticated sessions.** `/api/session` issues a cryptographically
  random HMAC-authenticated token in an `HttpOnly`, `SameSite=Lax` cookie
  (`Secure` in production). The browser does not read or store the credential in
  React/localStorage.
- **Exact Origin enforcement.** WebSocket upgrades validate the browser Origin
  against the configured canonical/allowed origins to prevent cross-site
  cookie-authenticated WebSocket use.
- **Strict runtime message validation.** Client messages are checked for known
  discriminants, exact shapes, allowed enums, lengths, ids, and arrays before
  reaching game state.
- **Per-recipient views.** `server/src/game/view.ts` is the security boundary
  between internal secret state and WebSocket payloads. Normal players get the
  current prompt only during the private prompt phase. The impostor gets their
  role marker but no prompt or `promptId`. The host gets neither.
- **Intermediate-result redaction.** If the impostor survives challenge 1 or 2,
  the result deliberately hides impostor identity, the previous prompt, vote
  tally, vote breakdown/correctness, role-linking metadata, and score deltas so
  the next challenge does not leak who was implicitly cleared.
- **Completed-round reveal.** Once the round actually ends, result data can
  reveal the impostor, final challenge prompt, tally, vote breakdown, and score
  deltas.
- **Backend authorization.** Host-only mutations validate `hostUid` on the
  server. UI visibility is never treated as authorization.
- **Bounded abuse controls.** Connection counts, active rooms, session/action
  rates, and WebSocket backpressure are bounded in memory.

### Disconnect and reconnect policy

A transient socket drop changes presence but preserves the player's seat during
the disconnect grace window. Reconnecting with the same session cookie cancels
the pending removal and restores the correct current private view.

If grace expires while a round is incomplete — including an intermediate
challenge `RESULT` — the disconnected player is removed and that incomplete
round is cancelled/redealt from challenge 1 with no points if at least three
players remain. If fewer than three remain, the game returns to a clean lobby.
This prevents stale participant seats or a removed impostor from being carried
into a later challenge.

Completed results/game-over screens keep completed participants long enough to
preserve the final result/ranking, then pending removals are pruned at the next
safe transition.

---

## Testing

Run the standard validation suite:

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

The unit/integration-style Node test suite covers mode permissions, settings
locking, balanced mode selection, same-impostor challenge progression, scoring,
strict wire validation, prompt secrecy, intermediate-result redaction,
reconnect/grace handling, room membership/capacity, anonymous session security,
Origin checks, rate limiting, and backpressure.

### Real WebSocket E2E

`server/test/integration.mjs` runs against a real server with **1 host + 3
players**. Start the server, then run the E2E test:

```bash
npm start
# in another terminal
npm run test:integration
```

The E2E covers:

- `selectedModes` and `START_GAME`;
- normal prompt delivery;
- impostor `isImpostor` delivery with no prompt/`promptId`;
- reconnect preserving normal and impostor private views;
- `MARK_READY` and the authoritative countdown;
- `DISCUSSION` and `VOTING`;
- challenge 1/2 survival with identity/tally/vote details hidden;
- same impostor continuing with a new prompt;
- challenge 3 survival ending the round and awarding exactly +2;
- raw impostor WebSocket traffic never containing the secret prompt or a
  `promptId` field.

CI starts a real server and runs this E2E in addition to typecheck, tests, build,
audit, and CodeQL.

---

## Project structure

```text
shared/
  types.ts                  Shared wire contract and game types
  constants.ts              Limits, active modes, scoring, timers, legacy categories

server/
  src/
    index.ts                HTTP server + WebSocket upgrade on one origin
    config.ts               Environment and origin configuration
    auth/session.ts         Anonymous signed session cookies / stable uid derivation
    game/
      imitationPrompts.data.ts  Active HANDS / POINT / NUMBER playtest prompts
      questions.data.ts     110 legacy TEXT_PAIR pairs (retained, not selectable)
      questions.ts          Legacy TEXT_PAIR selection service
      state.ts              Internal room/round state and input sanitization
      engine.ts             Authoritative transitions, mode balance, voting, scoring
      view.ts               Per-recipient safe projection / secrecy boundary
      roomManager.ts        Rooms, sockets, countdowns, reconnect/grace orchestration
      code.ts, errors.ts
    net/connection.ts       Authenticated WebSocket connection wrapper
    analytics.ts            Lightweight privacy-safe events
  test/
    engine.test.ts          Game-engine rules
    room-manager.test.ts    Room/reconnect/timer behavior
    *security*.test.ts      Wire and result secrecy regressions
    integration.mjs         Real 1-host + 3-player WebSocket E2E

client/
  src/
    screens/Home.tsx        Current game explanation and room entry
    screens/Host.tsx        Shared-screen lobby/game/results UI
    screens/Player.tsx      Private player prompt/ready/vote UI
    net/socket.ts           WebSocket client/store/actions
    components/             QR, players, result and scoreboard components
    i18n/                   Arabic errors
    styles.css              RTL responsive theme
```

---

## Concurrency and persistence

Room mutations execute on Node's single-threaded event loop and phase checks
make duplicate/late actions fail safely. Votes are immutable after submission,
capacity and duplicate-name checks happen before insertion, and countdown/timer
callbacks verify the current room/phase before transitioning.

The current deployment is intentionally **single-instance and in-memory**.
Rooms, timers, indexes, and rate-limit buckets are cleaned up, but a process
restart destroys active rooms. There is no Redis/database persistence or
horizontal multi-instance coordination in this version.

---

## Environment

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | Set to `production` in production. |
| `SESSION_SECRET` | Required in production; stable and at least 32 high-entropy bytes. |
| `PUBLIC_ORIGIN` | Required in production; exact canonical `https://host` origin. |
| `ALLOWED_ORIGINS` | Optional comma-separated additional exact origins; never `*`. |
| `PORT`, `HOST` | Optional listener settings; defaults are `8080` and `0.0.0.0`. |
| `TRUST_PROXY` | Configure only for the intended trusted proxy topology. Render-specific IP handling uses the proxy-controlled header rather than caller-prepended XFF. |

Production security headers include HSTS, anti-framing, nosniff, referrer and
permissions policies. The CSP remains same-origin for scripts; existing React
inline styles require `style-src 'unsafe-inline'`.
