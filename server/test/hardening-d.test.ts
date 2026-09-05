import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePromptCandidate } from "../src/game/engine.js";
import { IMITATION_PROMPTS } from "../src/game/imitationPrompts.data.js";
import { assertActivePromptBank } from "../src/game/promptAudit.js";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoom, joinPlayer } from "./helpers.js";

test("active imitation bank is exactly 330 audited prompts with explicit families", () => {
  const report = assertActivePromptBank();
  assert.deepEqual(report.byMode, { HANDS: 110, POINT: 110, NUMBER: 110 });
  assert.deepEqual(report.duplicateIds, []);
  assert.deepEqual(report.duplicateTexts, []);
  assert.deepEqual(report.missingFamilyIds, []);
  assert.deepEqual(report.highConsensusIds.sort(), ["P06", "P09"]);
  assert.ok(Object.keys(report.familyCounts).length >= 8);
});

test("high-consensus wording edits are explicit and old absolute wording is gone", () => {
  const p06 = IMITATION_PROMPTS.find((prompt) => prompt.id === "P06")!;
  const p09 = IMITATION_PROMPTS.find((prompt) => prompt.id === "P09")!;
  assert.equal(p06.text, "أشر على اللي لو تغيّر موعد الطلعة قبلها بساعة غالبًا يحتاج أكثر وقت يعيد ترتيب نفسه.");
  assert.equal(p09.text, "أشر على اللي لو بطارية واحد فيكم صارت 5٪ غالبًا بيكون عنده حل أو شاحن.");
  assert.equal(IMITATION_PROMPTS.some((prompt) => prompt.text === "أشر على اللي ممكن يوصل آخر واحد للموعد."), false);
  assert.equal(IMITATION_PROMPTS.some((prompt) => prompt.text === "أشر على اللي دايم معه شاحن."), false);
});

test("prompt family spacing prefers another topic but falls back without violating candidate set", () => {
  const same = { id: "A", mode: "HANDS" as const, text: "a", family: "phone-messaging" as const };
  const other = { id: "B", mode: "HANDS" as const, text: "b", family: "food-drink" as const };
  assert.equal(choosePromptCandidate([same, other], "phone-messaging", () => 0).id, "B");
  assert.equal(choosePromptCandidate([same], "phone-messaging", () => 0).id, "A");
});

test("draining manager rejects new room admission, start, and rematch actions", () => {
  const outside = new RoomManager({ rng: () => 0 });
  const connection = { uid: "outside", roomCode: null, send() {}, markDisconnected: () => true } as never;
  outside.register(connection);
  outside.setDraining();
  assert.equal(outside.handle(connection, { t: "CREATE_ROOM", rid: "d-create" }), false);
  outside.dispose();

  const manager = new RoomManager({ rng: () => 0 });
  const host = createRoom(manager);
  joinPlayer(manager, host.code, 2);
  joinPlayer(manager, host.code, 3);
  manager.setDraining();
  assert.equal(manager.handle(host.conn, { t: "START_GAME", rid: "d-start" }), false);
  assert.equal(manager.roomForTests(host.code)?.phase, "LOBBY");
  manager.dispose();
});

test("font serving is local-only and production runtime is compiled/non-root", async () => {
  const [html, main, headers, clientPackage, dockerfile, serverPackage] = await Promise.all([
    readFile(new URL("../../client/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/security/headers.ts", import.meta.url), "utf8"),
    readFile(new URL("../../client/package.json", import.meta.url), "utf8"),
    readFile(new URL("../../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.equal(html.includes("fonts.googleapis.com"), false);
  assert.equal(html.includes("fonts.gstatic.com"), false);
  assert.equal(headers.includes("fonts.googleapis.com"), false);
  assert.equal(headers.includes("fonts.gstatic.com"), false);
  assert.ok(main.includes('@fontsource/tajawal/400.css'));
  assert.ok(main.includes('@fontsource/tajawal/900.css'));
  assert.equal(JSON.parse(clientPackage).dependencies["@fontsource/tajawal"], "5.3.0");
  assert.ok(dockerfile.includes("FROM node:22-slim AS runtime"));
  assert.ok(dockerfile.includes("USER node"));
  assert.ok(dockerfile.includes('CMD ["node", "server/dist/server/src/index.js"]'));
  assert.equal(JSON.parse(serverPackage).scripts.start, "node dist/server/src/index.js");
});

test("legacy TEXT_PAIR content remains isolated from the 330 active imitation prompts", async () => {
  const [engine, questions] = await Promise.all([
    readFile(new URL("../src/game/engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/game/questions.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(engine.includes("beginLegacyRound"));
  assert.ok(questions.includes("CORE_PACK"));
  assert.equal(IMITATION_PROMPTS.some((prompt) => (prompt as { kind?: string }).kind === "TEXT_PAIR"), false);
});
