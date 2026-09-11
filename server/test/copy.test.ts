import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME_MODES, TIMERS } from "../../shared/constants.js";

function mode(id: "HANDS" | "POINT" | "NUMBER") {
  const found = GAME_MODES.find((candidate) => candidate.id === id);
  assert.ok(found, `missing ${id} mode metadata`);
  return found;
}

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Saudi mode copy uses clear full labels and action cues", () => {
  const hands = mode("HANDS");
  const point = mode("POINT");
  const number = mode("NUMBER");

  assert.equal(hands.fullLabel, "ارفع يدك");
  assert.equal(hands.description, "إذا المطلوب ينطبق عليك، ارفع يدك.");
  assert.equal(hands.actionLabel, "ارفعوا!");

  assert.equal(point.fullLabel, "أشر على شخص");
  assert.equal(point.description, "اختر الشخص اللي تشوف إن المطلوب ينطبق عليه.");
  assert.equal(point.actionLabel, "أشروا!");

  assert.equal(number.fullLabel, "ارفع أصابعك");
  assert.equal(number.description, "جاوب من 0 إلى 5 بأصابعك.");
  assert.equal(number.actionLabel, "ارفعوا أصابعكم!");
  assert.equal(
    number.normalInstruction,
    "وقت «ارفعوا أصابعكم!» ارفع أصابعك بالعدد اللي اخترته من 0 إلى 5.",
  );
  assert.equal(
    number.impostorInstruction,
    "وقت «ارفعوا أصابعكم!» ارفع من 0 إلى 5 أصابع وخلك طبيعي.",
  );
});

test("current player-facing copy excludes retired or unclear wording", () => {
  const files = [
    "shared/constants.ts",
    "client/src/App.tsx",
    "client/src/screens/Home.tsx",
    "client/src/screens/Host.tsx",
    "client/src/screens/Player.tsx",
    "client/src/components/Bits.tsx",
    "client/src/components/Players.tsx",
    "client/src/components/Qr.tsx",
    "client/src/i18n/errors.ts",
    "client/src/net/socket.ts",
  ];
  const combined = files.map(source).join("\n");

  for (const retired of [
    "سرّك",
    "يشوف سره",
    "يشوف دوره",
    "لقّطوه",
    "ورّونا",
    "طلّع أصابعك",
    "طلّعوا أصابعكم",
  ]) {
    assert.equal(combined.includes(retired), false, `retired copy returned: ${retired}`);
  }
  assert.equal(/(^|[\s،.!؟])مب(?=$|[\s،.!؟])/m.test(combined), false, "retired standalone «مب» returned");

  assert.ok(combined.includes("سوّ غرفة"));
  assert.ok(combined.includes("مين تصرفه مو طبيعي؟"));
});

test("TV and player phone both carry synchronized countdown/action/look-around cues", () => {
  const host = source("client/src/screens/Host.tsx");
  const player = source("client/src/screens/Player.tsx");

  assert.ok(host.includes('className="host-countdown-instruction"'));
  assert.ok(host.includes("إذا المطلوب ينطبق عليك، ارفع يدك عند «ارفعوا!»."));
  assert.ok(host.includes("عند «أشروا!»، أشر على شخص واحد."));
  assert.ok(host.includes("عند «ارفعوا أصابعكم!»، ارفع أصابعك بالعدد اللي اخترته."));
  assert.ok(host.includes("طالعوا بعض"));
  assert.ok(host.includes("خلكم على وضعكم لين يطلع المطلوب."));

  assert.ok(player.includes('case "COUNTDOWN": return <PlayerCountdown view={view} />;'));
  assert.ok(player.includes('case "ACTION": return <PlayerAction view={view} />;'));
  assert.ok(player.includes('case "HOLD": return <PlayerHold view={view} />;'));
  assert.ok(player.includes("visibleCountdownSecond"));
  assert.ok(player.includes("player-countdown-number"));
  assert.ok(player.includes("modeInfo(view)?.actionLabel"));
  assert.ok(player.includes("طالعوا بعض"));
});

test("physical phase timings keep a five-second countdown plus a five-second look-around beat", () => {
  assert.equal(TIMERS.COUNTDOWN, 5_000);
  assert.equal(TIMERS.ACTION, 1_000);
  assert.equal(TIMERS.HOLD, 5_000);
  assert.equal(TIMERS.PROMPT_REVEAL, 2_500);
});
