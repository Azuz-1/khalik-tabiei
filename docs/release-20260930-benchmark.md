# خلك طبيعي — external benchmark for the 2026-09-30 release review

Research cut-off: 30 September 2026. Sources were retrieved on that date. This is a **simulated expert assessment**, not customer research. No competitor multiplayer sessions, real phones, network measurements, customer interviews, or surveys were performed for this document. Official product pages were read through web retrieval; that is document inspection, not firsthand gameplay testing. Recommendations below are hypotheses to validate against this application.

## Decision summary

The closest useful reference is **Fakin’ It**, because the fun comes from simultaneous physical responses and an uninformed participant trying to blend in. **Netgames Spyfall** is useful for lightweight room joining and secrecy; **Jackbox Push the Button** for the shared-screen/phone division and staged accusations; **Gartic Phone** for anonymous onboarding and a clear multi-stage explanation. **AirConsole** adds relevant mobile connection-state guidance. None demonstrates خلك طبيعي’s latency, stability, enjoyment, or capacity.

Adopt the low-friction browser join pattern, unmistakable private/public screen responsibilities, durable anonymous identity, bounded recovery, authoritative state convergence, and visible action acknowledgement. Adapt onboarding to Saudi Arabic and the actual HANDS/POINT/NUMBER rules. Preserve existing secrecy and turnout-only voting updates until the impostor stint ends; do not introduce a live target tally. Reject architectural migrations, added categories, hidden changes to voting, new AI prompts, and copied scoring based merely on competitor examples.

The release owner verified that deployed/main `70fc5c` has a named owner who is also a player, competitive scoring, and a strict majority of ballots actually cast. The checkout supports 3/6/9/12 challenge totals and size-dependent impostor stints. The supplied release brief's no-points expectation is therefore outdated. Preserve the verified current behavior; no approval is needed to maintain it, and this benchmark recommends no scoring introduction or reversal.

## Evidence labels and limitations

- **O — official claim:** product/support documentation, not an independently verified behavior or quality rating.
- **T — technical primary evidence:** maintained library/platform documentation or source; a reported GitHub issue is identified as a report rather than proof of a current defect.
- **C — community anecdote:** a Reddit individual/comment, no prevalence or consensus inference.
- **I — inference:** application-specific recommendation derived from a source and code inspection.
- **U — unverified:** the cited material does not establish the behavior. No assumption is filled in as a benchmark result.

Recent community feedback was prioritized within 30 September 2025–30 September 2026. Several Reddit direct opens were blocked; the usable material was returned as indexed Reddit excerpts by web search. Dates stated below are the dates shown in those excerpts. This limits context and thread completeness. No quotations, vote-weighted ranking, satisfaction score, or claimed representative Saudi demand is derived from that sample. Older technical examples remain useful as failure hypotheses, with their current applicability explicitly bounded.

## Comparator selection

| Comparator | Why it fits | Boundary |
| --- | --- | --- |
| Fakin’ It / official physical edition | Secret prompt plus physical hands, fingers, and pointing categories [S1] | Physical edition is a mechanics reference, not browser performance evidence. Its 1–10 finger domain and scoring are not this product’s 0–5 rule. |
| Jackbox shared-screen pattern + Push the Button | Phone controllers, host display, staged tests and accusations [S2–S5] | Different mechanics, commercial host application, English content, 4–10 players; advertised audience count is not a server-capacity target. |
| Netgames Spyfall | Browser rooms, private shared knowledge except spy, conversational deduction [S6–S7] | Different question/answer rules; no verified recovery or performance SLA. |
| Gartic Phone | Anonymous entry, nickname, explicit ordered stages, group reveal [S8] | Writing/drawing telephone rather than physical deception; no verified voting/recovery/capacity behavior. |
| AirConsole support | Shared console and phone connection health and mobile interruptions [S9] | Platform support guidance, not a deception-game comparator or reason to require installation. |

## Comparison matrix

U means unknown from the cited sources, not absent or defective. The خلك طبيعي column records inspected code/documentation, **not acceptance-test results**. Main-agent verification supplies actual execution evidence.

