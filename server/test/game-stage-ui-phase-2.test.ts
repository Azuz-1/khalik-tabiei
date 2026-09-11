import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("participant chrome is loaded only after display/privacy routing", () => {
  const main = source("../../client/src/main.tsx");
  const displayGuard = main.indexOf('location.pathname.startsWith("/display/")');
  const chromeImport = main.indexOf('import("./components/GameChrome.js")');
  assert.ok(displayGuard >= 0);
  assert.ok(chromeImport > displayGuard, "display route must return before participant GameChrome/socket code is imported");
  assert.ok(main.includes("<GameChrome />"));
});

test("gameplay chrome exposes compact HUD, player details and secondary actions", () => {
  const chrome = source("../../client/src/components/GameChrome.tsx");
  for (const marker of [
    "التحدّي",
    "دور المتخفي",
    "إدارة اللاعبين",
    "نسخ رابط شاشة العرض",
    "إنهاء اللعبة",
    "الخروج من الغرفة",
    "رجع الاتصال ✓",
    ".floating-players",
    ".floating-exit",
  ]) {
    assert.ok(chrome.includes(marker), `GameChrome must keep ${marker}`);
  }
  assert.ok(chrome.includes('dir="auto"'), "mixed Arabic/LTR player names must keep automatic bidi isolation");
  assert.ok(
    chrome.includes('view.room.phase === "RESULT"') && chrome.includes("Math.max(1, view.room.completedChallenges)"),
    "RESULT HUD must keep showing the challenge that just settled instead of jumping ahead",
  );
  assert.ok(chrome.includes('aria-controls="game-options-sheet"'));
  assert.ok(chrome.includes('event.key !== "Escape"'), "game options sheet must support Escape dismissal");
});

test("phase 2 CSS replaces floating controls and the large reconnect banner during gameplay", () => {
  const css = source("../../client/src/game-hud.css");
  assert.ok(css.includes("html.game-hud-active .floating-players"));
  assert.ok(css.includes("html.game-hud-active .floating-exit"));
  assert.ok(css.includes('content: "جاري إعادة الاتصال…"'));
  assert.ok(css.includes("env(safe-area-inset-top)"));
  assert.ok(css.includes("env(safe-area-inset-bottom)"));
  assert.ok(css.includes("max-height: min(72dvh, 660px)"));
});
