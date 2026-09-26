# خلك طبيعي — UI design system

Presentation layer only. Game rules, timers, secrecy and scoring stay
server-authoritative; nothing below recreates a rule in React.

## Principles

- **The moment owns the screen.** Each state has one dominant element
  (the prompt, the countdown number, the action word, the reveal). Progress,
  room management and help recede.
- **Rule of light.** Glow is part of the identity but belongs to what matters
  now: the countdown number, the selected vote, the result reveal, the primary
  action. Nothing else glows.
- **Phone = private and tactile. TV = public and theatrical.** The TV is a
  stage sized from the viewport height (`--tv-*` tokens), not an enlarged phone.
- **Role-neutral light.** A normal prompt and the impostor reveal share the same
  light envelope so neighbours can't read a role from screen glow. The
  impostor's magenta appears only in small type/iconography.
- **Arabic first.** RTL composition, numbers isolated with `.num-ltr` /
  `dir="ltr"`, names rendered with `dir="auto"`, Western digits throughout.

## Tokens (`client/src/styles/tokens.css`)

| Group | Tokens |
| --- | --- |
| Canvas | `--canvas`, `--canvas-raised`, `--stage`, `--stage-light*` |
| Surfaces | `--surface`, `--surface-quiet`, `--surface-elevated(-2)`, `--surface-selected`, `--surface-sunken`, `--scrim` |
| Ink | `--ink-strong`, `--ink`, `--ink-muted`, `--ink-subtle`, `--ink-disabled`, `--ink-accent`, `--ink-impostor` (all text steps ≥ 4.5:1 on canvas) |
| Actions | `--action-primary(-deep/-hover/-pressed)`, `--action-danger-fill(-hover)`, `--action-secondary(-edge)`, `--action-danger(-ink/-tint)`. Every fill under `--ink-on-action` text is ≥ 4.5:1 (checked by `server/test/ui-contrast.test.ts`). |
| Status | `--success`, `--warning`, `--danger`, `--impostor` (+ `-tint`) |
| Edges / focus | `--edge-subtle`, `--edge`, `--edge-strong`, `--edge-selected`, `--focus-ring` |
| Light | `--glow-primary`, `--glow-selected`, `--glow-result`, `--glow-text(-strong)` |
| People | `--person-1` … `--person-10`: a colour slot, not a seat (see People below) |
| Scale | `--space-1…10`, `--radius-xs…xl/pill`, `--control-sm/md/lg`, `--touch-min` (44px) |
| Type | phone `--text-meta…--text-display`; TV `--tv-meta…--tv-display` (vh-based) |
| Motion | `--dur-instant…--dur-stage`, `--ease-out/spring/in-out`; all motion collapses under `prefers-reduced-motion` |
| Layout | `--phone-gutter`, `--content-phone`, `--content-wide`, `--hud-height`, `--tv-margin-x/y` |

Legacy variable names (`--violet-2`, `--muted`, `--card`, …) alias the semantic
tokens so older selectors resolve to the system.

## Components

- Buttons: `.btn` + `.btn-primary` (one per screen), `.btn-secondary`,
  `.btn-quiet`, `.btn-danger` (confirm dialogs only), `.btn-danger-quiet`,
  `.icon-btn`, `.link-btn`; sizes `.btn-sm` / `.btn-md` / default 58px.
- Sheets & dialogs: `.sheet-backdrop` + `.sheet-panel` (bottom sheet on phones,
  centred dialog ≥ 640px). Focus moves in, Tab is trapped, Escape closes, and
  focus returns to the opener (`ui/useModalFocus.ts`; `ConfirmDialog` and
  `SuggestionDialog` keep their own focus handling). Every modal, including
  the room-closed notice, locks its background with `ui/inert.ts`: it walks
  from the modal up to `<body>` and marks every sibling layer `inert` +
  `aria-hidden` (app content, the gameplay HUD, the privacy link and
  body-level portals, not just `[data-app-content]`). Locks are
  reference-counted, so a confirm opened over a sheet releases only its own
  lock.
- People: `ui/Avatar.tsx` shows a monogram (skipping the definite article «ال»)
  in a colour slot from `colorSlotLookup()`. The slot is the player's position
  in the server's current player list: identical on every phone and the TV at
  any moment, and unique for up to ten players. When someone leaves, the
  players after them move up a slot, so their colour changes. Colour is
  therefore supplementary and always shown next to the name. Phones receive
  an opaque hashed `seatNumber` while the TV gets a room-local 1…n, so no seat
  value is shared across screens. A colour that survives departures would need
  a stable shared slot from the server.
- Roster: `.chip` shows avatar, name, «(أنت)», «مالك الغرفة» and a spelled-out
  «منقطع» state. The numeric `.seat-badge` stays in the DOM for tooling and
  tests but is `hidden`, because on phones it is an opaque 6-digit id.
- Progress: `ui/Meters.tsx`.
  - Match progress «التحدّي 4 من 9» → continuous segmented rail.
  - Impostor stint «دور المتخفي 2 من 3» → discrete magenta pips, only when the
    server sends `challenge.index/max`.
  - Scoring (+1/+2/+3) → green delta chips in results only.
  These three never share a shape.
- `SlotMeter`: anonymous fill slots for readiness and ballot turnout. The server
  exposes counts only, so no names are shown.
- `ui/StageTimer.tsx`: renders the server's `phaseEndsAt`. Calm lavender →
  amber in the warning window → coral for the final seconds, never flashing.
  Short cue beats (hold) stay calm.
- Results (`components/Bits.tsx`): `ResultBody` (anonymous light survival vs.
  full reveal), `Scoreboard`, `MyScoreCallout`, `VoteBoard` (settled aggregate
  only), `Winners`, `GameOverStats`.
- TV stage (`components/TvStage.tsx`): shared by `/display` and the legacy host
  screen. It must never import the participant socket or call actions.

## Phone flow

Privacy curtain («هذي الشاشة لك بس» → «اعرض دوري», identical for every role)
→ prompt / impostor reveal → «جاهز» → countdown → action → «طالعوا بعض» → prompt
reveal → discussion (question first, prompt as context) → vote (tap to select,
then confirm in the dock, «تراجع» to clear) → voted → result → next.

The curtain is presentation only; server projection remains the security
boundary. Its state lives in the private screen component (`ui/privacyCurtain.ts`),
never in a module-level cache, so every fresh entry into QUESTION starts
covered, including the first deal after a rematch, where the room code and
every match counter repeat. While mounted, it re-covers when the observable
private deal changes, when readiness drops (a role-blind redeal), or when the
phone reconnects. The owner phone swaps to management surfaces only in LOBBY / RESULT /
GAME_OVER, as before.

## Missing server data (not inferred on the client)

- **Per-player readiness / ballot presence.** Only `readyProgress` and
  `votesProgress` counts are exposed, so the TV shows anonymous slots rather
  than checkmarks next to names.
