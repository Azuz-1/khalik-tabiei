import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const tokens = readFileSync(new URL("../../client/src/styles/tokens.css", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../client/src/styles.css", import.meta.url), "utf8");

/** Only the base :root block defines the palette; later media blocks only resize things. */
function declarations(): Map<string, string> {
  const root = tokens.slice(tokens.indexOf(":root {"), tokens.indexOf("\n}\n", tokens.indexOf(":root {")));
  const map = new Map<string, string>();
  for (const match of root.matchAll(/(--[\w-]+):\s*([^;]+);/g)) map.set(match[1]!, match[2]!.trim());
  return map;
}

function resolveHex(name: string, map = declarations(), depth = 0): string {
  const value = map.get(name);
  assert.ok(value, `token ${name} is not defined`);
  const reference = value!.match(/^var\((--[\w-]+)\)$/);
  if (reference && depth < 8) return resolveHex(reference[1]!, map, depth + 1);
  assert.match(value!, /^#[0-9a-f]{6}$/i, `${name} must resolve to a solid hex colour, got ${value}`);
  return value!;
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

test("every filled action that carries ink-on-action text meets WCAG AA for normal-size text", () => {
  const ink = resolveHex("--ink-on-action");
  for (const fill of [
    "--action-primary",
    "--action-primary-deep",
    "--action-primary-hover",
    "--action-primary-pressed",
    "--action-danger-fill",
    "--action-danger-fill-hover",
  ]) {
    const ratio = contrast(ink, resolveHex(fill));
    assert.ok(ratio >= 4.5, `${fill} vs --ink-on-action is ${ratio.toFixed(2)}:1, below 4.5:1`);
  }
});

test("button rules take every text-bearing fill from those tokens, never an unchecked literal", () => {
  const rule = (selector: string) => {
    const start = styles.indexOf(`${selector} {`);
    assert.ok(start >= 0, `${selector} rule missing`);
    return styles.slice(start, styles.indexOf("}", start));
  };
  assert.match(rule(".btn-primary"), /linear-gradient\(180deg, var\(--action-primary\), var\(--action-primary-deep\)\)/);
  assert.match(rule(".btn-primary:hover:not(:disabled)"), /var\(--action-primary-hover\), var\(--action-primary\)/);
  assert.match(rule(".btn-primary:active:not(:disabled)"), /var\(--action-primary-pressed\)/);
  assert.match(rule(".btn-danger"), /background: var\(--action-danger-fill\)/);
  assert.match(rule(".btn-danger:hover:not(:disabled)"), /var\(--action-danger-fill-hover\)/);
  for (const selector of [".btn-primary", ".btn-primary:hover:not(:disabled)", ".btn-danger", ".btn-danger:hover:not(:disabled)"]) {
    assert.equal(/#[0-9a-f]{3,6}\b/i.test(rule(selector)), false, `${selector} must not hard-code a colour`);
  }
});