| Dimension | Fakin’ It reference | Jackbox / Push the Button | Netgames Spyfall | Gartic Phone | خلك طبيعي: relevance / test |
| --- | --- | --- | --- | --- | --- |
| Onboarding | Secret-task explanation and physical categories [S1] | Host/controller distinction [S2]; optional tutorial controls in other packs [S10] | Step guidance; rules beforehand [S6] | Six numbered play steps [S8] | Explain secret role, same-time action, discussion, and ballot before first challenge; verify novice comprehension. |
| Joining | Physical wallets; browser joining U in S1 | Room code + name; QR prefills code [S2,S3] | Code or direct URL [S6] | Anonymous nickname entry [S8] | Keep QR plus manual 5-character code; distinguish malformed, closed, expired, full, and started rooms. |
| Host/player roles | Everyone uses a secret wallet [S1] | Main screen plus browser controller; hosting device needs controller [S2] | Host creates/shares room [S6] | No separate display established [S8] | Current owner is a named player; shared display is recipient-specific. Never infer host should see private prompts. |
| Mobile usability | Physical reference only | Modern browser features/cookies needed [S2,S4] | Modern-browser devices [S6] | Browser entry; drawing difficulty U [S8] | Native semantic buttons, readable Arabic, large ballot targets, safe-area/keyboard tests; real iPhone/Android required. |
| Pacing | U | Advertised 20-minute game [S5]; extended timers in other packs [S10] | Discussion-based deduction [S7]; measured timing U | Ordered write/draw/describe/reveal [S8] | Inspect automatic timer progression; actual 45-second discussion/15-second ballot must be tested with people, not shortened on intuition. |
| Synchronized actions | Physical actions; browser skew U [S1] | Shared-screen tests [S5]; numeric synchronization guarantees U | No physical same-instant requirement established [S7] | Stage ordering; timing guarantees U | Current server clock samples + monotonic interpolation are relevant. Measure phase skew and resume convergence; never advance from a phone timer. |
| Voting | No browser ballot contract established [S1] | Accusation/ejection [S5]; exact denominator U | Exact web ballot/retry behavior U | Not established / not this comparator’s focus | Preserve cast-ballot majority, ties survive, zero cannot catch; publish only turnout during voting, with tally/reveal at stint end; test late/duplicate ballots. |
| Results | Outcome/scoring described [S1] | Impostor discovery goal [S5]; layout/recovery U | Layout U | End-of-sequence reveal [S8] | Clearly distinguish survived challenge, caught impostor, stint result, and match end; inspect actual scoring contract rather than copying. |
| Recovery | Physical reference only | Refresh guidance; clearing cookies mid-game prevents rejoin [S4] | U | U | Stable signed anonymous identity, bounded retries and fresh authoritative state; permanent room loss must end retries with Arabic recovery. |
| Replayability | Published physical task-bank size [S1]; enjoyment U | Different test categories [S5]; longevity U | Role/location deduction [S7]; retention U | Player-authored transformations [S8]; enjoyment U | Existing 900-prompt bank/history are code evidence; measure repeat frequency across rematches/roster changes, then human novelty and fairness. |
| Performance | U | No measured browser SLA in sources | U | U | Compare baseline/RC under identical profiles; report local feedback separately from authoritative round-trip and propagation. |
| Accessibility | Physical motor/vision demands; usability U | Subtitles/timer/motion options are title-specific [S10] | Conformance U | Conformance U | WCAG target/contrast/keyboard/reduced-motion checks plus physical-mode constraints; no blanket WCAG conformance claim. |
| Practical operating limits | Physical 3–6 [S1] | 4–10 players; advertised 20 minutes [S5] | Spyfall page says 3+; social usability limits described [S6,S7] | Maximum and capacity U [S8] | Code permits 3–10, 500 rooms and 4 connections/UID. These are guardrails, not verified deployment throughput or human usability. |

## Findings, disposition, and validation

