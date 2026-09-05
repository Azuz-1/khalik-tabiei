# Stage D validation evidence

Exact tested Stage D head: `a050b15472ad6f5a532a4f36f42ca17408825b9a`

GitHub CI pull-request run #125 (`33974775119`) and CodeQL run #96 (`33974775057`) both passed on the same Stage D head (GitHub Actions checks the synthetic PR merge commit for the exact head/base pair).

## VERIFIED AUTOMATED

- `npm ci` — passed; install audit reported 0 vulnerabilities.
- `npm run typecheck` — server + client passed.
- `npm test` — 173/173 passed, 0 failed/skipped.
- `npm run build` — client Vite 7.3.6 + compiled server TypeScript passed.
- Client build emitted local Tajawal Arabic and Latin assets at weights 400/500/700/800/900.
- Active imitation prompt audit asserts exactly 330 prompts / 110 per mode, unique normalized text/IDs, family metadata, explicit high-consensus edits, and dormant TEXT_PAIR isolation.
- `npm audit --omit=dev` — 0 vulnerabilities.
- `npm audit` — 0 vulnerabilities.
- Production Docker image built successfully.
- Container inspection verified runtime user `node` and absence of runtime `tsx` / TypeScript packages.
- Container smoke test passed `/healthz` and `/readyz` using compiled JavaScript runtime.
- CodeQL JavaScript/TypeScript analysis passed.

## REAL NETWORK

`npm run test:integration` passed all four real-process / real-WebSocket suites:

- TEAM — `ALL PASSED`.
- INDIVIDUAL — `INDIVIDUAL ALL PASSED`.
- transport hardening — `TRANSPORT ALL PASSED`.
- graceful drain — passed real spawned-server assertions for readiness 503 while liveness stays 200, session rejection, delayed HELLO rejection on a pre-drain upgraded socket, `SERVER_RESTARTING` for new game start, new WebSocket upgrade rejection, and service-restart close code at the drain deadline.

The TEAM integration assertion was intentionally aligned with Stage A's weighted impostor fairness contract: repeat impostors remain possible; tests require authoritative active-player selection rather than deterministic rotation.

## REAL BROWSER

Pinned `@playwright/test@1.62.1` + Chromium ran 3/3 tests successfully:

1. desktop Host + separate mobile Player contexts at 3 / 6 / 10 players, including accessible destructive modal, management ordering, kick and stable seats;
2. Unicode/invisible-name cases, stale confirmations, Player leave, focus restoration and reduced motion;
3. normal readiness plus same-origin Tajawal loading with no Google Fonts request.

Browser failure artifacts remain configured for screenshots/traces/video when a run fails; the final run needed no failure artifact.

## UPSTREAM / STACK RECHECK

Before recording this evidence:

- `main` remained `0aa4bb4a49e9d3189f6f1594d3adb1af62ffb78a`.
- PR #16 remained open and mergeable at `0b1df8b21ff1a59ebbac59dd486b6698cb4ff394`.
- Stage D remained based on tested Stage C head `ad958c0f104c42eac0e138cf43660e6921722d89`.
- PR #20 remained open/mergeable and was not merged or deployed.

## NOT VERIFIED / NOT CLAIMED

- No deployment was performed.
- No production load test was performed; configured socket/room limits are guards, not throughput claims.
- No physical iPhone/Safari hardware pass was performed.
- No subjective TV-speaker / AudioContext listening test was performed.
- Graceful drain reduces admission/race risk but does not persist in-memory rooms across process/container restart.
