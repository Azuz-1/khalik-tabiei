import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { AbuseGuard } from "../src/security/rateLimit.js";
import { testUid } from "./helpers.js";

test("shared Wi-Fi can carry a full party reconnect burst without IP lockout", () => {
  const abuse = new AbuseGuard(() => 0);
  const ip = "203.0.113.44";

  // Ten devices waking/reconnecting several times in the same minute should
  // remain normal party traffic even though they share one public NAT address.
  for (let cycle = 0; cycle < 5; cycle += 1) {
    for (let player = 1; player <= 10; player += 1) {
      const uid = testUid(player);
      assert.equal(abuse.allowSession(ip, uid), true, `session ${cycle}:${player}`);
      assert.equal(abuse.allowConnection(ip, uid), true, `connection ${cycle}:${player}`);
    }
  }

  abuse.dispose();
});

test("legitimate multi-challenge voting cannot exhaust the per-player limiter", () => {
  const abuse = new AbuseGuard(() => 0);
  const uid = testUid(1);

  // Maximum configured game: 10 rounds x up to 3 Challenges = 30 legitimate
  // vote submissions. Keep extra headroom for retries while retaining a cap.
  for (let vote = 1; vote <= 40; vote += 1) {
    assert.equal(abuse.allowMessage(uid, "SUBMIT_VOTE"), true, `vote ${vote}`);
  }
  assert.equal(abuse.allowMessage(uid, "SUBMIT_VOTE"), false);
  abuse.dispose();
});

test("active Host UI exposes player management and Player UI exposes explicit leave", async () => {
  const app = await readFile(new URL("../../client/src/App.tsx", import.meta.url), "utf8");
  const manager = await readFile(
    new URL("../src/game/roomManager.ts", import.meta.url),
    "utf8",
  );

  assert.ok(app.includes("إدارة اللاعبين"));
  assert.ok(app.includes("إخراج"));
  assert.ok(app.includes("الخروج من الغرفة"));
  assert.ok(app.includes("إنهاء اللعبة"));
  assert.ok(app.includes("مكانه محفوظ"));

  // A transport disconnect must not silently call the old redeal/removal path.
  const disconnectBlock = manager.slice(
    manager.indexOf("disconnect(conn: Connection)"),
    manager.indexOf("handle(conn: Connection"),
  );
  assert.equal(disconnectBlock.includes("redealCurrentRound"), false);
  assert.equal(disconnectBlock.includes("removePlayer(room"), false);
  assert.ok(disconnectBlock.includes("Keep the seat"));
});

test("short in-game mode labels are retired in favor of explicit actions", async () => {
  const constants = await readFile(
    new URL("../../shared/constants.ts", import.meta.url),
    "utf8",
  );

  assert.ok(constants.includes('label: "ارفع يدك"'));
  assert.ok(constants.includes('label: "أشر على شخص"'));
  assert.ok(constants.includes('label: "ارفع أصابعك"'));
  assert.equal(constants.includes('label: "ارفع"'), false);
  assert.equal(constants.includes('label: "أشر"'), false);
  assert.equal(constants.includes('label: "كم؟"'), false);
});