| ID / evidence | Observed practice or reported issue; date | Applicability and disposition | Validation for this release |
| --- | --- | --- | --- |
| B01 O→I | Jackbox code/name join; QR prefill [S2 updated 2025-10-28; S3 2022-10-13] | **Adopt** both QR and manual fallback without registration. Keep local code length/alphabet. | First-time independent clients enter via QR URL and typed code; wrong/closed/full cases have one clear action. |
| B02 O→I | Gartic exposes ordered stages before play [S8 undated, retrieved 2026-09-30] | **Adapt** a short Arabic demonstration of role → read → synchronized action → discussion → ballot. Avoid teaching via long mandatory slides. | Novice host/player scripted flow, then human protocol below; role/mode instructions visible without creator help. |
| B03 O→I | Fakin’ It has secret tasks and matching physical categories [S1 2024-11-01] | **Adapt** physical clarity; **reject** adding their two other categories, 1–10 number range, or points merely by analogy. | HANDS both outcomes; POINT single target; NUMBER 0–5 including fist=0; uninformed role understands what to do. |
| B04 O→I | Jackbox separates display and controller [S2]; Netgames host shares room [S6] | **Adapt** responsibilities to the current named-owner and separate-display architecture. | Owner phone can play; shared display reveals no private task/role before reveal; host and impostor wire snapshots checked. |
| B05 O→I | Cookie deletion prevents Jackbox rejoin [S4 2025-10-28] | **Adopt** preservation of anonymous browser identity. **Reject** clearing all storage as routine reconnect advice. | Refresh, navigation and temporary disconnect retain verified UID; corrupted/unavailable storage degrades clearly without takeover. |
| B06 O→I | AirConsole distinguishes weak connection and disconnected state; app switching can disconnect [S9 updated 2026-08-31] | **Adapt** clear connecting/reconnecting/offline states with the current retry policy. **Reject** mandatory app install or same-Wi-Fi assumptions for this browser product. | Background/resume, lock, Wi-Fi/cellular changes on real devices; emulation cannot certify this. Recovery timing measured from actual connectivity restoration. |
| B07 T→I | MDN documents hidden-page timer/animation throttling with browser-specific exceptions [S11 current] | **Adopt** server deadlines plus authoritative resume snapshot; do not assume all WebSockets suspend or remain alive. | Freeze/background a player across each timer phase; return directly to current phase and timer; no local catch-up animation or action replay. |
| B08 T/report→I | y-websocket #139 reports Safari network change without close/error callbacks [S12 2023-06-01; retrieved open] | **Adapt** heartbeat/stale-connection detection independently of close events. This is a failure hypothesis, not proof current Safari/device versions reproduce it. | Suppress traffic without sending close, then restore; confirm detection, cleanup and fresh state; reproduce on actual target OS before attribution. |
| B09 T→I | Socket.IO distinguishes ordered transport from at-most-once delivery and recovery failure [S13,S14 updated 2026-07-21] | **Adapt the semantics**, **reject** library migration without demonstrated need. Current ACK/request IDs and state snapshots are appropriate patterns. | Drop ACK, delay/repeat request, reconnect and stale challenge packets; settle uncertainty without applying old votes or replaying destructive actions. |
| B10 T→I | ws documents ping/pong cleanup, disabled server compression and compression overhead [S15 maintained] | **Adopt** heartbeat and cleanup discipline; keep small gameplay messages uncompressed unless isolated measurements prove a benefit. | Repeated rooms/rematches/disconnects; bounded listeners/timers/socket maps and stable heap trend; adversarial slow reader. |
| B11 T/report→I | ws #2203 reports delayed close cleanup under churn in 8.16.0 [S16 2024-03-05]; current API documents close timeout [S17] | **Adapt** lifecycle verification rather than assuming immediate close or copying an old workaround. Match installed-version behavior first. | Abrupt loss/graceful close/shutdown; watch resources through timeout; no lingering room membership or duplicate events. |
| B12 T→I | OWASP requires explicit Origin allowlist, action authorization, schema/size/rate limits, replay defense, heartbeat/backpressure and sanitized logging [S18 current] | **Adopt** principles; **adapt** payload/rate/connection budgets to anonymous parties sharing an IP. Never treat Origin alone as authentication. | Missing/foreign Origin, forged UID/room/action, oversize/malformed/binary messages, spam, replay and recipient leakage tests; inspect serialized data. |
| B13 T→I | MDN says browser WebSocket lacks automatic backpressure [S19 current] | **Adopt** finite queues/buffers and slow-consumer policy, preserving current authoritative state. | Isolated slow-reader sockets; buffer bounds and explicit safe disconnect; no process memory runaway. |
| B14 T→I | W3C target minimum is 24 CSS px with exceptions; larger targets recommended [S20 current] | **Adopt** minimum checks; **adapt** high-frequency mobile actions toward 44px where layout allows. 44px is a product target, not the cited AA minimum. | Actual rendered hit areas/spacing at 320–430px, 10-player ballot, long names; tap adjacent candidates and confirm/cancel. |
| B15 T→I | W3C normal text contrast 4.5:1, large text 3:1 [S21 current] | **Adopt** checks for actual text/background pairs and all selected/error/pending states. | Computed palette plus rendered screenshots; bright decorative colors do not excuse unreadable copy. |
| B16 T→I | W3C documents disabling nonessential interaction motion [S22 current] | **Adopt** reduced-motion behavior and textual phase/action cues. | Emulate reduced motion; verify essential synchronized cue persists and meaning never depends solely on motion/color/audio. |
| B17 T→I | W3C RTL guidance uses structural direction and isolates mixed-direction text [S23 current] | **Adopt** semantic Arabic RTL and reliable LTR room codes/numbers. | Arabic/Latin mixed and maximum names, codes, timer/results; focus order follows intended reading/interaction sequence. |
| B18 O/T→I | Jackbox has title-specific extended/no timers [S10 2021-09-22]; WCAG timing adjustment has narrow essential/realtime exceptions [S24 current] | **Adapt** accessibility assessment; **reject** silently adding/removing game deadlines or claiming all multiplayer timers exempt. Timing changes need owner approval. | Review each timer purpose; test slow readers; record any unresolved access barrier and proposed approved adjustment. |
| B19 T→I | web.dev good INP ≤200ms at p75 distinguishes browser responsiveness [S25 current] | **Adopt** INP as supplementary measurement. Keep requested local tap ≤100ms, authoritative/phase p95 ≤500ms and recovery ≤5s; these measure different things. | Long-task/paint traces plus authoritative timestamps under declared CPU/network profiles; do not compare local paint with RTT as the same metric. |
| B20 C→I | Sep 2 2026 Reddit author reports slow/not-loading Jackbox [S26] | **Adapt** a connection/load failure test hypothesis. No outage, frequency or cause established. | DNS/WS failure, latency/loss and room expiry; user sees bounded progress/recovery instead of indefinite pending. |
| B21 C→I | Recent Fakin’ It trailer thread excerpt says reactions can expose faker before prompt reveal; localization requested [S27 indexed September 2026] | **Adapt** fairness/reveal and Arabic-copy hypotheses; **reject** content rewriting or different reveal rules without evidence here. | Humans test ordinary/extreme HANDS prompts at 3/5/10; observe reaction leakage and difficulty; protocol tests establish prompt secrecy separately. |
| B22 C→I | Apr18 2026 recommendation reports group preferring Fakin’ It/Quiplash [S28] | **Adapt** lightweight physical-social positioning; a positive single group does not show market fit. | Real groups select rematch voluntarily and explain what entertained them; no fabricated enjoyment metric from scripted bots. |
| B23 C→I | Sep11 2026 preview attendee criticizes repeated card-hover reveal pauses [S29] | **Adapt** pacing inspection: distinguish useful tension/observation from dead waiting. Preview anecdote about another title, not a performance defect here. | Time each phase; humans flag dead waits; preserve physical HOLD needed for observing bodies; any timer change requires approval. |
| B24 C/O→I | Localization thread includes Nov29 2025 comment calling language essential [S30]; Sep9 2026 XL announcement emphasizes cleaner content [S31] | **Adapt** natural Saudi Arabic and family suitability audits; neither proves demand or licenses copying prompts. | Arabic comprehension/content review with real families; prompts answerable across age/familiarity, no imported adult-material expectation. |
| B25 O→I | Netgames makes prior-room suggestions and notes privacy exceptions [S6] | **Reject** automatic discovery of acquaintances/rooms in this release. Anonymous continuity should not silently expose rooms. | Join limited to authorized code/link and current membership; concurrent rooms and reconnect identities remain isolated. |
| B26 T→I | WebKit #298616 reported iOS 26 handshake trouble then records framework fixed in 26.1 [S32 Sep–Nov 2025] | **Reject** attribution of current errors to that resolved bug. **Adopt** version-specific Safari coverage; investigate a fresh reproduction independently. | Record exact OS/browser versions and server handshake evidence; no recommendation to disable QUIC globally from this historical report. |

