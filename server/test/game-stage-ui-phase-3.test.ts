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
