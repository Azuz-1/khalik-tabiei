import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PROMPT_NOVELTY_FILTER_BYTES,
  PROMPT_NOVELTY_VERSION,
  addPromptNovelty,
  emptyPromptNoveltyBytes,
  hasPromptNovelty,
  promptNoveltySlot,
  promptNoveltyTokenForSlot,
  type PromptNoveltyFilter,
} from "../../shared/promptNovelty.js";

const socketSource = readFileSync(resolve(process.cwd(), "../client/src/net/socket.ts"), "utf8");
const storageSource = readFileSync(resolve(process.cwd(), "../client/src/net/promptNovelty.ts"), "utf8");

type PromptNoveltyStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type ClientNoveltyModule = {
  mergePromptNoveltyFilters: (
    ...filters: ReadonlyArray<PromptNoveltyFilter | null | undefined>
  ) => PromptNoveltyFilter;
  persistPromptNoveltyUpdate: (
    storage: PromptNoveltyStorage,
    currentHistory: PromptNoveltyFilter,
    nextHistory: PromptNoveltyFilter,
  ) => PromptNoveltyFilter;
};

const importRuntimeModule = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;
const clientNovelty = await importRuntimeModule(
  new URL("../../client/src/net/promptNovelty.ts", import.meta.url).href,
) as ClientNoveltyModule;

class MemoryStorage implements PromptNoveltyStorage {
  readonly values = new Map<string, string>();
  lastKey: string | null = null;

  getItem(key: string): string | null {
    this.lastKey = key;
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.lastKey = key;
    this.values.set(key, value);
  }
}

function noveltyToken(promptId: string): string {
  const slot = promptNoveltySlot(promptId);
  assert.notEqual(slot, undefined, `${promptId} should have a history slot`);
  return promptNoveltyTokenForSlot(slot!);
}

function historyWith(...promptIds: string[]): PromptNoveltyFilter {
  const bytes = emptyPromptNoveltyBytes();
  for (const promptId of promptIds) addPromptNovelty(bytes, noveltyToken(promptId));
  return { version: PROMPT_NOVELTY_VERSION, bits: Buffer.from(bytes).toString("base64url") };
}

function expectSeen(history: PromptNoveltyFilter, ...promptIds: string[]): void {
  const bytes = Buffer.from(history.bits, "base64url");
  assert.equal(bytes.byteLength, PROMPT_NOVELTY_FILTER_BYTES);
  for (const promptId of promptIds) {
    assert.equal(hasPromptNovelty(bytes, noveltyToken(promptId)), true, `${promptId} should remain seen`);
  }
}

test("participant socket records novelty only from publicPrompt and syncs the persisted filter", () => {
  assert.ok(socketSource.includes("publicPrompt?.noveltyToken"));
  assert.ok(socketSource.includes("recordPublicPromptNovelty"));
  assert.ok(socketSource.includes('t: "SYNC_NOVELTY"'));
  assert.equal(socketSource.includes("myPrompt?.noveltyToken"), false);
});

test("browser novelty storage is local-only, versioned, and merge-before-write", () => {
  assert.ok(storageSource.includes("localStorage.getItem"));
  assert.ok(storageSource.includes("localStorage.setItem"));
  assert.ok(storageSource.includes("isPromptNoveltyFilter"));
  assert.ok(storageSource.includes("emptyPromptNoveltyBytes"));
  assert.ok(storageSource.includes("persistPromptNoveltyUpdate"));
  assert.equal(storageSource.includes("fetch("), false);
});

test("stale browser instances cannot erase prompt history written by another tab", () => {
  const storage = new MemoryStorage();
  const initial = historyWith("H01");
  clientNovelty.persistPromptNoveltyUpdate(storage, historyWith(), initial);

  const staleInstance1 = initial;
  const staleInstance2 = initial;

  const withB = clientNovelty.mergePromptNoveltyFilters(staleInstance1, historyWith("H02"));
  const savedByInstance1 = clientNovelty.persistPromptNoveltyUpdate(storage, staleInstance1, withB);
  expectSeen(savedByInstance1, "H01", "H02");

  const withCFromStaleMemory = clientNovelty.mergePromptNoveltyFilters(staleInstance2, historyWith("H03"));
  const savedByInstance2 = clientNovelty.persistPromptNoveltyUpdate(
    storage,
    staleInstance2,
    withCFromStaleMemory,
  );

  expectSeen(savedByInstance2, "H01", "H02", "H03");
  assert.ok(storage.lastKey);
  const persisted = JSON.parse(storage.getItem(storage.lastKey!)!) as PromptNoveltyFilter;
  expectSeen(persisted, "H01", "H02", "H03");
});

test("browser history merging is idempotent and never clears set bits", () => {
  const a = historyWith("H01", "P01");
  const b = historyWith("H02", "N01");
  const merged = clientNovelty.mergePromptNoveltyFilters(a, b);
  const repeated = clientNovelty.mergePromptNoveltyFilters(merged, a, b, merged);

  expectSeen(merged, "H01", "H02", "P01", "N01");
  assert.equal(repeated.bits, merged.bits, "re-adding the same history must be idempotent");

  const aBytes = Buffer.from(a.bits, "base64url");
  const mergedBytes = Buffer.from(merged.bits, "base64url");
  for (let index = 0; index < aBytes.length; index += 1) {
    assert.equal(
      mergedBytes[index]! & aBytes[index]!,
      aBytes[index]!,
      `merge cleared an existing bit in byte ${index}`,
    );
  }
});

test("malformed and version-mismatched persisted history is ignored safely", () => {
  const storage = new MemoryStorage();
  const a = historyWith("H01");
  const c = historyWith("H03");
  clientNovelty.persistPromptNoveltyUpdate(storage, historyWith(), a);
  assert.ok(storage.lastKey);
  const storageKey = storage.lastKey!;

  storage.setItem(storageKey, "{not-json");
  const afterMalformed = clientNovelty.persistPromptNoveltyUpdate(storage, a, c);
  expectSeen(afterMalformed, "H01", "H03");

  const allOnes = Buffer.alloc(PROMPT_NOVELTY_FILTER_BYTES, 0xff).toString("base64url");
  storage.setItem(storageKey, JSON.stringify({ version: PROMPT_NOVELTY_VERSION - 1, bits: allOnes }));
  const afterOldVersion = clientNovelty.persistPromptNoveltyUpdate(storage, a, c);
  expectSeen(afterOldVersion, "H01", "H03");
  assert.equal(
    hasPromptNovelty(Buffer.from(afterOldVersion.bits, "base64url"), noveltyToken("H02")),
    false,
    "bits from an unsupported storage version must not be imported",
  );
});
