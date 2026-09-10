import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Home exposes an optional suggestion surface with privacy guidance", async () => {
  const home = await readFile(new URL("../../client/src/screens/Home.tsx", import.meta.url), "utf8");

  assert.ok(home.includes("عندك فكرة أو ملاحظة؟"));
  assert.ok(home.includes("/api/suggestions"));
  assert.ok(home.includes("maxLength={600}"));
  assert.ok(home.includes("لا تكتب اسمك أو رقمك أو إيميلك"));
  assert.ok(home.includes("بدون أسماء أو أكواد غرف أو معرفة مين صوّت لمين"));
  assert.ok(home.includes('{ id: "modes", label: "طرق اللعب" }'));
});
