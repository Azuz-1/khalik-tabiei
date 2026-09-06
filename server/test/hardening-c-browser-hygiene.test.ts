import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const browserTestsDir = new URL("../../browser-tests/", import.meta.url);

function specs(): Array<{ name: string; source: string }> {
  return readdirSync(browserTestsDir)
    .filter((name) => name.endsWith(".spec.mjs"))
    .map((name) => ({
      name,
      source: readFileSync(new URL(name, browserTestsDir), "utf8"),
    }));
}

test("browser specs never use fixed sleeps for phase correctness", () => {
  const files = specs();
  assert.ok(files.length > 0, "expected browser specs to exist");
  for (const { name, source } of files) {
    assert.ok(
      !source.includes("waitForTimeout"),
      `${name} must wait on observable state, not a fixed sleep`,
    );
    assert.ok(
      !/setTimeout\s*\(\s*(?:resolve|r)\b/.test(source),
      `${name} must not hand-roll a sleep promise`,
    );
  }
});

test("a real full-game browser journey exists and drives production phases", () => {
  const journey = specs().find((file) => file.name.includes("journey"));
  assert.ok(journey, "a full-game browser journey spec must exist");

  // The journey has to exercise the real end-to-end path, not a shortcut: a
  // genuine offline/online round trip, a Host kick, a configured TEAM match,
  // per-round impostor discovery, and an authoritative GAME_OVER.
  for (const marker of [
    "setOffline(true)",
    "setOffline(false)",
    "إخراج",
    "ابدأ اللعبة",
    "identifyRoles",
    "ابدأ التصويت",
    "خلصت اللعبة",
  ]) {
    assert.ok(
      journey.source.includes(marker),
      `the journey spec must still cover ${marker}`,
    );
  }

  // Impostor selection is weighted-random, so the journey must re-derive the
  // role every round instead of assuming it rotates.
  assert.ok(
    /for \(let round = 1; round <= 3; round \+= 1\)/.test(journey.source),
    "the journey must loop over three real rounds",
  );
  assert.ok(
    journey.source.includes("never\n * assumes the role moved") ||
      journey.source.includes("never assumes the role moved") ||
      journey.source.includes("re-derived every round"),
    "the journey must document that impostor identity is re-derived per round",
  );
});
