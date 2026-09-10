import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Home keeps rules in the primary flow and suggestions in a secondary dialog", async () => {
  const home = await readFile(new URL("../../client/src/screens/Home.tsx", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../../client/src/components/SuggestionDialog.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../../client/src/home-suggestion-dialog.css", import.meta.url), "utf8");

  assert.ok(home.includes("<RulesTabs />"));
  assert.ok(home.includes('className="btn btn-ghost suggestion-trigger"'));
  assert.ok(home.includes("💡 اقتراح"));
  assert.ok(home.includes("<SuggestionDialog"));
  assert.ok(!home.includes("<SuggestionCard"));
  assert.ok(home.indexOf("<RulesTabs />") < home.indexOf("<SuggestionDialog"));

  assert.ok(dialog.includes("عندك فكرة أو ملاحظة؟"));
  assert.ok(dialog.includes("/api/suggestions"));
  assert.ok(dialog.includes("maxLength={600}"));
  assert.ok(dialog.includes("لا تكتب اسمك أو رقمك أو إيميلك"));
  assert.ok(dialog.includes("بدون أسماء أو أكواد غرف أو معرفة مين صوّت لمين"));
  assert.ok(dialog.includes('role="dialog"'));
  assert.ok(dialog.includes('aria-modal="true"'));
  assert.ok(dialog.includes('background?.setAttribute("inert", "")'));
  assert.ok(dialog.includes('event.key === "Escape"'));

  assert.ok(styles.includes(".suggestion-trigger"));
  assert.ok(styles.includes("position: fixed"));
  assert.ok(styles.includes("left: calc(14px + env(safe-area-inset-left))"));
  assert.ok(styles.includes(".suggestion-backdrop"));
  assert.ok(styles.includes("@media (max-width: 620px)"));
  assert.ok(home.includes('{ id: "modes", label: "طرق اللعب" }'));
});
