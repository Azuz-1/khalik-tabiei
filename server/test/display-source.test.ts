import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const mainUrl = new URL("../../client/src/main.tsx", import.meta.url);
const displayUrl = new URL("../../client/src/screens/Display.tsx", import.meta.url);
const hostUrl = new URL("../../client/src/screens/Host.tsx", import.meta.url);

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

test("owner lobby exposes display as an explicitly optional surface", async () => {
  const host = await readFile(hostUrl, "utf8");
  assert.ok(host.includes('data-testid="optional-display-card"'));
  assert.ok(host.includes("شاشة عرض"));
  assert.ok(host.includes("اختيارية"));
  assert.ok(host.includes("ما ينحسب لاعب وما يقدر يتحكم بالغرفة"));
  assert.ok(host.includes("/display-link"));
});
