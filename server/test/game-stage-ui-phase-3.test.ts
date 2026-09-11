import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("player challenge states use the game-stage hierarchy instead of prompt cards", () => {
  const player = source("../../client/src/screens/Player.tsx");
  assert.ok(player.includes('className="screen player-stage-screen"'));
  assert.ok(player.includes('className="player-stage-main"'));
  assert.ok(player.includes('className="player-stage-prompt"'));
  assert.ok(player.includes('className="player-stage-dock"'));
  assert.ok(player.includes("طالعوا بعض"), "the five-second look-around beat must remain intact");
  assert.ok(!player.includes('className="q-card stack"'), "challenge/discussion should not regress to boxed prompt cards");
});

test("voting is compact, confirms explicitly, and becomes a waiting state after submit", () => {
  const player = source("../../client/src/screens/Player.tsx");
  for (const marker of [
    "stage-vote-grid",
    "stage-vote-option",
    "stage-vote-dock",
    "تأكيد التصويت",
    "تم تسجيل صوتك",
    "بانتظار الباقين…",
    "actions.submitVote(picked)",
  ]) {
    assert.ok(player.includes(marker), `Player voting must keep ${marker}`);
  }
  assert.ok(player.includes('dir="auto"'), "mixed Arabic/LTR player names must keep bidi-safe rendering");
});

test("phase 3 stage CSS keeps gameplay viewport-sized and limits scrolling to the voting stage", () => {
  const css = source("../../client/src/game-stage.css");
  const main = source("../../client/src/main.tsx");
  assert.ok(main.includes('import "./game-stage.css"'));
  assert.ok(css.includes("height: 100dvh"));
  assert.ok(css.includes("overflow: hidden"));
  assert.ok(css.includes("overflow-y: auto"));
  assert.ok(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"));
  assert.ok(css.includes("env(safe-area-inset-bottom)"));
  assert.ok(css.includes("text-overflow: ellipsis"));
});

test("phase 3 styles load after the HUD so gameplay stage rules win the cascade", () => {
  const main = source("../../client/src/main.tsx");
  const hudImport = main.indexOf('import "./game-hud.css"');
  const playerStageImport = main.indexOf('import "./game-stage.css"');
  const hostStageImport = main.indexOf('import "./game-stage-host.css"');
  assert.ok(hudImport >= 0);
  assert.ok(playerStageImport > hudImport, "player stage CSS must load after the gameplay HUD");
  assert.ok(hostStageImport > playerStageImport, "host stage polish must load after the shared player stage CSS");
});

test("host challenge and voting keep the same logic while dropping the dashboard-card look", () => {
  const host = source("../../client/src/screens/Host.tsx");
  const css = source("../../client/src/game-stage-host.css");
  assert.ok(host.includes("function HostPromptReveal"));
  assert.ok(host.includes("function HostDiscussion"));
  assert.ok(host.includes("function HostVoting"));
  assert.ok(host.includes("<PhaseCountdown endsAt={view.room.phaseEndsAt}"), "phase 3 must not remove authoritative gameplay timers");
  assert.ok(host.includes("الأصوات مخفية للحين"), "vote privacy copy must remain intact");
  assert.ok(css.includes(".host-voting-stage .card"));
  assert.ok(css.includes("background: transparent"));
  assert.ok(css.includes("border-top: 1px solid"));
  assert.ok(css.includes("@media (max-height: 720px)"), "host stage must keep a compact treatment for short screens");
});
