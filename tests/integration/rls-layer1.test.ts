import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isRealNeonDb } from "./_helpers";
import { withUser } from "@/lib/db/withUser";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { users } from "@/db/schema/identity";
import { businesses } from "@/db/schema/businesses";
import { accountantEngagements } from "@/db/schema/engagements";
import { user as authUser } from "@/db/schema/auth";

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

// Per-run tag so seed rows can be cleaned up even if a test bails
// mid-flight. Each row carries this in its email / legal_name / vat_id.
const TAG_PREFIX = `rls-${randomUUID().slice(0, 8)}-`;

type Seed = {
  authUserAId: string;
  authUserBId: string;
  appUserAId: string;
  appUserBId: string;
};

const state: Partial<Seed> = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/rls-layer1] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL (run pnpm db:migrate first).",
  );
}

describeOrSkip("RLS Layer 1 — withUser + withServiceRole + engagements", () => {
  beforeAll(async () => {
    // Seed two Better Auth users (parent rows) + two app users (child rows)
    // entirely through the service role so RLS is bypassed for setup.
    await withServiceRole(async (tx) => {
      const aAuthId = `${TAG_PREFIX}A-${randomUUID()}`;
      const bAuthId = `${TAG_PREFIX}B-${randomUUID()}`;

      await tx.insert(authUser).values([
        {
          id: aAuthId,
          name: `${TAG_PREFIX}A`,
          email: `${TAG_PREFIX}A@example.test`,
          emailVerified: true,
        },
        {
          id: bAuthId,
          name: `${TAG_PREFIX}B`,
          email: `${TAG_PREFIX}B@example.test`,
          emailVerified: true,
        },
      ]);

      const insertedA = await tx
        .insert(users)
        .values({ authUserId: aAuthId })
        .returning({ id: users.id });
      const insertedB = await tx
        .insert(users)
        .values({ authUserId: bAuthId })
        .returning({ id: users.id });

      const aId = insertedA[0]?.id;
      const bId = insertedB[0]?.id;
      if (!aId || !bId) throw new Error("seed: missing returning() id");

      state.authUserAId = aAuthId;
      state.authUserBId = bAuthId;
      state.appUserAId = aId;
      state.appUserBId = bId;
    });
  });

  afterAll(async () => {
    if (!state.appUserAId && !state.appUserBId) return;
    await withServiceRole(async (tx) => {
      // FK cascade from accountant_engagements / businesses to users
      // handles most rows; we explicitly delete what we know we seeded
      // so a partial test failure does not orphan rows.
      const ids = [state.appUserAId, state.appUserBId].filter(
        (x): x is string => Boolean(x),
      );
      if (ids.length > 0) {
        for (const id of ids) {
          await tx.execute(sql`DELETE FROM accountant_engagements WHERE accountant_user_id = ${id} OR business_id IN (SELECT id FROM businesses WHERE owner_user_id = ${id})`);
          await tx.execute(sql`DELETE FROM businesses WHERE owner_user_id = ${id}`);
          await tx.execute(sql`DELETE FROM users WHERE id = ${id}`);
        }
      }
      const authIds = [state.authUserAId, state.authUserBId].filter(
        (x): x is string => Boolean(x),
      );
      for (const id of authIds) {
        await tx.execute(sql`DELETE FROM "user" WHERE id = ${id}`);
      }
    });
  });

  it("A sees only their own users row through withUser", async () => {
    const rows = await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(sql`SELECT id FROM users`) as unknown as Array<{
        id: string;
      }>;
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(state.appUserAId);
  });

  it("A sees zero businesses before any are inserted", async () => {
    const rows = await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(sql`SELECT id FROM businesses`) as unknown as Array<{
        id: string;
      }>;
    });
    expect(rows.length).toBe(0);
  });

  it("after engagement: B can see A's business; revocation removes access", async () => {
    // Step 1 — A creates a business through withUser (uses RLS path).
    const businessId = await withUser(state.appUserAId!, async (tx) => {
      const inserted = await tx
        .insert(businesses)
        .values({
          ownerUserId: state.appUserAId!,
          legalName: `${TAG_PREFIX}biz-A`,
          vatId: `${TAG_PREFIX}vat`,
          entityType: "morshe",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "single_entry",
        })
        .returning({ id: businesses.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error("business insert returned no id");
      return id;
    });

    // Step 2 — B should NOT see it yet (no engagement).
    const beforeEng = await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(sql`SELECT id FROM businesses`) as unknown as Array<{
        id: string;
      }>;
    });
    expect(beforeEng.some((r) => r.id === businessId)).toBe(false);

    // Step 3 — A invites + B is recorded as accepted via service role
    // (the user-facing accept flow lives in app code; we shortcut here
    // because we are testing the policy, not the route).
    let engagementId = "";
    await withServiceRole(async (tx) => {
      const inserted = await tx
        .insert(accountantEngagements)
        .values({
          businessId,
          accountantUserId: state.appUserBId!,
          role: "accountant",
          acceptedAt: new Date(),
        })
        .returning({ id: accountantEngagements.id });
      engagementId = inserted[0]?.id ?? "";
    });
    expect(engagementId).not.toBe("");

    // Step 4 — B now sees A's business through the engagement policy.
    const afterEng = await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(sql`SELECT id FROM businesses`) as unknown as Array<{
        id: string;
      }>;
    });
    expect(afterEng.some((r) => r.id === businessId)).toBe(true);

    // Step 5 — Revoke the engagement. B loses access immediately.
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`UPDATE accountant_engagements SET revoked_at = now() WHERE id = ${engagementId}`,
      );
    });

    const afterRevoke = await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(sql`SELECT id FROM businesses`) as unknown as Array<{
        id: string;
      }>;
    });
    expect(afterRevoke.some((r) => r.id === businessId)).toBe(false);
  });

  it("A cannot insert into auth_events (service-role only)", async () => {
    await expect(
      withUser(state.appUserAId!, async (tx) => {
        await tx.execute(
          sql`INSERT INTO auth_events (user_id, event_type) VALUES (${state.appUserAId}, 'sign_in')`,
        );
      }),
    ).rejects.toThrow();
  });

  it("A can SELECT from plans (public read)", async () => {
    const rows = await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(sql`SELECT id FROM plans LIMIT 5`) as unknown as Array<{
        id: string;
      }>;
    });
    // The 0003 migration / db:seed step inserts the 5 tiers; we accept
    // either "seeded" or "not seeded yet" as long as the SELECT itself
    // does not error.
    expect(Array.isArray(rows)).toBe(true);
  });
});
