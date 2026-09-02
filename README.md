# خلك طبيعي — Real-time Arabic Social Deception Party Game

**خلك طبيعي** is a browser-based multiplayer party game for Saudi/Gulf groups
playing together in the same room. The current product has three physical modes:

- **🙋 HANDS — ارفع**
- **👉 POINT — أشر**
- **🔢 NUMBER — كم؟**

A full **Game** contains several **Rounds**. Each Round has one fixed impostor and
up to three **Challenges**. Every Challenge gets one mode, one private prompt, a
synchronized physical response, a public prompt reveal, discussion, and secret
voting. The impostor stays the same inside the Round, while the mode may rotate
between Challenges.

The impostor knows they are the impostor and knows the current mode/action, but
does not receive the prompt before it becomes public after the physical
response.

There are **no player points, rankings, or individual winners** in the current
version. At Game Over the shared screen summarizes how many rounds the group
caught the impostor and how many rounds the impostor survived.

**No app, no account, no email, no password.** Open the host screen on a TV or
laptop, scan the QR from player phones, type a name, and play.

- Player-facing UI is **Arabic + RTL**.
- Multiplayer is authoritative and real-time over WebSockets.
- Private prompts and roles are projected per recipient on the server.
- The active playtest bank contains **30 imitation prompts**: 10 HANDS, 10 POINT,
  and 10 NUMBER.
- The repository still contains **110 legacy TEXT_PAIR pairs** across 9
  categories. They are retained as legacy content but are **not selectable in
  the current UI/settings**.
- CHOOSE is not part of the current product.

---

## Core terms

- **GAME** — the complete session containing the configured number of Rounds.
- **ROUND** — one fixed impostor + up to 3 Challenges.
- **CHALLENGE** — one mode + one prompt + ready + countdown + physical action +
  hold + prompt reveal + discussion + secret vote.

Catching an impostor ends the **Round**, not the **Game**. If more configured
Rounds remain, the host advances to a new Round with a new fair impostor.

---

## Device roles

### Shared host screen

The TV/laptop/tablet:

- creates the room and shows the QR/player list;
- lets the host choose any non-empty subset of HANDS / POINT / NUMBER;
- explains each physical mode clearly in the Lobby before play;
- chooses the Round count;
- acts as the Game Director during play;
- shows the current Challenge's short mode label, 5-second countdown, action
  moment, hold, prompt reveal, discussion, live anonymous voting board, Round
  Result, and Game Over group summary.

The host screen is **not a player** and receives no private prompt before the
prompt-reveal phase.

### Player phone

During the private phase:

- a **normal player** receives the current Challenge mode, private prompt, and
  action instruction;
- the **impostor** receives the current mode/action and `isImpostor: true`, but
  receives neither prompt text nor `promptId`;
- every player presses **جاهز**.

After Ready, the phone tells the player to look at the shared screen. There is
no digital HANDS/POINT/NUMBER response and no countdown on player phones.

Reconnect with the same anonymous session restores the same seat. Before the
action, normal reconnect restores the current private prompt while impostor
reconnect still receives no prompt.

---

## Current gameplay flow

1. Host creates a room and players join from phones.
2. Host selects one, two, or all three active modes and a Round count.
3. Server starts Round 1 and chooses a fair impostor.
4. Challenge 1 consumes the next mode from the balanced Challenge-level mode
   bag and gets a new prompt from that mode's bank.
5. Normal players see the prompt privately. The impostor sees only their role,
   current mode, and action instruction.
6. Everyone presses Ready.
7. The shared screen runs:
   - **5-second COUNTDOWN** (`5 → 4 → 3 → 2 → 1`)
   - **ACTION** (`ارفعوا!`, `أشروا!`, or `ورّونا!`)
   - **HOLD** for about 2 seconds (`ثبّتوا… 👀`)
   - **PROMPT_REVEAL** (`المطلوب كان…` + the actual prompt)
8. From PROMPT_REVEAL onward, that Challenge's prompt is public. The next
   Challenge's prompt has not been selected/sent yet.
9. Discussion has no timer. The shared TV keeps the public prompt visible while
   the group discusses. The host decides when to open voting.
10. Every player votes secretly for another participant from their phone.
11. During VOTING, the shared host screen deliberately shows a **live aggregate
    tally**: every participant remains in a fixed card position while only their
    votes-received counter changes. Late voters can see this TV state; that is an
    intentional current playtest decision.
12. The impostor is caught only if they receive a true majority:

```text
requiredVotes = floor(participantCount / 2) + 1
```

13. If the impostor gets the majority, the Round ends immediately.
14. If the impostor gets less than the majority — even if another player gets a
    majority — the impostor survives that Challenge.
15. After Challenge 1/2 survival, the **same impostor and participants** continue,
    but the next Challenge consumes the next balanced mode and gets a fresh
    prompt from that mode.
