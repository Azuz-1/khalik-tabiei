import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { withPublicOrigin } from "../src/index.js";

const indexSource = fileURLToPath(new URL("../../client/index.html", import.meta.url));

test("link preview tags point at an absolute og:image once the origin is injected", async () => {
  const html = withPublicOrigin(await readFile(indexSource, "utf8"), "https://khalik.example");
  assert.doesNotMatch(html, /__PUBLIC_ORIGIN__/);
  assert.match(html, /<meta property="og:image" content="https:\/\/khalik\.example\/og\.jpg"/);
  assert.match(html, /<meta property="og:title" content="[^"]*خلك طبيعي/);
  assert.match(html, /<meta property="og:locale" content="ar_SA"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
});

test("an unset origin leaves a relative og:image rather than a placeholder", () => {
  assert.equal(withPublicOrigin('<meta content="__PUBLIC_ORIGIN__/og.jpg">', null), '<meta content="/og.jpg">');
});
