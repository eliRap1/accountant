import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isRealNeonDb } from "./_helpers";
import { withUser } from "@/lib/db/withUser";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { users } from "@/db/schema/identity";
import { businesses } from "@/db/schema/businesses";
import { accountantEngagements } from "@/db/schema/engagements";
import { coaErrataNotices } from "@/db/schema/coa-errata";
import { user as authUser } from "@/db/schema/auth";

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

// Distinguishable per-run prefix; the afterAll cleans rows tagged with it.
const TAG_PREFIX = `coa-errata-${randomUUID().slice(0, 8)}-`;

type Seed = {
  authUserAId: string;
  authUserBId: string;
  appUserAId: string;
  appUserBId: string;
  businessAId: string;
  businessBId: string;
};

const state: Partial<Seed> = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/coa-errata] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

describeOrSkip("CoA errata — 0009 + 0010 migrations + seed", () => {
  beforeAll(async () => {
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

      const insA = await tx
        .insert(users)
        .values({ authUserId: aAuthId })
        .returning({ id: users.id });
      const insB = await tx
        .insert(users)
        .values({ authUserId: bAuthId })
        .returning({ id: users.id });

      const aUid = insA[0]?.id;
      const bUid = insB[0]?.id;
      if (!aUid || !bUid) throw new Error("seed: missing returning() id");

      const bizA = await tx
        .insert(businesses)
        .values({
          ownerUserId: aUid,
          legalName: `${TAG_PREFIX}biz-A`,
          vatId: `${TAG_PREFIX}vat-A`,
          entityType: "morshe",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "single_entry",
        })
        .returning({ id: businesses.id });
      const bizB = await tx
        .insert(businesses)
        .values({
          ownerUserId: bUid,
          legalName: `${TAG_PREFIX}biz-B`,
          vatId: `${TAG_PREFIX}vat-B`,
          entityType: "morshe",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "single_entry",
        })
        .returning({ id: businesses.id });

      state.authUserAId = aAuthId;
      state.authUserBId = bAuthId;
      state.appUserAId = aUid;
      state.appUserBId = bUid;
      state.businessAId = bizA[0]!.id;
      state.businessBId = bizB[0]!.id;

      // Backfill the errata notice for each business — the 0010 migration's
      // backfill ran against whatever was in the DB at migration time;
      // businesses created AFTER the migration need an explicit insert here
      // (the application's post-business-create hook will own this in prod).
      await tx
        .insert(coaErrataNotices)
        .values([
          {
            businessId: bizA[0]!.id,
            errataVersion: "2026-05-16-coa-errata-v1",
            affectedCodes: [
              "1030",
              "2150",
              "7400",
              "7401",
              "7402",
              "7403",
              "7404",
              "7405",
              "8100",
              "8200",
              "8300",
              "8400",
              "8500",
              "1305",
              "2070",
              "2080",
            ],
          },
          {
            businessId: bizB[0]!.id,
            errataVersion: "2026-05-16-coa-errata-v1",
            affectedCodes: [
              "1030",
              "2150",
              "7400",
              "7401",
              "7402",
              "7403",
              "7404",
              "7405",
              "8100",
              "8200",
              "8300",
              "8400",
              "8500",
              "1305",
              "2070",
              "2080",
            ],
          },
        ])
        .onConflictDoNothing();
    });
  });

  afterAll(async () => {
    if (!state.appUserAId && !state.appUserBId) return;
    await withServiceRole(async (tx) => {
      const uids = [state.appUserAId, state.appUserBId].filter(
        (x): x is string => Boolean(x),
      );
      for (const id of uids) {
        await tx.execute(
          sql`DELETE FROM accountant_engagements WHERE accountant_user_id = ${id} OR business_id IN (SELECT id FROM businesses WHERE owner_user_id = ${id})`,
        );
        await tx.execute(sql`DELETE FROM businesses WHERE owner_user_id = ${id}`);
        await tx.execute(sql`DELETE FROM users WHERE id = ${id}`);
      }
      const authIds = [state.authUserAId, state.authUserBId].filter(
        (x): x is string => Boolean(x),
      );
      for (const id of authIds) {
        await tx.execute(sql`DELETE FROM "user" WHERE id = ${id}`);
      }
    });
  });

  // ============================================================================
  // 0009 — standard chart_of_accounts post-errata state
  // ============================================================================
  it("seed has exactly 60 standard chart_of_accounts codes", async () => {
    const rows = (await withServiceRole(async (tx) => {
      return tx.execute(
        sql`SELECT COUNT(*)::int AS c FROM chart_of_accounts WHERE business_id IS NULL`,
      );
    })) as unknown as Array<{ c: number }>;
    expect(rows[0]?.c).toBe(60);
  });

  it("code 1030 is reclassified as liability", async () => {
    const rows = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT type::text AS type, name_en FROM chart_of_accounts WHERE business_id IS NULL AND code = '1030'`,
      );
    })) as unknown as Array<{ type: string; name_en: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.type).toBe("liability");
    expect(rows[0]?.name_en).toMatch(/credit cards payable/i);
  });

  it("code 2150 is gone (or deactivated if journal_lines referenced it)", async () => {
    const rows = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT is_active FROM chart_of_accounts WHERE business_id IS NULL AND code = '2150'`,
      );
    })) as unknown as Array<{ is_active: boolean }>;
    // Either no row (clean drop) or one row with is_active = false (preserved).
    if (rows.length === 0) {
      expect(rows.length).toBe(0);
    } else {
      expect(rows[0]?.is_active).toBe(false);
    }
  });

  it("code 7400 is the parent; 7401-7405 sub-codes exist", async () => {
    const rows = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT code, name_en FROM chart_of_accounts WHERE business_id IS NULL AND code IN ('7400','7401','7402','7403','7404','7405') ORDER BY code`,
      );
    })) as unknown as Array<{ code: string; name_en: string }>;
    expect(rows.map((r) => r.code)).toEqual([
      "7400",
      "7401",
      "7402",
      "7403",
      "7404",
      "7405",
    ]);
    expect(rows[0]?.name_en).toMatch(/parent/i);
  });

  it("renumbered codes 8110 + 8510 keep old semantics; new 8100 + 8500 have new semantics", async () => {
    const rows = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT code, name_en FROM chart_of_accounts WHERE business_id IS NULL AND code IN ('8100','8110','8500','8510') ORDER BY code`,
      );
    })) as unknown as Array<{ code: string; name_en: string }>;
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r.name_en]));
    expect(byCode["8100"]).toMatch(/donations/i);
    expect(byCode["8110"]).toMatch(/interest/i);
    expect(byCode["8500"]).toMatch(/e-commerce/i);
    expect(byCode["8510"]).toMatch(/fx differences/i);
  });

  it("new codes 1305, 2070, 2080, 8200, 8300, 8400 are present", async () => {
    const rows = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT code FROM chart_of_accounts WHERE business_id IS NULL AND code IN ('1305','2070','2080','8200','8300','8400') ORDER BY code`,
      );
    })) as unknown as Array<{ code: string }>;
    expect(rows.map((r) => r.code)).toEqual([
      "1305",
      "2070",
      "2080",
      "8200",
      "8300",
      "8400",
    ]);
  });

  it("standard codes are visible to both businesses (engagement-free)", async () => {
    const seenByA = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT code FROM chart_of_accounts WHERE business_id IS NULL`,
      );
    })) as unknown as Array<{ code: string }>;
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT code FROM chart_of_accounts WHERE business_id IS NULL`,
      );
    })) as unknown as Array<{ code: string }>;
    expect(seenByA.length).toBe(60);
    expect(seenByB.length).toBe(60);
  });

  // ============================================================================
  // 0010 — coa_errata_notices
  // ============================================================================
  it("coa_errata_notices has a row per business for the 2026-05-16 errata", async () => {
    const rowA = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT errata_version, dismissed_at FROM coa_errata_notices WHERE business_id = ${state.businessAId}`,
      );
    })) as unknown as Array<{ errata_version: string; dismissed_at: Date | null }>;
    const rowB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT errata_version, dismissed_at FROM coa_errata_notices WHERE business_id = ${state.businessBId}`,
      );
    })) as unknown as Array<{ errata_version: string; dismissed_at: Date | null }>;
    expect(rowA.length).toBe(1);
    expect(rowA[0]?.errata_version).toBe("2026-05-16-coa-errata-v1");
    expect(rowA[0]?.dismissed_at).toBeNull();
    expect(rowB.length).toBe(1);
    expect(rowB[0]?.errata_version).toBe("2026-05-16-coa-errata-v1");
  });

  it("RLS: business B's owner cannot see business A's notice", async () => {
    const rows = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM coa_errata_notices WHERE business_id = ${state.businessAId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(rows.length).toBe(0);
  });

  it("engagement: viewer reads but cannot dismiss owner's notice", async () => {
    // Engage B as accountant on A's business.
    let engagementId = "";
    await withServiceRole(async (tx) => {
      // Clean prior engagement from any earlier test in this file.
      await tx.execute(
        sql`DELETE FROM accountant_engagements WHERE business_id = ${state.businessAId} AND accountant_user_id = ${state.appUserBId}`,
      );
      const ins = await tx
        .insert(accountantEngagements)
        .values({
          businessId: state.businessAId!,
          accountantUserId: state.appUserBId!,
          role: "accountant",
          acceptedAt: new Date(),
        })
        .returning({ id: accountantEngagements.id });
      engagementId = ins[0]!.id;
    });
    expect(engagementId).not.toBe("");

    // B can now SELECT.
    const seen = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM coa_errata_notices WHERE business_id = ${state.businessAId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seen.length).toBe(1);
    const noticeId = seen[0]!.id;

    // B (engaged accountant, not owner) tries to UPDATE — RLS denies.
    // RLS denies UPDATE silently by returning 0 affected rows (no error
    // thrown — `UPDATE … WHERE` with a USING clause that doesn't match
    // simply yields zero rows).
    await withUser(state.appUserBId!, async (tx) => {
      await tx.execute(
        sql`UPDATE coa_errata_notices SET dismissed_at = now(), dismissed_by_user_id = ${state.appUserBId} WHERE id = ${noticeId}`,
      );
    });
    const afterB = (await withServiceRole(async (tx) => {
      return tx.execute(
        sql`SELECT dismissed_at FROM coa_errata_notices WHERE id = ${noticeId}`,
      );
    })) as unknown as Array<{ dismissed_at: Date | null }>;
    expect(afterB[0]?.dismissed_at).toBeNull();

    // A (owner) dismisses — succeeds.
    await withUser(state.appUserAId!, async (tx) => {
      await tx.execute(
        sql`UPDATE coa_errata_notices SET dismissed_at = now(), dismissed_by_user_id = ${state.appUserAId} WHERE id = ${noticeId}`,
      );
    });
    const afterA = (await withServiceRole(async (tx) => {
      return tx.execute(
        sql`SELECT dismissed_at FROM coa_errata_notices WHERE id = ${noticeId}`,
      );
    })) as unknown as Array<{ dismissed_at: Date | null }>;
    expect(afterA[0]?.dismissed_at).not.toBeNull();
  });

  it("app_user cannot INSERT into coa_errata_notices (no policy)", async () => {
    await expect(
      withUser(state.appUserAId!, async (tx) => {
        await tx.execute(
          sql`INSERT INTO coa_errata_notices (business_id, errata_version, affected_codes)
              VALUES (${state.businessAId}, 'rogue-errata', ARRAY['1000']::text[])`,
        );
      }),
    ).rejects.toThrow();
  });
});
