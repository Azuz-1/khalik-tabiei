import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClientView } from "../../shared/types.js";
import { RoomManager } from "../src/game/roomManager.js";
import {
  advanceCurtain,
  coverCurtain,
  initialCurtain,
  privateDealKey,
  revealCurtain,
  type CurtainState,
} from "../../client/src/ui/privacyCurtain.js";
import { authenticatedConnection, joinPlayer, lastMessage, testUid } from "./helpers.js";

function createNamedRoom(manager: RoomManager, name = "المالك") {
  const uid = testUid(1);
  const owner = authenticatedConnection(manager, uid);
  assert.equal(manager.handle(owner.conn, { t: "CREATE_ROOM", name }), true);
  const state = lastMessage(owner.socket, "STATE");
  if (!state) throw new Error("owner room state missing");
  return { ...owner, uid, code: state.view.room.code };
}

/** What a mounted private screen does with each new server view. */
function observe(state: CurtainState, view: ClientView, online = true): CurtainState {
  return advanceCurtain(state, privateDealKey(view), view.readyProgress?.submitted ?? 0, online);
}

function mount(view: ClientView, online = true): CurtainState {
  return initialCurtain(privateDealKey(view), view.readyProgress?.submitted ?? 0, online);
}

test("a mounted private screen starts covered and stays revealed within the same deal", () => {
  const manager = new RoomManager({ rng: () => 0.3 });
  const owner = createNamedRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, owner.code, index));
  try {
    manager.handle(owner.conn, { t: "START_GAME" });
    const watcher = players[2]!;
    let curtain = mount(lastMessage(watcher.socket, "STATE")!.view);
    assert.equal(curtain.revealed, false, "every deal opens behind the curtain");

    curtain = revealCurtain(curtain);
    // Other players getting ready is the same deal: the screen must not re-cover.
    manager.handle(owner.conn, { t: "MARK_READY" });
    manager.handle(players[0]!.conn, { t: "MARK_READY" });
    curtain = observe(curtain, lastMessage(watcher.socket, "STATE")!.view);
    assert.equal(curtain.revealed, true);

    assert.equal(coverCurtain(curtain).revealed, false, "«إخفاء» re-covers on demand");
  } finally {
    manager.dispose();
  }
});

test("a role-blind redeal re-covers a phone that had already revealed its role", () => {
  let now = 1_000;
  const manager = new RoomManager({ now: () => now, rng: () => 0.3, readyDisconnectGraceMs: 30 });
  const owner = createNamedRoom(manager);
  const [second, third, fourth] = [2, 3, 4].map((index) => joinPlayer(manager, owner.code, index));
  try {
    manager.handle(owner.conn, { t: "START_GAME" });

    // Everyone still connected uncovers their private screen; two of them get ready.
    const survivors = [owner, second!, fourth!];
    const curtains = new Map(survivors.map((client) => [
      client.uid,
      revealCurtain(mount(lastMessage(client.socket, "STATE")!.view)),
    ]));
    manager.handle(owner.conn, { t: "MARK_READY" });
    manager.handle(second!.conn, { t: "MARK_READY" });
    for (const client of survivors) {
      const next = observe(curtains.get(client.uid)!, lastMessage(client.socket, "STATE")!.view);
      assert.equal(next.revealed, true, "readiness progress alone is not a new deal");
      curtains.set(client.uid, next);
    }

    manager.disconnect(third!.conn);
    now = 1_030;
    assert.equal(manager.handle(owner.conn, { t: "REDEAL_CHALLENGE" }), true);

    for (const client of survivors) {
      const view = lastMessage(client.socket, "STATE")!.view;
      assert.equal(view.room.phase, "QUESTION", "the redeal stays in QUESTION, so the screen is not remounted");
      assert.equal(view.challenge?.index, 1);
      const next = observe(curtains.get(client.uid)!, view);
      assert.equal(next.revealed, false, `${client.uid} must see «اعرض دوري» again after the redeal`);
    }
  } finally {
    manager.dispose();
  }
});

test("readiness dropping inside one deal key re-covers the screen", () => {
  const curtain = revealCurtain(initialCurtain("same-deal", 3, true));
  assert.equal(advanceCurtain(curtain, "same-deal", 3, true), curtain, "unchanged input keeps identity");
  assert.equal(advanceCurtain(curtain, "same-deal", 4, true).revealed, true);
  assert.equal(advanceCurtain(curtain, "same-deal", 0, true).revealed, false);
});

test("reconnecting re-covers the private screen", () => {
  let curtain = revealCurtain(initialCurtain("deal", 1, true));
  curtain = advanceCurtain(curtain, "deal", 1, false);
  assert.equal(curtain.revealed, true, "a drop alone keeps what is on screen");
  curtain = advanceCurtain(curtain, "deal", 1, true);
  assert.equal(curtain.revealed, false, "the phone may have changed hands while it was offline");
});

test("rematch can repeat every counter of the first deal, so curtain state must not outlive a mount", () => {
  const manager = new RoomManager({ rng: () => 0.3 });
  const owner = createNamedRoom(manager);
  [2, 3].forEach((index) => joinPlayer(manager, owner.code, index));
  const room = manager.roomForTests(owner.code)!;
  try {
    manager.handle(owner.conn, { t: "START_GAME" });
    const first = lastMessage(owner.socket, "STATE")!.view;

    // Jump to the end of the match; the rematch/start path itself is real.
    room.phase = "GAME_OVER";
    assert.equal(manager.handle(owner.conn, { t: "REMATCH" }), true);
    assert.equal(room.phase, "LOBBY");
    assert.equal(manager.handle(owner.conn, { t: "START_GAME" }), true);
    const rematched = lastMessage(owner.socket, "STATE")!.view;
    assert.equal(rematched.room.phase, "QUESTION");
    // Every counter the old cache keyed on repeats in the new match.
    assert.equal(rematched.room.code, first.room.code);
    assert.equal(rematched.room.currentRound, first.room.currentRound);
    assert.equal(rematched.room.completedChallenges, first.room.completedChallenges);
    assert.equal(rematched.challenge?.index, first.challenge?.index);

    // The fix: the curtain lives in component state, so the new match's first
    // private screen is a fresh mount and starts covered whatever the counters say.
    const player = readFileSync(new URL("../../client/src/screens/Player.tsx", import.meta.url), "utf8");
    assert.equal(player.includes("revealedChallenges"), false, "no module-level reveal cache may survive a match");
    assert.equal(/^const\s+\w+\s*=\s*new (Set|Map)/m.test(player), false, "no module-level curtain memory");
    assert.ok(player.includes("useState(() => initialCurtain("), "curtain state is created per mount");
    assert.ok(player.includes("advanceCurtain(curtain, dealKey, submitted, online)"), "curtain re-covers on a new deal while mounted");
  } finally {
    manager.dispose();
  }
});
