# Transport and ballot investigation — 2026-09-30

Assessment: simulated transport, frontend, gameplay-integrity and protocol specialist review. These are independent AI review roles, not claims of external human review. Baseline: `70fc5c47`, candidate branch: `release/rc-investigation-20260930`. No deployment, push or commit was performed by this specialist.

## Verified findings

| Finding | Baseline reproduction | Candidate behavior |
| --- | --- | --- |
| A fresh request ID could carry an old challenge's vote into a later challenge | Manager accepted a ballot with a mismatched challenge context; current votes increased from zero to one | Per-challenge UUID checked before mutation; stale ballot gets `VOTE_IGNORED / STALE_CHALLENGE`, current STATE, and correlated ACK without entering the tally |
| Deadline enforcement depended solely on the timer callback running | Injected server clock at `phaseEndsAt`; ballot accepted while callback was still pending | Server checks its clock before vote mutation, seals missing ballots as abstentions, and reports a late unrecorded vote explicitly |
| Same-target duplicates generated `VOTE_ALREADY_SUBMITTED`; phase-changing exact-request retries could generate `BAD_REQUEST` | Second request for the same ballot failed; request cache included phase | Same context/target is idempotent across voting and settlement. Changed-target attempts still fail. Cache includes UUID challenge context, match generation and stint/challenge indices |
| Foreground OPEN sockets with lost traffic had no watchdog recovery | Mocked 30 seconds without inbound traffic; socket never closed and remained usable for sends | 25-second stale threshold checked by the 10-second heartbeat; current socket is detached and retried without requiring its close handshake to finish |
| Offline/connect/HELLO failure could depend on `onclose` arriving | Browser harness intentionally never delivered `onclose` | Offline immediately disables sends. Connect and HELLO timeout handlers independently recover and retry. Superseded callbacks cannot authenticate or overwrite a newer socket |
| Named owners could not repeat a JOIN to their own room | Named CREATE followed by same-room JOIN produced `ALREADY_IN_ROOM` | Existing owner/player seat reconnects idempotently, preserving exactly one seat; external legacy display-host identities remain ineligible |
| Reconnect without surviving membership silently returned an existing participant to Home | `HELLO_OK` cleared the cached room view without explaining the transition | Accurate Arabic notice explains room/membership unavailability and offers fresh room creation or a new join code. Deliberate Leave/Close remains quiet across interrupted transport; explicit room closure also explains recovery |

The original five server regression assertions were run before implementation: all five failed with the expected baseline behavior. The candidate's browser runtime tests were also run against the untouched baseline `socket.ts` using `SOCKET_REPRO_MODULE`; both then-existing tests failed: no heartbeat recovery and stale displayed-context vote incorrectly sent. These are controlled reproductions, not proof that each mechanism caused a particular production session's reported error.

## Scope and preserved rules

The UUID is created with each authoritative challenge, survives reconnect, and rotates on redeal even when visible indices repeat. Only connected, eligible participant VOTING projections receive it. External hosts, spectators, preparation phases and result views do not. It conveys no role, prompt, voter choice or live target totals; membership authentication remains separate.

Only authenticated, eligible members receive benign stale/closed classification. Unknown members, disconnected/ineligible players, self-votes, invalid targets, changed ballots and invalid early phases remain genuine failures. Ignored late votes do not emit `game_error`; they send an explicit `VOTE_IGNORED` outcome, so the UI does not claim the ballot was recorded. Exact duplicate votes do not change points, turnout or settlement count.

Client submissions include the context captured by their displayed vote UI. The transport checks that it still matches current state, checks the synchronized deadline, and prevents pending repeats. Voting controls expose pending/offline state. The vote component is keyed by context, resetting selection even when a reconnect skips intermediate phases. Mutating actions are never automatically replayed after disconnect.

No minimum-player count, game mode, impostor selection rule, majority denominator, score rule, result privacy or owner-transfer rule changed.

## Join evidence and limits

No general production JOIN-message loss was demonstrated. An action attempted while offline is deliberately rejected locally, and pending mutations are not automatically replayed; this can explain an absent server join event but is not evidence of server data loss. The named-owner repeated-JOIN inconsistency above is verified and fixed. Missing analytics rows require the separate telemetry delivery investigation. Room state remains process-local: these changes recover surviving sessions, not rooms lost during a server restart.

When reconnect authenticates successfully but no longer restores membership, the previous room view is removed and the user gets an explanation without assuming a crash, restart or expiry cause. Pending actions for a definitively ended membership are cleared; no old vote or JOIN is retried. Explicit room closure and kicked-member frames clear obsolete pending actions too. A stale code's `ROOM_NOT_FOUND` remains a Home error and the user can still create a new room. Intentional exit tracking survives a transport interruption and is reset by authoritative membership recovery or an explicit rejected exit.

Heartbeat timing is best effort in throttled/suspended browser tabs. Returning to a visible tab also retains the existing stale-connection recovery path. A genuinely unreachable server remains offline and continues retrying; the client cannot guarantee connectivity or recreate deleted rooms.

## Wire compatibility and rollout

Wire validation accepts a missing optional context only so RoomManager can return `CLIENT_UPDATE_REQUIRED` rather than a generic malformed-frame response. A present context has an exact bounded string shape. All environments enforce the same gameplay requirement; there is no production-only security branch.

Deploy matching client/server artifacts together. Cached pre-release tabs cannot submit a context and must refresh before voting. The new client includes Arabic refresh guidance for `CLIENT_UPDATE_REQUIRED`. An already-cached old bundle cannot gain that new translation and shows its existing generic error fallback; do not describe it as already displaying actionable refresh guidance. This is an intentional compatibility cost of rejecting unscoped ballots. Rollback requires the matching older client and server together.

## Verification

- `server/test/vote-context-recovery.test.ts`: 10 passing runtime regressions covering fresh-ID stale ballots, idempotent duplicate versus changed target, delayed deadline callback, owner rejoin, bounded wire shape, serialized recipient restrictions, missing-context upgrade error, invalid membership, reconnect continuity, settlement retries and redeal rotation.
- `server/test/client-socket-recovery.test.ts`: 5 passing mocked-browser runtime regressions covering OPEN blackholes, no-close-handshake recovery, stale/expired displayed UI, pending repeats, immediate offline behavior, connect/HELLO deadlines, superseded frames, vanished membership with a recovery notice, intentional interrupted exit, explicit closure, stale-code errors and successful fresh create requests.
- All 18 ordinary manager-vote fixture suites migrated through explicit `submitVoteWithContext` forwarding passed when run independently; the helper adds the current authoritative fixture context without bypassing production rules. Malformed/stale-specific tests remain explicit.
- `npm run typecheck`: server and client passed after these changes.
- `server/test/game-stage-ui-phase-3.test.ts`: 5 passed with the context-forwarding/pending source contract updated.

Full-suite and real-browser acceptance results are owned by the lead agent's final report. Mocked-browser tests are deterministic failure injection, not a claim of physical Safari/iPhone validation or a real network partition test.
