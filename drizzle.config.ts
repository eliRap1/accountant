import { defineConfig } from "drizzle-kit";

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
