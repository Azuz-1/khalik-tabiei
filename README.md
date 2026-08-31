# خلك طبيعي — Real-time Arabic Social Deception Party Game

A production-ready, browser-based multiplayer party game for Saudi/Gulf groups
playing together in the same room. Most players get the same secret question;
one random player (**المتخفي**) gets a different but closely related question.
Everyone answers, answers are revealed together, players argue in real life,
then vote secretly for the impostor.

**No app, no account, no email, no password.** Open the game on a TV, scan the
QR from your phones, type a name, and you're playing in under a minute.

- All player-facing UI is **Arabic + RTL**. Code, types, and docs are English.
- Real, authoritative multiplayer over WebSockets — no mock data.
- Secret questions and the impostor's identity are **never** sent to clients
  that shouldn't see them, enforced server-side (see [Security](#security)).
- 110 curated, original Arabic question pairs across 9 categories.

---

## Two device roles

**Shared host screen** (TV / laptop / tablet): shows the room code, a large QR,
the live player list, answer reveals, and progress. It controls the game but is
**not** a player and never receives secret questions. If the host wants to
play, they join from their phone like everyone else.

**Player phone** (private): shows only that player's own secret question, the
answer box, and voting. Secret data belonging to other players is never sent to
this device.

---

## Quick start (run locally)

Requirements: **Node.js 20+**.

```bash
npm install        # installs server + client workspaces
npm run build      # builds the React client
npm start          # starts the server on http://localhost:8080
```

Open `http://localhost:8080` on the host screen and press **سو غرفة**. On each
phone, open the same address (or scan the QR) and join.

> Phones must reach the host machine. On the same Wi-Fi, use the host's LAN IP,
> e.g. `http://192.168.1.20:8080`. For phones on other networks, or to share a
> link with friends, see **[Get a public link](#get-a-public-link)**.

### Development mode (hot reload)

```bash
npm run dev        # Vite dev server (5173) + server (8080), WS proxied
```

---

## Get a public link

The game is one self-contained server, so any host that runs Node and supports
WebSockets works. Two easy options:

**A) Instant tunnel from your own machine** (temporary link, great for testing):

```bash
npm run build && npm start                     # terminal 1
npx cloudflared tunnel --url http://localhost:8080   # terminal 2  → prints an https URL
# or: npx localtunnel --port 8080
```

Share the printed `https://…` URL. QR codes and join links use the browser's
origin automatically, so they'll point at the tunnel with no config.

**B) Deploy for a permanent link** (Render, free tier):

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New + → Blueprint**, select the repo.
   `render.yaml` is already included — it builds and runs the app and gives you
   a public HTTPS URL with WebSocket support.

A `Dockerfile` is also included for any container host (Fly.io, Railway, a VPS):

```bash
docker build -t khalik . && docker run -p 8080:8080 khalik
```

---

## Testing

```bash
npm test           # engine unit tests (Node test runner)
```

The engine suite covers impostor selection & fairness, scoring, the tie rule,
phase transitions, duplicate answer/vote protection, and — crucially — that the
per-recipient view never leaks the impostor or the other question before the
result.

There is also a full end-to-end test that drives **1 host + 3 players over real
WebSockets** through several rounds and inspects the raw wire for leaks:

```bash
npm start                          # in one terminal
node server/test/integration.mjs   # in another
```

It asserts real-time joins, secret-question isolation, answer privacy, vote
secrecy, correct reveal timing, duplicate-name and unknown-code rejection, and
reconnect-by-key.

---

## Security

This game contains secret information, so the architecture is built around it:

- The **server is authoritative**. Clients render whatever state the server
  sends and never compute game logic. The room `status`, current round, scores,
  impostor, and question are set only by the server.
- **Identity is server-derived.** Each browser stores a random secret
  `clientKey`; the server computes `uid = HMAC(secret, clientKey)`. Clients
  never send a uid, so they can't impersonate anyone. Reconnect after a refresh
  or dropped connection resolves to the same uid and restores the seat. This is
  the self-hosted equivalent of anonymous auth — no accounts, no PII.
