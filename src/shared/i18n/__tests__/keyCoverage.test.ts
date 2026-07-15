import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enUsTranslation } from "../resources/en-US";
import { zhCnTranslation } from "../resources/zh-CN";

/**
 * i18n key-coverage audit (Lotus #11).
 *
 * Architecture recap (see src/shared/i18n/index.ts):
 * - en-US and zh-CN are the two *base* locale resources — every other locale is
 *   derived from one of them at runtime (fr-FR/ja-JP/hi-IN spread from en-US,
 *   zh-TW spreads from zh-CN), so a key that is simply absent from a *spread*
 *   locale is not a bug: it inherits the base-locale string automatically.
 * - The two genuine bug classes this test guards against:
 *   1. A `t("a.b.c")` call site references a key that does not exist in
 *      en-US.ts at all — those keys silently render the literal fallback
 *      string (or the raw key) in EVERY locale, including English.
 *   2. A key exists in en-US.ts but is missing from zh-CN.ts — zh-CN users
 *      silently see English text because i18next's fallbackLng is en-US.
 *
 * Keys built from runtime values (template interpolation, e.g.
 * `t(\`ledger.kinds.${kind}\`)`) can't be statically extracted; they are
 * intentionally skipped by the extractor (see DYNAMIC_KEY_PREFIXES below,
 * which are spot-checked separately) and reported via `it.skip`-style notes
 * in the failure message if the static extractor's assumptions ever change.
 */

const SRC_ROOT = path.resolve(__dirname, "../../../..", "src");

// Prefixes reachable only via template-literal interpolation
// (`t(\`namespace.${variable}\`)`), i.e. keys the static extractor cannot see.
// Verified by hand to exist in en-US.ts / zh-CN.ts as of 2026-07.
const DYNAMIC_KEY_PREFIXES = [
  "ledger.kinds.",
  "ledger.priorities.",
  "ledger.statuses.",
  "chat.input.reasoning.",
  "settings.syncMismatchReasons.",
  "components.toolResult.memory.action.",
];

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectSourceFiles(full, files);
    } else if (
      /\.(tsx?|jsx?)$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      files.push(full);
    }
  }
  return files;
}

// Matches `t("literal.key")`, `t('literal.key')`, `t(\`literal.key\`)` — i.e. any
// call to a function named `t` (useTranslation's t, getFixedT()'s t, etc.) whose
// first argument is a plain string literal with no interpolation.
const STATIC_T_CALL = /(?<![A-Za-z0-9_$.])t\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

function extractStaticKeys(): Map<string, { file: string; line: number }[]> {
  const keys = new Map<string, { file: string; line: number }[]>();
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const content = readFileSync(file, "utf8");
    let match: RegExpExecArray | null;
    STATIC_T_CALL.lastIndex = 0;
    while ((match = STATIC_T_CALL.exec(content))) {
      const [, quote, raw] = match;
      if (quote === "`" && raw.includes("${")) continue; // dynamic template, not a static key
      if (!/^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+$/.test(raw)) continue; // not a dotted i18n key
      const line = content.slice(0, match.index).split("\n").length;
      const rel = path.relative(SRC_ROOT, file);
      if (!keys.has(raw)) keys.set(raw, []);
      keys.get(raw)!.push({ file: rel, line });
    }
  }
  return keys;
}

function getByPath(obj: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object" && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, obj);
}

function isDynamicPrefixed(key: string): boolean {
  return DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// i18next plural resolution: t("ns.key", { count }) never looks up the bare
// "ns.key" leaf — it looks up "ns.key_one" / "ns.key_other" (etc, per the
// active locale's CLDR plural categories). So a bare key with no direct
// string value is NOT missing if its plural-suffixed siblings exist.
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"];

function resolvesViaPlural(root: unknown, key: string): boolean {
  const lastDot = key.lastIndexOf(".");
  const leaf = lastDot === -1 ? key : key.slice(lastDot + 1);
  const parentPath = lastDot === -1 ? "" : key.slice(0, lastDot);
  const parent = parentPath ? getByPath(root, parentPath) : root;
  if (!parent || typeof parent !== "object") return false;
  return PLURAL_SUFFIXES.some(
    (suffix) => typeof (parent as Record<string, unknown>)[`${leaf}${suffix}`] === "string",
  );
}

describe("i18n key coverage (Lotus #11 regression guard)", () => {
  const staticKeys = extractStaticKeys();

  it("extracted a plausible number of translation keys from src/", () => {
    // Sanity bound so a broken extractor (e.g. after a big refactor) fails loudly
    // instead of silently reporting zero missing keys.
    expect(staticKeys.size).toBeGreaterThan(500);
  });

  it("every statically-referenced t() key exists in en-US.ts", () => {
    const missing: string[] = [];
    for (const [key, sites] of staticKeys) {
      if (isDynamicPrefixed(key)) continue;
      const value = getByPath(enUsTranslation.translation, key);
      if (typeof value !== "string" && !resolvesViaPlural(enUsTranslation.translation, key)) {
        const where = sites.map((s) => `${s.file}:${s.line}`).join(", ");
        missing.push(`"${key}" (referenced at ${where})`);
      }
    }

    expect(
      missing,
      `The following keys are referenced via t() but do not exist in en-US.ts.\n` +
        `They silently render only their fallback string (or the raw key) in every locale:\n` +
        missing.join("\n"),
    ).toEqual([]);
  });

  it("every key present in en-US.ts also exists in zh-CN.ts (no silent English fallback for zh users)", () => {
    const missing: string[] = [];

    const walk = (enNode: unknown, zhNode: unknown, prefix: string) => {
      if (typeof enNode === "string") {
        if (typeof zhNode !== "string") {
          missing.push(prefix);
        }
        return;
      }
      if (enNode && typeof enNode === "object") {
        for (const [key, value] of Object.entries(enNode as Record<string, unknown>)) {
          const zhChild =
            zhNode && typeof zhNode === "object"
              ? (zhNode as Record<string, unknown>)[key]
              : undefined;
          walk(value, zhChild, prefix ? `${prefix}.${key}` : key);
        }
      }
    };

    walk(enUsTranslation.translation, zhCnTranslation.translation, "");

    expect(
      missing,
      `The following keys exist in en-US.ts but are missing from zh-CN.ts.\n` +
        `zh-CN users see English text for these (i18next fallbackLng = en-US):\n` +
        missing.join("\n"),
    ).toEqual([]);
  });
});
