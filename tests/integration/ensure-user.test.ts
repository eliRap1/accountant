import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isRealNeonDb } from "./_helpers";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { ensureAppUser } from "@/lib/auth/ensureUser";
import { user as authUser } from "@/db/schema/auth";

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

const TAG_PREFIX = `eu-${randomUUID().slice(0, 8)}-`;
const state: { authId?: string; appId?: string } = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/ensure-user] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

describeOrSkip("ensureAppUser idempotency", () => {
  beforeAll(async () => {
    const authId = `${TAG_PREFIX}${randomUUID()}`;
    await withServiceRole(async (tx) => {
      await tx.insert(authUser).values({
        id: authId,
        name: `${TAG_PREFIX}name`,
        email: `${TAG_PREFIX}user@example.test`,
        emailVerified: true,
      });
    });
    state.authId = authId;
  });

  afterAll(async () => {
    if (!state.authId) return;
    await withServiceRole(async (tx) => {
      if (state.appId) {
        await tx.execute(sql`DELETE FROM users WHERE id = ${state.appId}`);
      }
      await tx.execute(sql`DELETE FROM "user" WHERE id = ${state.authId!}`);
    });
  });

  it("creates an app user on first call", async () => {
    const result = await ensureAppUser({
      id: state.authId!,
      email: `${TAG_PREFIX}user@example.test`,
      emailVerified: true,
    });
    expect(result.appUserId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    state.appId = result.appUserId;
  });

  it("is idempotent — second call returns the same app user id", async () => {
    const result = await ensureAppUser({
      id: state.authId!,
      email: `${TAG_PREFIX}user@example.test`,
      emailVerified: true,
    });
    expect(result.appUserId).toBe(state.appId);

    // Belt-and-braces — assert only one row exists.
    const rows = await withServiceRole(async (tx) => {
      return tx.execute(
        sql`SELECT id FROM users WHERE auth_user_id = ${state.authId!}`,
      ) as unknown as Array<{ id: string }>;
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(state.appId);
  });
});
