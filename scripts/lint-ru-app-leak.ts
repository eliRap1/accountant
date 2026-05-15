// Russian (`ru-RU`) is marketing-only per Plan v4 Risk #24.
//
// IL tax-law disclaimers have not been CPA-reviewed in Russian, so any
// app-side namespace landing in `ru-RU.json` is a release-blocker. This
// linter is a thin guard: it loads the JSON and fails on any forbidden
// top-level path.
//
// Run: `pnpm lint:ru-app-leak`

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.resolve(__dirname, "..", "locales");

const FORBIDDEN_TOP_LEVEL = /^(auth|app|tax|legal|filings|invoices|payroll|ai)\./;

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

function main(): number {
  const file = path.join(localesDir, "ru-RU.json");
  const ru = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;

  const keys = flattenKeys(ru);
  const leaks = keys.filter((k) => FORBIDDEN_TOP_LEVEL.test(k));

  if (leaks.length) {
    console.error("ru-RU.json contains forbidden app-namespace keys:");
    for (const k of leaks) console.error(`  - ${k}`);
    console.error(
      "\nPlan v4 Risk #24: Russian copy in any of",
      "[auth, app, tax, legal, filings, invoices, payroll, ai]",
      "namespaces is a release-blocker until a CPA reviews the translations.",
    );
    return 1;
  }

  console.log(`lint:ru-app-leak OK — ${keys.length} ru-RU keys, all marketing-scoped`);
  return 0;
}

process.exit(main());
