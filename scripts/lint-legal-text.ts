// Legal-text linter (Plan v4 §Verification Plan #4).
//
// Tax surfaces must render the estimates disclaimer either via the
// <EstimatesDisclaimer> component or as a literal string. The literal
// fallback exists for emails / PDF exports where the React component is
// not available.
//
// Phase A.7 reality: `app/[locale]/(app)/tax/` does not exist yet.
// Phase D entry: tax routes land → linter scans them.
//
// Run: `pnpm lint:legal-text`

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Hebrew disclaimer literal as defined in Plan v4 §Tax Positioning.
const HE_DISCLAIMER = "אומדנים בלבד · אינו ייעוץ מס";
const EN_DISCLAIMER = "Estimates only";

// Component import marker — any of these in a file means the page uses
// the shared disclaimer banner.
const COMPONENT_MARKERS = [
  "EstimatesDisclaimer",
  "TaxDisclaimer",
];

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip Next.js build output and node_modules.
      if (entry.name === "node_modules" || entry.name.startsWith(".next")) continue;
      yield* walk(full);
    } else if (entry.isFile() && /\.(t|j)sx?$/.test(entry.name)) {
      yield full;
    }
  }
}

function fileSatisfiesDisclaimer(file: string): boolean {
  const content = fs.readFileSync(file, "utf8");
  if (COMPONENT_MARKERS.some((m) => content.includes(m))) return true;
  if (content.includes(HE_DISCLAIMER)) return true;
  if (content.includes(EN_DISCLAIMER)) return true;
  return false;
}

function main(): number {
  // Targets:
  //   1. Tax app routes per locale: app/[locale]/(app)/tax/**
  //   2. Shared legal components: components/app/legal/**
  const targets: string[] = [];

  const taxRoot = path.join(repoRoot, "app", "[locale]", "(app)", "tax");
  const legalRoot = path.join(repoRoot, "components", "app", "legal");

  for (const dir of [taxRoot, legalRoot]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      // Only scan page/layout/component entry points. Helper files are
      // assumed not to render disclaimer-bearing surfaces directly.
      if (/(page|layout|template)\.(t|j)sx?$/.test(file) || /components\/app\/legal/.test(file)) {
        targets.push(file);
      }
    }
  }

  if (targets.length === 0) {
    console.log(
      "lint:legal-text OK — no tax-page surfaces present yet (Phase A.7).",
    );
    return 0;
  }

  const missing: string[] = [];
  for (const file of targets) {
    if (!fileSatisfiesDisclaimer(file)) {
      missing.push(path.relative(repoRoot, file));
    }
  }

  if (missing.length > 0) {
    console.error("\nlint:legal-text FAILED — disclaimer missing in:");
    for (const f of missing) console.error(`  - ${f}`);
    console.error(
      "\nEvery tax surface must render <EstimatesDisclaimer> or include the literal disclaimer string.",
    );
    return 1;
  }

  console.log(`lint:legal-text OK — ${targets.length} surfaces checked.`);
  return 0;
}

process.exit(main());