16. If the impostor survives Challenge 3, the Round ends as an escape.
17. If more Rounds remain, a new Round starts with a new/fair impostor. Mode
    rotation continues at Challenge level rather than being tied to Round
    boundaries.
18. Only after the configured Round count is complete does the Game enter
    `GAME_OVER`.

---

## Majority examples

| Players | Votes required to catch impostor |
| ---: | ---: |
| 3 | 2 |
| 4 | 3 |
| 5 | 3 |
| 6 | 4 |
| 7 | 4 |
| 8 | 5 |
| 9 | 5 |
| 10 | 6 |

A unique-highest vote is **not enough** by itself. A wrong majority on a normal
player also does not catch the impostor.

---

## Voting board and privacy

### Live Host/TV tally during VOTING

The server keeps the authoritative internal vote map for result computation, but
the Host receives only this kind of aggregate projection:

```ts
liveVoteTally: Array<{
  uid: string;
  name: string;
  votes: number;
}>;
```

The array stays in stable participant order so cards do not jump when counts
change. It includes zero-vote players and updates after every submitted vote.
Player phones do **not** receive `liveVoteTally`.

The wire does not serialize `voterUid`, `voterName`, `targetUid`, `voteBreakdown`,
`voterTarget`, or any voter → target map.

### Intermediate result (Challenge 1/2 survival)

Once all votes are submitted and the group did not catch the impostor, the
intermediate Result communicates only that the same impostor continues.

It does **not** expose:

- impostor identity;
- result tally;
- voter identities;
- voter → target mappings;
- points, scoreboard, or ranking.

The previous Challenge prompt is already public because it was revealed before
discussion.

### Round-end result

When the Round actually ends, the result shows:

- caught vs escaped;
- impostor name;
- challenge number where the Round ended;
- an **anonymous aggregate tally** for the final Challenge only.

The Round-end tally reuses the same participant-card board presentation and
stable participant ordering. It includes every participant, including zero-vote
players. It contains only player identity + votes received, never voter
identity/mapping.

---

## Game Over

After the final configured Round, the shared screen shows a group summary such
as:

```text
خلصت اللعبة 🎉
مسكتوا المتخفي في 3 من 5 جولات 👏
✅ انكشف: 3
😈 نجا: 2
```

There is no points table, ranking, or individual winner.

---

## Mode onboarding and behavior

The Home screen and Host Lobby use full labels/descriptions for first-time
players. During active play the UI can use the shorter labels because the group
has already learned the interactions.

### 🙋 HANDS — ارفع يدك

- If the prompt applies to you, raise your hand.
- Otherwise keep your hand down.
- Hold the position until the prompt reveal.

Short in-game label: **🙋 ارفع**.

### 👉 POINT — أشر على شخص

- Read the prompt and choose the person you think matches it.
- At `أشروا!`, everyone points at the same time.
- Hold the point until the prompt reveal.

Short in-game label: **👉 أشر**.

### 🔢 NUMBER — ورّنا الرقم

- Show a number from 0 to 5 using your fingers.
- `0` means a closed fist.
- At `ورّونا!`, everyone reveals the number at the same time.

Short in-game label: **🔢 كم؟**.

---

## Mode and prompt rotation

### Mode selection

The host may select any non-empty subset of HANDS / POINT / NUMBER.

The server uses a balanced shuffled mode bag **per Challenge**:

- only selected modes enter the bag;
- every selected mode is consumed once before refill where applicable;
- when alternatives exist, the first mode after refill is adjusted to avoid an
  immediate repeat of the previous Challenge mode;
- with one selected mode, that mode naturally repeats every Challenge;
- reconnect/disconnect redeals preserve the already-selected current Challenge
  mode and do not consume another bag entry.

The same impostor remains fixed for all Challenges in a Round regardless of
mode changes.

### Prompt history

Every Challenge receives a prompt from its current mode's bank.

`usedPromptIds` is Game-scoped. A prompt is not repeated while an unused prompt
exists for the same mode.

When one mode's entire prompt bank is exhausted, only that mode's used prompt
ids are reset and its prompts become eligible again. A small playtest bank can
therefore never block a long Game.

---

## Security model

Secret-state protection is enforced at the server/wire boundary, not by React
component hiding.

- **Server-authoritative state.** The server owns room membership, phases,
  impostor selection, mode selection, prompt selection, votes, timers, and
  Round/Game transitions.
- **Anonymous authenticated sessions.** `/api/session` issues a cryptographically
  random HMAC-authenticated token in an `HttpOnly`, `SameSite=Lax` cookie
  (`Secure` in production).
- **Exact Origin enforcement.** WebSocket upgrades validate browser Origin
  against configured allowed origins.
- **Strict runtime message validation.** Unknown or malformed WebSocket messages
  are rejected before game state mutation.
- **Per-recipient views.** `server/src/game/view.ts` is the only projection from
  internal secret room state to client payloads.
