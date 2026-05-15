// Vitest global setup. Runs once per worker before the first test file.
//
// Loads `.env.local` (project secrets) via Node 20.6+ `process.loadEnvFile`
// so test code can rely on env() resolving the same way the app does in
// dev. We also pin NODE_ENV='test' which (a) suppresses instrumentation's
// selfTest call path, (b) lets `lib/env.ts` warn-not-throw on missing
// optional vars, and (c) gates integration tests on real DB env vars.

import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { afterAll } from "vitest";

const repoRoot = path.resolve(__dirname, "..");
const envFile = path.join(repoRoot, ".env.local");

if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (err) {
    // .env.local is intentionally optional in CI; warn but do not crash.
    console.warn("[tests/setup] could not load .env.local:", (err as Error).message);
  }
}

// Force test env so `lib/env.ts` falls back to warn-mode on missing
// optional vars and instrumentation skips the selfTest. Cast through
// the index signature because @types/node's NodeJS.ProcessEnv pins
// NODE_ENV to a read-only string literal.
(process.env as Record<string, string | undefined>)["NODE_ENV"] = "test";

// Stub DATA_ENCRYPTION_KEY for pure unit tests if absent. Integration
// tests that need the real KEK assert on env separately.
if (!process.env["DATA_ENCRYPTION_KEY"]) {
  // 32 zero bytes base64-encoded — deterministic, never used in prod.
  process.env["DATA_ENCRYPTION_KEY"] = Buffer.alloc(32).toString("base64");
}

// Stub BETTER_AUTH_SECRET so importing modules that pull `env()` does
// not warn-spam during pure unit tests.
if (!process.env["BETTER_AUTH_SECRET"]) {
  process.env["BETTER_AUTH_SECRET"] = "x".repeat(48);
}
if (!process.env["BETTER_AUTH_URL"]) {
  process.env["BETTER_AUTH_URL"] = "http://localhost:3000";
}
if (!process.env["DATABASE_URL"]) {
  process.env["DATABASE_URL"] = "postgres://user:pass@localhost:5432/test";
}
if (!process.env["DATABASE_URL_UNPOOLED"]) {
  // Leave undefined-equivalent so integration tests skip cleanly when no
  // live DB. We only set this fallback for env-schema validation, not as
  // a real connection target.
  process.env["DATABASE_URL_UNPOOLED"] ??= "postgres://user:pass@localhost:5432/test";
}

afterAll(async () => {
  // Best-effort close of any postgres-js pool the test imported. We do
  // not import db/client.ts at top level because most unit tests do not
  // need it. Integration tests close their own clients explicitly.
});
