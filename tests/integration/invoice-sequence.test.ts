import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { isRealNeonDb } from "./_helpers";
import { withUser } from "@/lib/db/withUser";
import { withServiceRole } from "@/lib/db/withServiceRole";
import { users } from "@/db/schema/identity";
import { businesses } from "@/db/schema/businesses";
import { user as authUser } from "@/db/schema/auth";

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

const TAG_PREFIX = `inv-${randomUUID().slice(0, 8)}-`;

const state: { authUserId?: string; appUserId?: string; businessId?: string } =
  {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/invoice-sequence] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

describeOrSkip("invoice sequence — conditional unique index", () => {
  beforeAll(async () => {
    await withServiceRole(async (tx) => {
      const aid = `${TAG_PREFIX}${randomUUID()}`;
      await tx.insert(authUser).values({
        id: aid,
        name: `${TAG_PREFIX}name`,
        email: `${TAG_PREFIX}@example.test`,
        emailVerified: true,
      });
      const insertedU = await tx
        .insert(users)
        .values({ authUserId: aid })
        .returning({ id: users.id });
      const uid = insertedU[0]?.id;
      if (!uid) throw new Error("seed: missing app user id");
      const insertedB = await tx
        .insert(businesses)
        .values({
          ownerUserId: uid,
          legalName: `${TAG_PREFIX}biz`,
          vatId: `${TAG_PREFIX}vat`,
          entityType: "morshe",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "double_entry",
        })
        .returning({ id: businesses.id });
      const bid = insertedB[0]?.id;
      if (!bid) throw new Error("seed: missing business id");
      state.authUserId = aid;
      state.appUserId = uid;
      state.businessId = bid;
    });
  });

  afterAll(async () => {
    if (!state.appUserId) return;
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`DELETE FROM invoices WHERE business_id = ${state.businessId!}`,
      );
      await tx.execute(
        sql`DELETE FROM businesses WHERE id = ${state.businessId!}`,
      );
      await tx.execute(sql`DELETE FROM users WHERE id = ${state.appUserId!}`);
      await tx.execute(sql`DELETE FROM "user" WHERE id = ${state.authUserId!}`);
    });
  });

  const baseInvoiceCols = sql.raw(
    "business_id, invoice_type, sequential_number, provider_kind, issue_date, subtotal_minor, vat_minor, total_minor, vat_rate, currency_at_issue, allocation_required_at_issue",
  );

  it("two internal invoices with same (business, type, seq) — second fails", async () => {
    await withUser(state.appUserId!, async (tx) => {
      await tx.execute(
        sql`INSERT INTO invoices (${baseInvoiceCols}) VALUES
          (${state.businessId}, 'tax_invoice', 1, 'internal', CURRENT_DATE, 1000, 180, 1180, 18, 'ILS', false)`,
      );
    });
    await expect(
      withUser(state.appUserId!, async (tx) => {
        await tx.execute(
          sql`INSERT INTO invoices (${baseInvoiceCols}) VALUES
            (${state.businessId}, 'tax_invoice', 1, 'internal', CURRENT_DATE, 2000, 360, 2360, 18, 'ILS', false)`,
        );
      }),
    ).rejects.toThrow();
  });

  it("internal + partner with same sequence — both succeed (provider differs)", async () => {
    // Use a fresh sequence number to avoid collision with the prior test.
    await withUser(state.appUserId!, async (tx) => {
      await tx.execute(
        sql`INSERT INTO invoices (${baseInvoiceCols}) VALUES
          (${state.businessId}, 'tax_invoice', 1000, 'internal', CURRENT_DATE, 100, 18, 118, 18, 'ILS', false)`,
      );
      // Partner-issued; the partial unique index has provider_kind = 'internal'
      // in the WHERE clause so a partner row with the same number is fine.
      await tx.execute(
        sql`INSERT INTO invoices (${baseInvoiceCols}) VALUES
          (${state.businessId}, 'tax_invoice', 1000, 'greenInvoice', CURRENT_DATE, 100, 18, 118, 18, 'ILS', false)`,
      );
    });
    const rows = (await withUser(state.appUserId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM invoices WHERE business_id = ${state.businessId} AND invoice_type='tax_invoice' AND sequential_number = 1000`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(rows.length).toBe(2);
  });

  it("cancelling an internal row frees the sequence slot", async () => {
    // Insert new internal at seq=2000, then cancel it, then re-insert same seq.
    const firstId = await withUser(state.appUserId!, async (tx) => {
      const r = (await tx.execute(
        sql`INSERT INTO invoices (${baseInvoiceCols}) VALUES
          (${state.businessId}, 'tax_invoice', 2000, 'internal', CURRENT_DATE, 100, 18, 118, 18, 'ILS', false)
          RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return r[0]!.id;
    });
    await withUser(state.appUserId!, async (tx) => {
      await tx.execute(
        sql`UPDATE invoices SET cancelled_at = now(), cancellation_reason = 'test' WHERE id = ${firstId}`,
      );
    });
    // Second insert with the same number should now succeed because the
    // partial unique index has cancelled_at IS NULL in its WHERE clause.
    await withUser(state.appUserId!, async (tx) => {
      await tx.execute(
        sql`INSERT INTO invoices (${baseInvoiceCols}) VALUES
          (${state.businessId}, 'tax_invoice', 2000, 'internal', CURRENT_DATE, 100, 18, 118, 18, 'ILS', false)`,
      );
    });
    const rows = (await withUser(state.appUserId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM invoices WHERE business_id = ${state.businessId} AND invoice_type='tax_invoice' AND sequential_number = 2000 AND provider_kind='internal'`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(rows.length).toBe(2);
  });
});