- **Per-recipient views.** `server/src/game/view.ts` is the only bridge from
  secret state to the wire. It builds one `ClientView` per recipient containing
  public data plus *that recipient's own* private data. A player receives only
  their own question; the impostor's identity and both questions appear only in
  the `RESULT`/`GAME_OVER` phases; raw answers and votes are never sent — only
  counts — until their reveal moment.
- **Every mutation is authorized on the backend** against the connection's
  server-derived uid (host-only actions check `hostUid`). Frontend UI hiding is
  never used as authorization.

Open dev tools on a normal player's browser and you will not find the impostor,
the other question, other players' questions, or votes before they are revealed
— in Firestore-style docs, network frames, React state, or localStorage — by
design. The unit and integration tests assert this.

---

## Concurrency

The server runs on Node's single-threaded event loop, so state mutations are
naturally serialized — there is no way to get 11 players into a 10-seat room or
two different impostors from duplicate start requests. On top of that, actions
are **idempotent**: a second answer or vote from the same player is rejected
(`ANSWER_ALREADY_SUBMITTED` / `VOTE_ALREADY_SUBMITTED`), capacity and duplicate
names are checked atomically at join, and auto-advance transitions are guarded
by the current phase so a double-click can't double-fire them.

---

## Project structure

```
shared/                 Types + constants shared by client and server (the wire contract)
  types.ts              GamePhase, ClientView, ClientMessage/ServerMessage, error codes
  constants.ts          Player limits, room-code alphabet, scoring, timers, categories

server/
  src/
    index.ts            HTTP (serves client) + WebSocket on one origin
    config.ts
    auth/session.ts     Anonymous HMAC identities (no accounts)
    game/
      questions.data.ts 110 curated Arabic question pairs (the content pack)
      questions.ts      Question service (selection, no-reuse, future packs)
      state.ts          Internal room/round model (holds secrets) + input validation
      engine.ts         Pure, testable game logic (transitions, scoring, impostor pick)
      view.ts           Per-recipient safe projection (the security boundary)
      roomManager.ts    Orchestrates rooms, connections, timers, broadcasts
      code.ts, errors.ts
    net/connection.ts   One browser socket
    analytics.ts        Lightweight, privacy-safe event abstraction
  test/
    engine.test.ts      Unit tests
    integration.mjs     End-to-end multi-client WebSocket test

client/                 React + TypeScript + Vite (mobile-first players, big host screen)
  src/
    net/socket.ts       WS client, reconnect, store, typed actions
    state, i18n/errors.ts (Arabic error copy)
    screens/            Home, Host (all phases), Player (all phases)
    components/         QR, players, result/scoreboard bits
    styles.css          Dark violet premium theme, RTL
```

---

## Adding questions and categories

Questions are curated content, never AI-generated at runtime. To add pairs,
append to `CORE_PACK` in `server/src/game/questions.data.ts`:

```ts
{ id: "food_new_01", category: "food", pack: "core",
  normalQuestion: "…", impostorQuestion: "…" }
```

Good pairs are closely related so answers overlap (e.g. *أفضل شي مع الكبسة*
vs *أفضل شي مع المندي*). To ship a separate pack (e.g. an adult pack later),
create a new array with a distinct `pack` value and merge it in
`server/src/game/questions.ts` — the engine needs no changes. Add categories in
`shared/constants.ts`.

Tunable game balance (scoring, player limits, timers, round options) lives in
`shared/constants.ts`.

---

## Game rules recap

3–10 players. One impostor per round, chosen server-side with fair
distribution. Each player answers their own question with one short answer.
After all answers show, players discuss out loud (no voice/text chat — you're in
the same room) without revealing the exact question they got. Then everyone
votes secretly.

**Tie rule:** the group must land its single highest vote on one player. A tie
at the top means the group failed and the impostor survives.

**Scoring:** if the impostor is caught, each normal player who voted for them
gets **+1**. If the impostor survives (wrong top vote or a tie), the impostor
gets **+2**. Highest total after the chosen number of rounds wins.
