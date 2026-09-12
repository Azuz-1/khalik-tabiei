import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainUrl = new URL("../../client/src/main.tsx", import.meta.url);
const displayUrl = new URL("../../client/src/screens/Display.tsx", import.meta.url);
const tvUrl = new URL("../../client/src/screens/TvPairing.tsx", import.meta.url);
const hostUrl = new URL("../../client/src/screens/Host.tsx", import.meta.url);
const ownerDisplayUrl = new URL("../../client/src/components/OwnerDisplayControl.tsx", import.meta.url);
const serverUrl = new URL("../src/index.ts", import.meta.url);
const projectionUrl = new URL("../src/game/display.ts", import.meta.url);

test("display and TV routes are code-split before the participant socket is imported", async () => {
  const [main, display, tv] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(displayUrl, "utf8"),
    readFile(tvUrl, "utf8"),
  ]);

  assert.ok(main.includes('location.pathname.startsWith("/display/")'));
  assert.ok(main.includes('import("./screens/Display.js")'));
  assert.ok(main.includes('location.pathname === "/tv"'));
  assert.ok(main.includes('import("./screens/TvPairing.js")'));
  assert.ok(main.includes('import("./App.js")'));
  assert.equal(main.includes('from "./App.js"'), false, "App must not be statically imported on a public display/TV page");
  assert.equal(display.includes('from "../net/socket.js"'), false, "display must not bootstrap participant socket/actions");
  assert.equal(display.includes("actions."), false, "display surface must not expose gameplay or owner actions");
  assert.equal(tv.includes('from "../net/socket.js"'), false, "TV pairing must not bootstrap participant socket/actions");
  assert.equal(tv.includes("actions."), false, "TV pairing must not expose gameplay or owner actions");
  assert.ok(display.includes('mode: "display"'));
  assert.ok(display.includes("شاشة عرض · بدون تحكم"));
});

test("display capability stays out of HTTP/WebSocket URLs and survives same-entry refresh only", async () => {
  const display = await readFile(displayUrl, "utf8");
  assert.ok(display.includes("location.hash"), "display page must consume its capability from the URL fragment");
  assert.ok(display.includes("history.state"), "display refresh recovery should stay scoped to the current history entry");
  assert.ok(display.includes("displayToken: token"), "captured capability should be retained only in history.state");
  assert.ok(display.includes("displayClientId: clientId"), "display reconnect identity should stay scoped to the same history entry");
  assert.ok(display.includes("createDisplayClientId"), "each new display entry needs its own reconnect identity");
  assert.ok(display.includes("history.replaceState"), "display page must clear the captured capability from the visible URL");
  assert.equal(display.includes("new URLSearchParams(location.search).get(\"token\")"), false);
  assert.ok(display.includes('displayToken: route.token'), "display capability must travel in the first HELLO frame");
  assert.ok(display.includes('displayClientId: route.clientId'), "same display must identify reconnects in HELLO, not the URL");
  assert.equal(display.includes('token: route.token'), false, "WebSocket URL builder must not serialize the capability");
  assert.equal(display.includes('displayClientId: route.clientId })'), false, "WebSocket URL builder must not serialize the display client id");
  assert.ok(display.includes('/^\\/display\\/([A-Za-z2-9]{5})\\/?$/'), "display route must match one exact room code");
});

test("TV pairing secret stays in history state and hands off without putting the display token in the URL", async () => {
  const tv = await readFile(tvUrl, "utf8");
  assert.ok(tv.includes("tvPairing"));
  assert.ok(tv.includes("Authorization: `Bearer ${pairing.secret}`"));
  assert.ok(tv.includes('history.replaceState({ ...rest, displayToken }, "", `/display/${roomCode}`)'));
  assert.equal(tv.includes("?secret="), false);
  assert.equal(tv.includes("#token="), false);
  assert.equal(tv.includes("localStorage"), false);
  assert.ok(tv.includes("1_750"), "TV should poll without aggressive requests");
});

test("display server uses a dedicated projection and one revocable reconnect-safe active slot", async () => {
  const [server, projection] = await Promise.all([
    readFile(serverUrl, "utf8"),
    readFile(projectionUrl, "utf8"),
  ]);
  assert.ok(server.includes("buildDisplayView("), "transport must not send the generic participant/spectator view directly");
  assert.ok(server.includes("activeDisplays"), "one active display slot must be tracked separately from players");
  assert.ok(server.includes("displayEpochs"), "display capabilities must support revocation");
  assert.ok(server.includes("displayClientId"), "transport must distinguish same-display reconnects from a second screen");
  assert.ok(server.includes("display connection replaced"), "same display reconnect must replace a stale old socket");
  assert.ok(server.includes('app.delete("/api/rooms/:code/display-link"'), "owner-authenticated revocation endpoint must exist");
  assert.ok(server.includes('app.post("/api/display-pairings"'), "TV pairing creation endpoint must exist");
  assert.ok(server.includes('"/api/rooms/:code/display-pairings/claim"'), "owner pairing claim endpoint must exist");
  assert.ok(projection.includes("displayAlias("));
  assert.ok(projection.includes('uid: "display"'));
});

test("owner TV pairing is primary while the direct display link remains a secondary fallback", async () => {
  const [host, ownerDisplay] = await Promise.all([
    readFile(hostUrl, "utf8"),
    readFile(ownerDisplayUrl, "utf8"),
  ]);
  assert.equal(host.includes('data-testid="optional-display-card"'), false, "lobby must not keep a second display-management control");
  assert.equal(host.includes("/display-link"), false, "direct display management should live in the reusable owner control");
  assert.ok(ownerDisplay.includes("📺 العب على التلفزيون"));
  assert.ok(ownerDisplay.includes("📺 اربط التلفزيون"));
  assert.ok(ownerDisplay.includes('inputMode="numeric"'));
  assert.ok(ownerDisplay.includes("/display-pairings/claim"));
  assert.ok(ownerDisplay.includes("خيارات أخرى"));
  assert.ok(ownerDisplay.includes("رابط مباشر إذا بتفتح شاشة العرض على لابتوب أو تابلت"));
  assert.ok(ownerDisplay.includes("/display-link"));
  assert.ok(ownerDisplay.includes('method: "DELETE"'), "owner UI must retain explicit display revocation");
  assert.ok(ownerDisplay.includes("إيقاف شاشة العرض الحالية"));
});
