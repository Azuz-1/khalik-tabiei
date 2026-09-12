import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const socketSource = readFileSync(resolve(process.cwd(), "../client/src/net/socket.ts"), "utf8");
const storageSource = readFileSync(resolve(process.cwd(), "../client/src/net/promptNovelty.ts"), "utf8");

test("participant socket records novelty only from publicPrompt and syncs the persisted filter", () => {
  assert.match(socketSource, /publicPrompt\?\.noveltyToken/);
  assert.match(socketSource, /recordPublicPromptNovelty\(noveltyToken\)/);
  assert.match(socketSource, /t:\s*"SYNC_NOVELTY"/);
  assert.doesNotMatch(socketSource, /myPrompt\?\.noveltyToken/);
});

test("browser novelty storage is local-only and versioned fail-open", () => {
  assert.match(storageSource, /localStorage\.getItem/);
  assert.match(storageSource, /localStorage\.setItem/);
  assert.match(storageSource, /isPromptNoveltyFilter/);
  assert.match(storageSource, /emptyPromptNoveltyBytes/);
  assert.doesNotMatch(storageSource, /fetch\(/);
});
