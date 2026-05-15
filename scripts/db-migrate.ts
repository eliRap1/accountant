import { existsSync } from "node:fs";
import process from "node:process";
import { drizzle } from "drizzle-orm/postgres-js";

// Node 20.6+: read .env.local without a dotenv dependency.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env["DATABASE_URL_UNPOOLED"] ?? process.env["DATABASE_URL"];
  if (!url) {
    console.error("Missing DATABASE_URL_UNPOOLED / DATABASE_URL in env");
    process.exit(1);
  }

  console.log("[db:migrate] connecting to Neon (unpooled)...");
  const sql = postgres(url, { max: 1, prepare: false });
  const db = drizzle(sql);

  try {
    console.log("[db:migrate] applying migrations from ./db/migrations ...");
    await migrate(db, { migrationsFolder: "./db/migrations" });
    console.log("[db:migrate] done.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[db:migrate] failed:", err);
  process.exit(1);
});
