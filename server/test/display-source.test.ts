import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainUrl = new URL("../../client/src/main.tsx", import.meta.url);
const displayUrl = new URL("../../client/src/screens/Display.tsx", import.meta.url);
const hostUrl = new URL("../../client/src/screens/Host.tsx", import.meta.url);
const serverUrl = new URL("../src/index.ts", import.meta.url);
const projectionUrl = new URL("../src/game/display.ts", import.meta.url);

test("display route is code-split before the participant socket is imported", async () => {
  const [main, display] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(displayUrl, "utf8"),
  ]);

  assert.ok(main.includes('location.pathname.startsWith("/display/")'));
  assert.ok(main.includes('import("./screens/Display.js")'));
  assert.ok(main.includes('import("./App.js")'));
  assert.equal(main.includes('from "./App.js"'), false, "App must not be statically imported on a display page");
  assert.equal(display.includes('from "../net/socket.js"'), false, "display must not bootstrap participant socket/actions");
  assert.equal(display.includes("actions."), false, "display surface must not expose gameplay or owner actions");
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
  assert.ok(projection.includes("displayAlias("));
  assert.ok(projection.includes('uid: "display"'));
});

test("owner lobby exposes optional display generation and explicit revocation", async () => {
  const host = await readFile(hostUrl, "utf8");
  assert.ok(host.includes('data-testid="optional-display-card"'));
  assert.ok(host.includes("شاشة عرض"));
  assert.ok(host.includes("اختيارية"));
  assert.ok(host.includes("ما ينحسب لاعب وما يقدر يتحكم بالغرفة"));
  assert.ok(host.includes("/display-link"));
  assert.ok(host.includes('method: "DELETE"'), "owner UI must be able to revoke the issued display capability");
  assert.ok(host.includes("إيقاف شاشة العرض"));
  assert.ok(host.includes("يبطل الرابط القديم"));
});
