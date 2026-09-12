import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const socketSource = readFileSync(resolve(process.cwd(), "../client/src/net/socket.ts"), "utf8");
const storageSource = readFileSync(resolve(process.cwd(), "../client/src/net/promptNovelty.ts"), "utf8");

test("participant socket records novelty only from publicPrompt and syncs the persisted filter", () => {
  assert.ok(socketSource.includes("publicPrompt?.noveltyToken"));
  assert.ok(socketSource.includes("recordPublicPromptNovelty"));
  assert.ok(socketSource.includes('t: "SYNC_NOVELTY"'));
  assert.equal(socketSource.includes("myPrompt?.noveltyToken"), false);
});

test("browser novelty storage is local-only and versioned fail-open", () => {
  assert.ok(storageSource.includes("localStorage.getItem"));
  assert.ok(storageSource.includes("localStorage.setItem"));
  assert.ok(storageSource.includes("isPromptNoveltyFilter"));
  assert.ok(storageSource.includes("emptyPromptNoveltyBytes"));
  assert.equal(storageSource.includes("fetch("), false);
});