## Implications for the existing release

Source inspection found `shared/constants.ts` defines 3–10 players, challenge choices 3/6/9/12, NUMBER 0–5, 500 active-room guardrail and four connections per UID. `docs/transport-request-semantics.md` already describes bounded ACK reuse and no automatic mutation replay. `server/src/game/view.ts` publishes only submitted/total progress during voting and withholds result tallies until the reveal. The release owner's source and production verification takes precedence over the stale live-vote-board wording found in `docs/transport-hardening.md`; that documentation must be corrected, not used to introduce a live tally. `client/src/net/clock.ts` uses bounded RTT samples and a monotonic anchor. `docs/prompt-audit.md` records 900 active prompts. Those facts support targeted verification; none proves the release passes.

A live target tally could influence subsequent voters and reveal target preferences through timing even without voter-target mappings. The verified current product avoids that behavior: all recipients receive turnout-only updates during voting, and tallies/reveal appear at the end of the impostor stint. Preserve this contract and verify it at the serialized wire boundary for owner, display, impostor, ordinary player and reconnecting clients. Maintaining this existing behavior is within the release task's scope. Human playtests should examine clarity and fairness under the current ballot rules, with no scoring or voting redesign introduced by the benchmark.

Do not infer abandonment causes from host closure, causal retention from trial analytics, or unlimited service throughput from room/player constants. Competitor advertised player limits and audience sizes describe product configurations, not verified Render capacity. Capacity evidence must come from isolated local/staging measurements under the actual server build and declared resource/profile conditions.

