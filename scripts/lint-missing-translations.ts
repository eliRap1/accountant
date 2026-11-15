// Translation parity linter.
//
// Rules:
//  - he-IL.json and en-US.json must have the EXACT SAME key set. Either
//    direction's drift is a fail.
//  - ru-RU.json must be a SUBSET of he-IL.json's keys, restricted to
//    marketing namespaces (`nav.*`, `logo.*`, `hero.*`, `services.*`,
//    `dashboard.*`, `approach.*`, `cta.*`, `footer.*`, `sticky.*`,
//    `language.*`). The `_comment` top-level meta key is also allowed.
//
// Run: `pnpm lint:missing-translations`
//
// Exits 1 on mismatch with a clear diff.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(__dirname, "..", "locales");

const RU_ALLOWED_TOP_LEVEL = new Set([
  "_comment",
  "nav",
  "logo",
  "hero",
  "services",
  "dashboard",
  "approach",
  "cta",
  "footer",
  "sticky",
  "language",
]);

function loadJson(name: string): Record<string, unknown> {
  const file = path.join(localesDir, name);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  // `_comment` is a doc string for humans, not a translation key.
  // Strip it before comparing so it doesn't show up in diff output.
  const { _comment: _ignored, ...rest } = raw;
  void _ignored;
  return rest;
}

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  if (Array.isArray(obj)) return [prefix];
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return [prefix];
  const out: string[] = [];
  for (const [k, v] of entries) {
    const next = prefix ? `${prefix}.${k}` : k;
    out.push(...flattenKeys(v, next));
  }
  return out;
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((k) => !b.has(k)).sort();
}

function main(): number {
  const he = loadJson("he-IL.json");
  const en = loadJson("en-US.json");
  const ru = loadJson("ru-RU.json");

  const heKeys = new Set(flattenKeys(he));
  const enKeys = new Set(flattenKeys(en));
  const ruKeys = new Set(flattenKeys(ru));

  let failed = false;

  const missingInEn = diff(heKeys, enKeys);
  const missingInHe = diff(enKeys, heKeys);
  if (missingInEn.length || missingInHe.length) {
    failed = true;
    console.error("\nhe-IL vs en-US key parity mismatch:");
    if (missingInEn.length) {
      console.error("  in he-IL but not en-US:");
      for (const k of missingInEn) console.error(`    - ${k}`);
    }
    if (missingInHe.length) {
      console.error("  in en-US but not he-IL:");
      for (const k of missingInHe) console.error(`    - ${k}`);
    }
  }

  // ru-RU must be a subset of he-IL, AND every ru-RU key's top-level
  // namespace must be in the marketing whitelist.
  const ruExtra = diff(ruKeys, heKeys);
  if (ruExtra.length) {
    failed = true;
    console.error("\nru-RU keys not present in he-IL (would need translation):");
    for (const k of ruExtra) console.error(`  - ${k}`);
  }

  const ruScopeViolations = [...ruKeys].filter((k) => {
    const top = k.split(".")[0];
    return top !== undefined && !RU_ALLOWED_TOP_LEVEL.has(top);
  });
  if (ruScopeViolations.length) {
    failed = true;
    console.error("\nru-RU contains keys outside marketing scope:");
    for (const k of ruScopeViolations) console.error(`  - ${k}`);
    console.error(
      "\nRussian is marketing-only per Plan v4 Risk #24. Restrict to:",
      [...RU_ALLOWED_TOP_LEVEL].sort().join(", "),
    );
  }

  if (failed) {
    console.error("\nlint:missing-translations FAILED");
    return 1;
  }

  console.log(
    `lint:missing-translations OK — he-IL=${heKeys.size}, en-US=${enKeys.size}, ru-RU=${ruKeys.size} keys`,
  );
  return 0;
}

process.exit(main());
