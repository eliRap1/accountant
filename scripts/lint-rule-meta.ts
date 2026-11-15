// Tax-rule metadata linter (Plan v4 §Tax Positioning).
//
// Every `lib/tax/il/rules-<year>.ts` file that lands in Phase D MUST be
// accompanied by a `rules-<year>.meta.json` describing who reviewed the
// numeric values and when. This script enforces:
//
//   - `humanReviewed: true`
//   - `reviewer: string` (non-empty)
//   - `reviewedOn: <ISO-8601 date>` within the last 18 months
//   - `country: 'IL'`
//
// Phase A.7 reality: no rules files exist yet, so the script exits 0.
// Phase D entry: rules files appear → linter activates as the merge gate.
//
// Run: `pnpm lint:rule-meta`

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesDir = path.resolve(__dirname, "..", "lib", "tax", "il");

const EIGHTEEN_MONTHS_MS = 18 * 30 * 24 * 60 * 60 * 1000;

type Meta = {
  humanReviewed?: unknown;
  reviewer?: unknown;
  reviewedOn?: unknown;
  country?: unknown;
  notes?: unknown;
};

function findMetaFiles(): string[] {
  if (!fs.existsSync(rulesDir)) return [];
  return fs
    .readdirSync(rulesDir)
    .filter((f) => /^rules-\d{4}\.meta\.json$/.test(f))
    .map((f) => path.join(rulesDir, f));
}

function validateMeta(file: string): string[] {
  const errs: string[] = [];
  let parsed: Meta;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Meta;
  } catch (e) {
    return [`failed to parse JSON: ${(e as Error).message}`];
  }

  if (parsed.humanReviewed !== true) {
    errs.push("humanReviewed must be exactly `true`");
  }
  if (typeof parsed.reviewer !== "string" || parsed.reviewer.trim() === "") {
    errs.push("reviewer must be a non-empty string");
  }
  if (typeof parsed.reviewedOn !== "string") {
    errs.push("reviewedOn must be an ISO-8601 date string");
  } else {
    const t = Date.parse(parsed.reviewedOn);
    if (Number.isNaN(t)) {
      errs.push(`reviewedOn is not a valid ISO date: ${parsed.reviewedOn}`);
    } else {
      const age = Date.now() - t;
      if (age < 0) errs.push("reviewedOn is in the future");
      if (age > EIGHTEEN_MONTHS_MS) {
        errs.push(
          `reviewedOn is older than 18 months — re-review required (${parsed.reviewedOn})`,
        );
      }
    }
  }
  if (parsed.country !== "IL") {
    errs.push("country must be 'IL'");
  }
  return errs;
}

function main(): number {
  const files = findMetaFiles();
  if (files.length === 0) {
    console.log(
      "lint:rule-meta OK — no rules-*.meta.json present yet (Phase A.7).",
    );
    return 0;
  }

  let failed = false;
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const errs = validateMeta(file);
    if (errs.length > 0) {
      failed = true;
      console.error(`\n${rel}:`);
      for (const e of errs) console.error(`  - ${e}`);
    } else {
      console.log(`${rel}: OK`);
    }
  }

  if (failed) {
    console.error("\nlint:rule-meta FAILED");
    return 1;
  }
  return 0;
}

process.exit(main());