## Human market playtest protocol (proposed, not executed)

Recruit at least six independent Saudi groups: two first-time family groups, two casual friend groups, and two experienced social-game groups. Include 3–4, 5–6, and 8–10-person configurations; an age/familiarity spread; iPhone Safari and Android Chrome including an older phone; Wi-Fi and cellular. Do not seed real-player names/prompts/vote mappings into production analytics.

1. Give only the normal entry link and in-product instructions. Observe whether the host starts, phones join, and everyone identifies their responsibility without creator explanation. Record time and assistance events, not an invented benchmark threshold.
2. Complete a short game with all modes and at least two rematches. Record wrong physical actions, accidental ballot selections, unclear majority/results, dead waits and misunderstanding of the uninformed role.
3. With consent, interrupt one phone via app switch/lock, refresh another, and change one network. Record visible status, recovery time, lost agency and whether the group can continue; do not run disruptive load on production.
4. Ask independently: what happened, how did voting work, what felt slow/confusing, and whether they want another game. Record exact volunteered feedback with consent; do not invent quotations or equate politeness with retention.
5. Inspect prompt repeat/novelty and cultural fairness across rematches. Track role difficulty by group size descriptively; small samples do not support significance claims or automatic rule changes.

Human validation remains necessary for fun, group dynamics, physical accessibility, prompt fairness, social reaction leakage, comfortable pacing, and real mobile interruption behavior. Automated persona sessions can test flows and failure handling; they cannot answer those questions.

## Source register

All retrieved 2026-09-30. “Current” below means consulted current official/maintained documentation; where no publication date is shown, no date is invented.

