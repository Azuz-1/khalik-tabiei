import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createGameServer } from "../src/index.js";
import { SuggestionService, type StoredSuggestion } from "../src/suggestions.js";

test("suggestion endpoint requires session and stores no transport identity", async () => {
  const stored: StoredSuggestion[] = [];
  const suggestions = new SuggestionService((entry) => { stored.push(entry); }, "test-sha", () => 0);
  const runtime = createGameServer({ suggestions });
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const address = runtime.server.address();
  if (!address || typeof address === "string") throw new Error("test server address missing");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const unauthenticated = await fetch(`${base}/api/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "idea", text: "اقتراح بدون جلسة" }),
    });
    assert.equal(unauthenticated.status, 401);

    const bootstrap = await fetch(`${base}/api/session`);
    assert.equal(bootstrap.status, 200);
    const cookie = bootstrap.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "session bootstrap should issue a signed cookie");

    const accepted = await fetch(`${base}/api/suggestions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ category: "idea", text: "ودي خيار ألعاب أسرع للمجموعات الصغيرة" }),
    });
    assert.equal(accepted.status, 201);
    assert.deepEqual(await accepted.json(), { ok: true });
    assert.equal(stored.length, 1);
    assert.deepEqual(Object.keys(stored[0]!).sort(), ["category", "deploymentSha", "occurredAt", "text"]);

    const personal = await fetch(`${base}/api/suggestions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ category: "other", text: "راسلني على 0551234567" }),
    });
    assert.equal(personal.status, 400);
    assert.deepEqual(await personal.json(), { ok: false, code: "CONTACT_INFO" });
    assert.equal(stored.length, 1);
  } finally {
    runtime.dispose();
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
  }
});