- **Pre-reveal secrecy.** During QUESTION / COUNTDOWN / ACTION / HOLD, the host
  and impostor receive no prompt text or `promptId`. Normal participants may
  receive their own current private prompt for reconnect recovery.
- **Public reveal boundary.** The current Challenge prompt becomes public only
  when the authoritative server enters `PROMPT_REVEAL` after HOLD.
- **No future prompt leak.** A later Challenge's mode/prompt is prepared only
  when the host intentionally advances after the intermediate result.
- **Vote privacy.** The server keeps the internal voter → target Map only for
  authoritative computation. Host VOTING projection is aggregate-only; result
  projection is aggregate-only; player phones never receive live aggregate
  counts or voter identities.
- Existing connection caps, rate limiting, backpressure protection, session
  validation, and disconnect grace behavior remain in place.

### Disconnect/reconnect policy

The participant set is stable during a Challenge. A transient socket drop marks
presence but does not immediately remove the seat.

If a disconnected participant reconnects inside the grace period, the current
seat/private view is restored. If grace expires during an incomplete Round, the
current Round is safely redealt if enough players remain. A redeal keeps the
already-selected **current Challenge mode** so it does not consume an extra
Challenge-mode bag slot.

---

## Prompt content

Active prompts live in:

```text
server/src/game/imitationPrompts.data.ts
```

The current playtest bank has 30 items:

- 10 HANDS
- 10 POINT
- 10 NUMBER

Do not add Face, CHOOSE, TEXT_PAIR UI, or runtime AI generation without a
separate product decision.

### Legacy TEXT_PAIR

`server/src/game/questions.data.ts` still contains the 110 curated TEXT_PAIR
pairs and `questions.ts` still contains their selection service. This is legacy
content retained for future work. Current authoritative settings reject category
activation and the current client does not expose TEXT_PAIR.

---

## Quick start

Requirements: **Node.js 20.19+**. CI uses Node 22.

```bash
npm ci
npm run build
npm start
```

Open `http://localhost:8080` on the host screen. Player phones can open the same
reachable origin or scan the QR.

Development mode:

```bash
npm run dev
```

---

## Testing

Run the normal checks:

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

The real WebSocket E2E requires a running server:

```bash
PUBLIC_ORIGIN=http://localhost:8080 \
SESSION_SECRET='integration-test-secret-0123456789-abcdef' \
npm start

npm run test:integration
```

GitHub CI starts the real server automatically and runs the integration test.
The E2E covers room creation/join, selected modes, same-impostor Round behavior,
Challenge-level balanced mode rotation, mode-matched prompts, prompt secrecy,
reconnect secrecy, 5-second countdown, ACTION, HOLD, public prompt reveal,
untimed discussion, live Host aggregate vote updates after individual votes,
zero-vote rows, stable tally order, absence of voter identities/mappings on the
wire, majority voting, Challenge continuation, Round/Game boundaries,
Round-end aggregate tally, no-points payloads, and Game Over group summary.

There is currently **no lint script** in the repository package scripts.

---

## Project structure

```text
shared/
  types.ts              Wire contract and shared types
  constants.ts          Modes, player limits, Round options, timers

server/
  src/
    auth/session.ts     Anonymous HMAC session identities
    game/
      imitationPrompts.data.ts  Active 30-prompt playtest bank
      questions.data.ts         110 legacy TEXT_PAIR pairs
      questions.ts              Legacy TEXT_PAIR selector
      state.ts                  Internal room/round secret state
      engine.ts                 Pure game rules and transitions
      view.ts                   Per-recipient security projection
      roomManager.ts            Connections, timers, reconnect, broadcasts
    security/messages.ts        Strict runtime WebSocket validation
  test/
    engine.test.ts
    room-manager.test.ts
    view-security.test.ts
    intermediate-result-security.test.ts
    security.test.ts
    integration.mjs             Real server + WebSocket E2E

client/
  src/
    net/socket.ts
    screens/Home.tsx
    screens/Host.tsx
    screens/Player.tsx
    components/Bits.tsx         Shared Result + VoteBoard presentation
```

---

## Deployment environment

| Variable | Requirement |
| --- | --- |
| `NODE_ENV` | Set to `production` in production. |
| `SESSION_SECRET` | Required in production; at least 32 high-entropy bytes and persistent. |
| `PUBLIC_ORIGIN` | Required in production; exact canonical origin. |
| `ALLOWED_ORIGINS` | Optional comma-separated additional exact origins. |
| `PORT`, `HOST` | Optional listener settings; defaults are `8080` and `0.0.0.0`. |
| `TRUST_PROXY` | Configure only for the trusted terminating proxy topology. |

The current architecture is deliberately single-instance and in-memory. A
server restart destroys active rooms; horizontal multi-instance persistence is
not implemented in this version.
