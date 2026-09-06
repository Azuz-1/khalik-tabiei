import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import { buildView } from "../src/game/view.js";
import { cleanName, normalizeArabic } from "../src/game/state.js";
import { createRoom, joinPlayer } from "./helpers.js";

test("name cleaning rejects invisible-only input and comparison removes default ignorables", () => {
  assert.throws(() => cleanName("\u200b\u2060\ufeff"));
  assert.equal(normalizeArabic(cleanName("سالم")), normalizeArabic(cleanName("سالم\u200b")));
});

test("display cleaning preserves Arabic diacritics and emoji ZWJ graphemes", () => {
  const arabic = "سَالِم";
  assert.equal(cleanName(arabic), arabic.normalize("NFC"));

  const family = "👨‍👩‍👧‍👦";
  assert.equal(cleanName(family.repeat(16)), family.repeat(16));
  assert.throws(() => cleanName(family.repeat(17)));
});

test("seat identity remains stable when another player leaves the roster", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const host = createRoom(manager);
  const p2 = joinPlayer(manager, host.code, 2);
  const p3 = joinPlayer(manager, host.code, 3);
  const p4 = joinPlayer(manager, host.code, 4);
  const room = manager.roomForTests(host.code)!;

  const before = buildView(room, host.uid, "http://localhost/join").players;
  const seatsBefore = new Map(before.map((player) => [player.uid, player.seatNumber]));
  assert.equal(new Set(before.map((player) => player.seatNumber)).size, before.length);

  manager.handle(p3.conn, { t: "LEAVE_ROOM" });
  const after = buildView(room, host.uid, "http://localhost/join").players;
  assert.equal(after.some((player) => player.uid === p3.uid), false);
  assert.equal(after.find((player) => player.uid === p2.uid)?.seatNumber, seatsBefore.get(p2.uid));
  assert.equal(after.find((player) => player.uid === p4.uid)?.seatNumber, seatsBefore.get(p4.uid));
  manager.dispose();
});

test("production UI has no native destructive confirm path and exposes modal accessibility contracts", async () => {
  const [app, host, dialog, player, html, css] = await Promise.all([
    readFile(new URL("../../client/src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/screens/Host.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/components/ConfirmDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/screens/Player.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/c-ux.css", import.meta.url), "utf8"),
  ]);

  assert.equal(app.includes("confirm("), false);
  assert.equal(host.includes("confirm("), false);
  assert.ok(dialog.includes('role="dialog"'));
  assert.ok(dialog.includes('aria-modal="true"'));
  assert.ok(dialog.includes('event.key === "Escape"'));
  assert.ok(dialog.includes('background?.setAttribute("inert", "")'));
  assert.ok(app.includes('role="dialog"'));
  assert.ok(app.includes('data-game-surface'));
  assert.ok(player.includes("!targets.some((target) => target.uid === picked)"));
  assert.equal(html.includes("maximum-scale"), false);
  assert.ok(css.includes("prefers-reduced-motion"));
  assert.ok(css.includes(":focus-visible"));
  assert.ok(css.includes("safe-area-inset-bottom"));
});

test("player-management sort is deterministic: offline first, then stable seat number", async () => {
  const app = await readFile(new URL("../../client/src/App.tsx", import.meta.url), "utf8");
  assert.ok(app.includes("Number(a.connected) - Number(b.connected) || a.seatNumber - b.seatNumber"));
});
