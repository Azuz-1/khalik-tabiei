# Runtime investigation — 2026-09-30 candidate

## Evidence and attribution boundary

Baseline reviewed: `70fc5c47` on the existing repository, candidate branch `release/rc-investigation-20260930`.

The supplied historical telemetry contains two `client_error` events on 2026-09-25 at 23:55:17 and 23:55:31 Saudi time, associated with release SHA `3e630aa8db0fa5568b077937ccb5b6351a4fb2cb`. Both were `kind=runtime`, `routeBucket=home`, `online=true`. There was no error class, message, stack, source coordinate, or component identifier in those records. They establish that browser runtime errors occurred, but do not identify their cause. In particular, the home route can also contain an active room; it does not prove the Home component threw. Candidate fixes below must not be represented as a confirmed reproduction or diagnosis of these historical events.

The lead agent additionally inspected Render logs for 20:50–21:05 UTC covering those event times. The returned window contained startup at 20:52:18 UTC and no exception record. The absence of a server log exception does not identify the cause of a client runtime error.

## Simulated expert assessment

These are simulated engineering assessment lenses, not independent human expert reviews.

- Runtime/lifecycle review: App toast, connection delay, confirm timeout, recovery interval, and player-manager focus timeout all have cleanup. Home has no polling or DOM listeners. Home audio unlock catches failures internally; deep-link parsing is synchronous; name validation uses a Segmenter fallback. Home suggestion dialog registers a focus timer and restores inert state/body overflow on teardown. Suggestion fetch catches rejection and clears its deadline. Modal document keydown listeners have removal in their effect cleanup. No specific historical crash was reproduced by this review.
- Compatibility review: telemetry previously called `crypto.randomUUID()` again from its catch block. On a browser without that API, or an insecure context where it is unavailable, both calls throw during module initialization and can prevent the whole application from booting. This is an independently identified compatibility defect, not established as the production event cause. It now falls back to `crypto.getRandomValues()` and generates a v4-format session UUID. If cryptographic APIs are inaccessible, a page-local non-security random label permits telemetry to remain optional. Storage denial is caught. No persistent identity is introduced.
- Diagnostics/privacy review: old telemetry discarded all diagnostic attribution. New error reports retain canonical error class, surface/phase, entry bundle basename, and same-origin hashed source chunk basename plus bounded line/column. No raw error message, stack, component stack, URL, query, pathname, room code, player name, prompt text, or vote mapping is collected. Server ingestion independently constrains diagnostic enum values and hashed asset formats; unknown keys remain excluded by the analytics allowlist. At most ten errors are queued per page.
- Recovery review: main now has a small React error boundary and explicit root-import rejection handling. Render failures show Arabic recovery text and a reload button rather than an empty root. Reload preserves the existing signed-session/rejoin flow; it does not clear room/session identity. This catches render/lifecycle failures, while browser error/rejection listeners continue to observe asynchronous and event-handler failures. Failures of the initial entry script download or the telemetry module before React loads remain outside that boundary.

## Regression verification

- Targeted Node telemetry tests: `node --import tsx --test server/test/client-error-diagnostics.test.ts server/test/client-telemetry.test.ts server/test/client-telemetry-source.test.ts server/test/client-telemetry-runtime.test.ts` passed. The isolated VM tests execute the real compiled telemetry module and actual event handler, rather than matching implementation source text.
- `npm run typecheck --workspace client` passed.
- The new pure diagnostic tests prove canonical class handling (including a throwing `name` getter), same-origin hashed chunk extraction, stripping query/fragment and private paths, coordinate bounds, and server-side rejection of arbitrary diagnostic values. They also pass private message/stack/player/code/prompt/vote fields through the ingestor and verify that none survives.
- `browser-tests/runtime-diagnostics.spec.mjs`: all four checks passed in 26.8 seconds on Chromium `145.0.7632.6` with Playwright `1.58.2`, executing the production build on a temporary loopback server. These cover denied session storage plus missing `randomUUID`, injected render failure plus reload recovery, denied participant-chunk import plus startup recovery, and bounded runtime diagnostic privacy. These are controlled fault simulations, not historical production reproductions. JSON evidence: `evidence/runtime-browser.json` in the session workspace outside the repository. Video was disabled because the environment lacked the runner's ffmpeg asset. This does not establish actual Safari or iOS compatibility.

## Reproduction steps

For the independently confirmed initialization defect in the old version, override `Crypto.prototype.randomUUID` to `undefined` before entry script execution, then deny `sessionStorage` with a throwing getter. Importing old telemetry falls into its catch and calls the same unavailable API again. The candidate browser regression performs exactly this compatibility simulation and expects Home to boot with a valid page-session UUID.

For recovery, load Home normally, replace `Intl.Segmenter` with a constructor that throws a private-message TypeError, then click the create-room entry button. The name screen throws during render; the candidate boundary must display the Arabic recovery view and a `kind=react,errorClass=TypeError` telemetry event without the private message. Reload removes this injected runtime override and restores Home.

## Operational limitations and next evidence

New diagnostics identify the built entry/source assets without a release API lookup. Archive the deployed build alongside its exact Git SHA so bundle/line/column can be matched to the correct release. No source maps or raw stacks are uploaded by this patch. Promise and React errors retain only class and bundle context because parsing their raw stack would introduce a privacy risk. Capture of an error does not ensure delivery: telemetry is best effort, authenticated, capped, and can be lost on sudden tab/process termination or before authentication. The historical two events remain unresolved until the affected archived release or an independently matching reproduction is available.
