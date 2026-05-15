import { defineConfig } from "drizzle-kit";

// Node 20.6+ ships loadEnvFile natively; we pin node 24.x in package.json.
// drizzle-kit invokes this config without loading .env.local on its own.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local optional in CI / production (envs come from the host).
}

const databaseUrl =
  process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"];

if (!databaseUrl) {
  throw new Error(
    "drizzle-kit requires DATABASE_URL_UNPOOLED or DATABASE_URL in the environment",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dbCredentials: { url: databaseUrl },
  verbose: true,
  strict: true,
});
