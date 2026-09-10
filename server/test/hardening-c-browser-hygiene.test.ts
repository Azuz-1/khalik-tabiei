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

test("a real full-game browser journey exists and drives the competitive production phases", () => {
  const journey = specs().find((file) => file.name.includes("journey"));
  assert.ok(journey, "a full-game browser journey spec must exist");

  for (const marker of [
    "setOffline(true)",
    "setOffline(false)",
    "إخراج",
    "ابدأ اللعبة",
    "identifyRoles",
    "استعدوا للتصويت",
    ".vote-board",
    "النقاط بعد دور المتخفي",
    "خلصت اللعبة",
  ]) {
    assert.ok(journey.source.includes(marker), `the journey spec must still cover ${marker}`);
  }

  assert.equal(
    journey.source.includes("ابدأ التصويت"),
    false,
    "production browser journey must rely on automatic DISCUSSION -> VOTING transition",
  );
  assert.ok(
    /for \(let challenge = 1; challenge <= 9; challenge \+= 1\)/.test(journey.source),
    "the journey must loop over nine real base Challenges",
  );
  assert.ok(
    journey.source.includes("exactly one impostor per stint"),
    "the journey must re-derive the weighted-random impostor for every new stint",
  );
  assert.ok(
    journey.source.includes("player-countdown-number"),
    "the journey must verify the newly approved phone countdown cue",
  );
  assert.ok(
    journey.source.includes('key === "liveVoteTally"'),
    "the journey must assert the hidden live target-tally contract",
  );
});
