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

const TAG_PREFIX = `rls2-${randomUUID().slice(0, 8)}-`;

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
    "[tests/integration/rls-layer2] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

describeOrSkip("RLS Layer 2 — clients / ledger / invoicing / money-flows", () => {
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

      const insertedA = await tx
        .insert(users)
        .values({ authUserId: aAuthId })
        .returning({ id: users.id });
      const insertedB = await tx
        .insert(users)
        .values({ authUserId: bAuthId })
        .returning({ id: users.id });

      const aUid = insertedA[0]?.id;
      const bUid = insertedB[0]?.id;
      if (!aUid || !bUid) throw new Error("seed: missing returning() id");

      const insertedBizA = await tx
        .insert(businesses)
        .values({
          ownerUserId: aUid,
          legalName: `${TAG_PREFIX}biz-A`,
          vatId: `${TAG_PREFIX}vat-A`,
          entityType: "morshe",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "double_entry",
        })
        .returning({ id: businesses.id });
      const insertedBizB = await tx
        .insert(businesses)
        .values({
          ownerUserId: bUid,
          legalName: `${TAG_PREFIX}biz-B`,
          vatId: `${TAG_PREFIX}vat-B`,
          entityType: "morshe",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "double_entry",
        })
        .returning({ id: businesses.id });

      const aBid = insertedBizA[0]?.id;
      const bBid = insertedBizB[0]?.id;
      if (!aBid || !bBid) throw new Error("seed: missing returning() biz id");

      state.authUserAId = aAuthId;
      state.authUserBId = bAuthId;
      state.appUserAId = aUid;
      state.appUserBId = bUid;
      state.businessAId = aBid;
      state.businessBId = bBid;
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
  // clients
  // ============================================================================
  it("clients: B cannot see A's clients", async () => {
    // A inserts a client.
    const clientId = await withUser(state.appUserAId!, async (tx) => {
      const inserted = (await tx.execute(
        sql`INSERT INTO clients (business_id, legal_name) VALUES (${state.businessAId}, ${`${TAG_PREFIX}client-A`}) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return inserted[0]!.id;
    });

    // B sees zero.
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM clients WHERE id = ${clientId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);

    // A sees their own.
    const seenByA = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM clients WHERE id = ${clientId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByA.length).toBe(1);
  });

  // ============================================================================
  // financial_accounts
  // ============================================================================
  it("financial_accounts: isolation + insert constraint", async () => {
    const acctId = await withUser(state.appUserAId!, async (tx) => {
      const inserted = (await tx.execute(
        sql`INSERT INTO financial_accounts (business_id, kind, name) VALUES (${state.businessAId}, 'bank', ${`${TAG_PREFIX}acct-A`}) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return inserted[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM financial_accounts WHERE id = ${acctId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);

    // B cannot insert into A's business.
    await expect(
      withUser(state.appUserBId!, async (tx) => {
        await tx.execute(
          sql`INSERT INTO financial_accounts (business_id, kind, name) VALUES (${state.businessAId}, 'bank', 'evil')`,
        );
      }),
    ).rejects.toThrow();
  });

  // ============================================================================
  // chart_of_accounts: public read of standard codes; private custom codes
  // ============================================================================
  it("chart_of_accounts: standard codes visible to both A and B", async () => {
    const seenByA = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT code FROM chart_of_accounts WHERE business_id IS NULL LIMIT 5`,
      );
    })) as unknown as Array<{ code: string }>;
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT code FROM chart_of_accounts WHERE business_id IS NULL LIMIT 5`,
      );
    })) as unknown as Array<{ code: string }>;
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByB.length).toBeGreaterThan(0);
  });

  it("chart_of_accounts: custom code private to its business", async () => {
    const customCode = `${TAG_PREFIX.slice(0, 4)}999`;
    await withUser(state.appUserAId!, async (tx) => {
      await tx.execute(
        sql`INSERT INTO chart_of_accounts (business_id, code, name_he, name_en, type) VALUES (${state.businessAId}, ${customCode}, 'משלם', 'Custom', 'asset')`,
      );
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT code FROM chart_of_accounts WHERE code = ${customCode}`,
      );
    })) as unknown as Array<{ code: string }>;
    expect(seenByB.length).toBe(0);
  });

  // ============================================================================
  // engagement read-access — once an accountant is engaged, they see A's data
  // ============================================================================
  it("engagement: B gains read access to A's clients after acceptance, loses on revoke", async () => {
    const clientId = await withUser(state.appUserAId!, async (tx) => {
      const inserted = (await tx.execute(
        sql`INSERT INTO clients (business_id, legal_name) VALUES (${state.businessAId}, ${`${TAG_PREFIX}eng-client`}) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return inserted[0]!.id;
    });

    // Before engagement, B sees nothing.
    const before = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM clients WHERE id = ${clientId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(before.length).toBe(0);

    let engagementId = "";
    await withServiceRole(async (tx) => {
      const inserted = await tx
        .insert(accountantEngagements)
        .values({
          businessId: state.businessAId!,
          accountantUserId: state.appUserBId!,
          role: "accountant",
          acceptedAt: new Date(),
        })
        .returning({ id: accountantEngagements.id });
      engagementId = inserted[0]?.id ?? "";
    });

    const after = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM clients WHERE id = ${clientId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(after.length).toBe(1);

    // Revoke.
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`UPDATE accountant_engagements SET revoked_at = now() WHERE id = ${engagementId}`,
      );
    });

    const afterRevoke = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM clients WHERE id = ${clientId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(afterRevoke.length).toBe(0);
  });

  // ============================================================================
  // Journal balance trigger — DEFERRABLE INITIALLY DEFERRED so the check
  // runs at COMMIT. An unbalanced entry must trigger when the outer
  // transaction commits; a balanced pair must succeed.
  // ============================================================================
  it("journal balance trigger: unbalanced entry fails at COMMIT", async () => {
    await expect(
      withUser(state.appUserAId!, async (tx) => {
        // Create a journal entry + a single debit-only line. The trigger
        // is DEFERRABLE INITIALLY DEFERRED — it fires on outer commit.
        const inserted = (await tx.execute(
          sql`INSERT INTO journal_entries (business_id, entry_date, source, created_by_user_id)
              VALUES (${state.businessAId}, CURRENT_DATE, 'manual', ${state.appUserAId})
              RETURNING id`,
        )) as unknown as Array<{ id: string }>;
        const entryId = inserted[0]!.id;
        // One debit-only line; no matching credit.
        await tx.execute(
          sql`INSERT INTO journal_lines (entry_id, account_code, debit_minor, credit_minor)
              VALUES (${entryId}, '1010', 1000, 0)`,
        );
      }),
    ).rejects.toThrow(/unbalanced/);
  });

  it("journal balance trigger: balanced pair commits", async () => {
    const entryId = await withUser(state.appUserAId!, async (tx) => {
      const inserted = (await tx.execute(
        sql`INSERT INTO journal_entries (business_id, entry_date, source, created_by_user_id)
            VALUES (${state.businessAId}, CURRENT_DATE, 'manual', ${state.appUserAId})
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const eid = inserted[0]!.id;
      await tx.execute(
        sql`INSERT INTO journal_lines (entry_id, account_code, debit_minor, credit_minor)
            VALUES (${eid}, '1010', 5000, 0), (${eid}, '4000', 0, 5000)`,
      );
      return eid;
    });
    expect(entryId).toBeTruthy();
  });

  // ============================================================================
  // Service-role tables: year_end_closes write denial via app_user
  // ============================================================================
  it("year_end_closes: app_user cannot INSERT (no policy granted)", async () => {
    await expect(
      withUser(state.appUserAId!, async (tx) => {
        await tx.execute(
          sql`INSERT INTO year_end_closes (business_id, fiscal_year, closed_by_user_id) VALUES (${state.businessAId}, 2025, ${state.appUserAId})`,
        );
      }),
    ).rejects.toThrow();
  });

  // ============================================================================
  // processor_sync_credentials: tighter than other tables — owner-only SELECT
  // (engaged accountant cannot read keys).
  // ============================================================================
  it("processor_sync_credentials: engaged accountant cannot SELECT", async () => {
    // Insert as A.
    await withUser(state.appUserAId!, async (tx) => {
      await tx.execute(
        sql`INSERT INTO processor_sync_credentials (business_id, processor, api_key_ciphertext)
            VALUES (${state.businessAId}, 'hyp', 'fake-ciphertext')`,
      );
    });
    // Engage B as accountant.
    await withServiceRole(async (tx) => {
      // Cleanup any prior engagement row from earlier tests.
      await tx.execute(
        sql`DELETE FROM accountant_engagements WHERE business_id = ${state.businessAId} AND accountant_user_id = ${state.appUserBId}`,
      );
      await tx.insert(accountantEngagements).values({
        businessId: state.businessAId!,
        accountantUserId: state.appUserBId!,
        role: "accountant",
        acceptedAt: new Date(),
      });
    });
    // B (engaged) should NOT see processor_sync_credentials — owner-only.
    const rows = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM processor_sync_credentials WHERE business_id = ${state.businessAId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(rows.length).toBe(0);
  });
});
