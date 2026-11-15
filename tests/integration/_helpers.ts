import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// Conditional skip helper. The default fallback DATABASE_URL_UNPOOLED in
// tests/setup.ts points at a fake "localhost:5432/test" string so the env
// schema validates. We treat anything that does not look like a Neon
// pooler / unpooled URL as "no real DB" and skip.
//
// Real Neon URLs look like:
//   postgres://USER:PASS@ep-<id>-pooler.eu-central-1.aws.neon.tech/...?...
//   postgres://USER:PASS@ep-<id>.eu-central-1.aws.neon.tech/...?...
export function isRealNeonDb(): boolean {
  const url = process.env["DATABASE_URL_UNPOOLED"];
  if (!url) return false;
  return /neon\.tech/.test(url);
}

export function loadEnvLocalIfPresent(): void {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const envFile = path.join(repoRoot, ".env.local");
  if (existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      /* ignore */
    }
  }
}

loadEnvLocalIfPresent();