- **S1 O** — Jackbox, *Who’s Lying to You? Play the Fakin’ It Board Game and Find Out!*, 2024-11-01. https://www.jackboxgames.com/blog/Fakin-It-Board-Game
- **S2 O** — Jackbox support, *How do I join a game?*, updated 2025-10-28. https://support.jackboxgames.com/hc/en-us/articles/15794759479959-How-do-I-join-a-game
- **S3 O** — Jackbox, *How to Play The Jackbox Party Pack 9 Remotely*, 2022-10-13 (date confirmed on the retrieved official article). https://www.jackboxgames.com/blog/how-to-play-party-pack-nine-remotely
- **S4 O** — Jackbox support, connection troubleshooting, updated 2025-10-28. https://support.jackboxgames.com/hc/en-us/articles/15794785923223-I-m-having-trouble-connecting-my-device-to-the-game
- **S5 O** — Jackbox, *Push the Button*, current product page (game released 2019). https://www.jackboxgames.com/games/push-the-button
- **S6 O** — Netgames, *Help*, undated. https://netgames.io/help
- **S7 O** — Netgames, *Spyfall*, undated. https://netgames.io/games/spyfall/
- **S8 O** — Gartic Phone, current entry/how-to-play page, undated. https://garticphone.com/
- **S9 O** — AirConsole support, *Disconnects*, updated 2026-08-31. https://airconsole.zendesk.com/hc/en-us/articles/360014580319-Disconnects
- **S10 O** — Jackbox, Party Pack 8 streaming/moderation/accessibility, 2021-09-22. https://www.jackboxgames.com/blog/streaming-moderation-accessibility-features-jackbox-party-pack-eight
- **S11 T** — MDN, *Page Visibility API*, current. https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- **S12 T/report** — yjs/y-websocket issue 139, opened 2023-06-01, shown open at retrieval; reporter’s experience, not a current-browser guarantee. https://github.com/yjs/y-websocket/issues/139
- **S13 T** — Socket.IO 4.x, *Delivery guarantees*, updated 2026-07-21. https://socket.io/docs/v4/delivery-guarantees/
- **S14 T** — Socket.IO 4.x, *Connection state recovery*, updated 2026-07-21. https://socket.io/docs/v4/connection-state-recovery/
- **S15 T** — websockets/ws maintained README, current. https://github.com/websockets/ws
- **S16 T/report** — websockets/ws issue 2203, opened 2024-03-05, closed at retrieval; issue body references ws 8.16.0. https://github.com/websockets/ws/issues/2203
- **S17 T** — websockets/ws maintained API docs, current master; verify installed-version support before use. https://github.com/websockets/ws/blob/master/doc/ws.md
- **S18 T** — OWASP WebSocket Security Cheat Sheet, current, publication date not shown. https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
- **S19 T** — MDN, *WebSocket*, current. https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- **S20 T** — W3C WCAG 2.2 understanding 2.5.8 target minimum, current. https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- **S21 T** — W3C WCAG 2.2 understanding 1.4.3 contrast, current. https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- **S22 T** — W3C WCAG 2.2 understanding 2.3.3 animation from interactions, current. https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- **S23 T** — W3C Internationalization, structural markup/RTL in HTML, current. https://www.w3.org/International/questions/qa-html-dir
- **S24 T** — W3C WCAG 2.2 understanding 2.2.1 timing adjustable, current. https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html
- **S25 T** — web.dev, *Interaction to Next Paint*, current. https://web.dev/articles/inp
- **S26 C / indexed excerpt** — Reddit, *Anyone else having issues with connecting?*, 2026-09-02. https://www.reddit.com/r/jackboxgames/comments/1w5g8bx/anyone_else_having_issues_with_connecting/
- **S27 C / indexed excerpt** — Reddit, *Fakin’ It XL Official Trailer Wishlist Now*, indexed September 2026, exact post/comment date not retrieved. https://www.reddit.com/r/jackboxgames/comments/1wbrkll/fakin_it_xl_official_trailer_wishlist_now/
- **S28 C / indexed excerpt** — Reddit, *Need a Jack Box Recomendation*, 2026-04-18. https://www.reddit.com/r/jackboxgames/comments/1somlur/need_a_jack_box_recomendation/
- **S29 C / indexed excerpt** — Reddit, *Random thoughts on the games they showcased at PAX*, 2026-09-11. https://www.reddit.com/r/jackboxgames/comments/1wd5idd/random_thoughts_on_the_games_they_showcased_at_pax/
- **S30 C / indexed excerpt** — Reddit, English-only localization discussion, indexed comment 2025-11-29; thread created earlier. https://www.reddit.com/r/jackboxgames/comments/1o8atwk/is_jackbox_party_pack_11_really_going_to_be/
- **S31 O** — Jackbox, XL announcement, 2026-09-09. At research cut-off the announced November 12 release is future, not tested/shipped evidence. https://www.jackboxgames.com/blog/fakin-it-xl-is-coming-november-12th-to-a-bundle-near-you
- **S32 T** — WebKit bug 298616, reported 2025-09-09, resolved framework fix in 26.1 confirmed 2025-11-05. https://bugs.webkit.org/show_bug.cgi?id=298616

## Research completeness and release ownership

This benchmark provides documented product practices, recent community hypotheses and primary implementation guidance. It deliberately leaves unsupported comparator cells unverified. Recent Reddit coverage was usable for enjoyment preference, connection frustration, pacing, physical reaction leakage and localization; no reliable recent complete-thread replayability or quantified mobile-stability sample was established. Prompt novelty and recovery must therefore be tested locally and with humans rather than described as externally benchmarked facts.

No application source, rule, commit, deployment, or production infrastructure was changed by this benchmark work. The main release report must map actual changes/tests to these hypotheses and distinguish adopted existing practices from newly implemented fixes.
