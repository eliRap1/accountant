/**
 * Regression test: empty-string date filter causes PostgreSQL
 * "invalid input syntax for type date: ''" error.
 *
 * The root cause: queries in the invoices / receipts / transactions list
 * pages used the pattern
 *
 *   AND (${from} = '' OR col >= ${from}::date)
 *
 * PostgreSQL evaluates the `::date` cast on the bound parameter eagerly —
 * even when the `= ''` branch makes it logically unreachable — so passing
 * an empty string raises ERROR 22007. The fix replaces empty string with
 * null and uses `IS NULL` as the guard.
 *
 * This test exercises the EXACT SQL that each page emits when the user
 * loads the page with NO date filters (the default state that triggered
 * the production breakage).
 */

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

const TAG = `page-date-${randomUUID().slice(0, 8)}-`;

type State = {
  appUserId: string;
  authUserId: string;
};

const state: Partial<State> = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/page-list-date-filter] SKIPPING — no real Neon DB.",
  );
}

describeOrSkip(
  "page list queries — empty date filters must not throw (regression for ::date '' bug)",
  () => {
    beforeAll(async () => {
      await withServiceRole(async (tx) => {
        const authId = `${TAG}${randomUUID()}`;
        await tx.insert(authUser).values({
          id: authId,
          name: TAG,
          email: `${TAG}@example.test`,
          emailVerified: true,
        });
        const [appUser] = await tx
          .insert(users)
          .values({ authUserId: authId })
          .returning({ id: users.id });
        state.appUserId = appUser!.id;
        state.authUserId = authId;

        // Seed one business so the businesses SELECT returns a row (ensures the
        // transaction isn't rolled back before the second query runs).
        await tx.insert(businesses).values({
          ownerUserId: appUser!.id,
          legalName: `${TAG}Co`,
          vatId: `${TAG}123`,
          entityType: "morshe",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "single_entry",
        });
      });
    });

    afterAll(async () => {
      const { appUserId, authUserId } = state;
      if (!appUserId || !authUserId) return;
      await withServiceRole(async (tx) => {
        await tx.execute(
          sql`DELETE FROM businesses WHERE owner_user_id = ${appUserId}::uuid`,
        );
        await tx.execute(
          sql`DELETE FROM users WHERE id = ${appUserId}::uuid`,
        );
        await tx.execute(
          sql`DELETE FROM "user" WHERE id = ${authUserId}`,
        );
      });
    });

    it("invoices page: null fromDate/toDate does not throw", async () => {
      const userId = state.appUserId!;
      const businessId = "";
      const fromDate: string | null = null; // empty filter → null
      const toDate: string | null = null;
      const allocation = "";

      await expect(
        withUser(userId, async (tx) => {
          await tx.execute(
            sql`SELECT id, legal_name AS "legalName"
                FROM businesses WHERE deleted_at IS NULL ORDER BY legal_name ASC`,
          );
          return tx.execute(
            sql`SELECT i.id, i.business_id AS "businessId",
                       b.legal_name AS "businessName",
                       i.invoice_type AS "invoiceType",
                       i.sequential_number AS "sequentialNumber",
                       i.issue_date AS "issueDate",
                       i.total_minor::text AS "totalMinor",
                       i.currency_at_issue AS "currencyAtIssue",
                       i.allocation_status AS "allocationStatus",
                       i.cancelled_at AS "cancelledAt",
                       c.legal_name AS "clientName"
                FROM invoices i
                JOIN businesses b ON b.id = i.business_id
                LEFT JOIN clients c ON c.id = i.client_id
                WHERE i.deleted_at IS NULL
                  AND (${businessId} = '' OR i.business_id::text = ${businessId})
                  AND (${fromDate}::date IS NULL OR i.issue_date >= ${fromDate}::date)
                  AND (${toDate}::date IS NULL OR i.issue_date <= ${toDate}::date)
                  AND (${allocation} = '' OR i.allocation_status::text = ${allocation})
                ORDER BY i.issue_date DESC, i.sequential_number DESC
                LIMIT 500`,
          );
        }),
      ).resolves.not.toThrow();
    });

    it("receipts page: null fromDate/toDate does not throw", async () => {
      const userId = state.appUserId!;
      const businessId = "";
      const status = "";
      const fromDate: string | null = null;
      const toDate: string | null = null;

      await expect(
        withUser(userId, async (tx) => {
          await tx.execute(
            sql`SELECT id, legal_name AS "legalName"
                FROM businesses WHERE deleted_at IS NULL ORDER BY legal_name ASC`,
          );
          return tx.execute(
            sql`SELECT r.id::text,
                       r.business_id::text AS "businessId",
                       b.legal_name AS "businessName",
                       r.status::text AS "status",
                       r.source::text AS "source",
                       r.parsed_amount_minor::text AS "parsedAmountMinor",
                       r.parsed_date::text AS "parsedDate",
                       r.category_code AS "categoryCode",
                       (r.ocr_text_ciphertext IS NOT NULL) AS "hasOcr",
                       to_char(r.created_at, 'YYYY-MM-DD') AS "createdAt"
                FROM receipts r
                JOIN businesses b ON b.id = r.business_id
                WHERE (${businessId} = '' OR r.business_id::text = ${businessId})
                  AND (${status} = '' OR r.status::text = ${status})
                  AND (${fromDate}::date IS NULL OR r.parsed_date >= ${fromDate}::date
                       OR (r.parsed_date IS NULL AND r.created_at >= ${fromDate}::date))
                  AND (${toDate}::date IS NULL OR r.parsed_date <= ${toDate}::date
                       OR (r.parsed_date IS NULL AND r.created_at <= ${toDate}::date))
                ORDER BY COALESCE(r.parsed_date, r.created_at::date) DESC, r.created_at DESC
                LIMIT 500`,
          );
        }),
      ).resolves.not.toThrow();
    });

    it("transactions page: null fromDate/toDate does not throw", async () => {
      const userId = state.appUserId!;
      const businessId = "";
      const fromDate: string | null = null;
      const toDate: string | null = null;

      await expect(
        withUser(userId, async (tx) => {
          await tx.execute(
            sql`SELECT id, legal_name AS "legalName"
                FROM businesses WHERE deleted_at IS NULL ORDER BY legal_name ASC`,
          );
          return tx.execute(
            sql`SELECT t.id, t.business_id AS "businessId",
                       b.legal_name AS "businessName",
                       t.direction, t.amount_minor::text AS "amountMinor",
                       t.currency, t.category_code AS "categoryCode",
                       COALESCE(coa.name_he, coa.name_en) AS "categoryName",
                       t.description, t.txn_date AS "txnDate",
                       t.source, fa.name AS "accountName"
                FROM transactions t
                JOIN businesses b ON b.id = t.business_id
                LEFT JOIN financial_accounts fa ON fa.id = t.financial_account_id
                LEFT JOIN chart_of_accounts coa
                  ON coa.code = t.category_code
                 AND (coa.business_id = t.business_id OR coa.business_id IS NULL)
                WHERE (${businessId} = '' OR t.business_id::text = ${businessId})
                  AND (${fromDate}::date IS NULL OR t.txn_date >= ${fromDate}::date)
                  AND (${toDate}::date IS NULL OR t.txn_date <= ${toDate}::date)
                ORDER BY t.txn_date DESC, t.created_at DESC
                LIMIT 500`,
          );
        }),
      ).resolves.not.toThrow();
    });

    it("invoices page: non-empty date filters work correctly", async () => {
      const userId = state.appUserId!;
      const businessId = "";
      const fromDate = "2020-01-01";
      const toDate = "2099-12-31";
      const allocation = "";

      // Must not throw, and any rows returned must have issue_date in range.
      const rows = await withUser(userId, async (tx) => {
        await tx.execute(
          sql`SELECT id, legal_name AS "legalName"
              FROM businesses WHERE deleted_at IS NULL ORDER BY legal_name ASC`,
        );
        return tx.execute(
          sql`SELECT i.id, i.issue_date AS "issueDate"
              FROM invoices i
              JOIN businesses b ON b.id = i.business_id
              WHERE i.deleted_at IS NULL
                AND (${businessId} = '' OR i.business_id::text = ${businessId})
                AND (${fromDate}::date IS NULL OR i.issue_date >= ${fromDate}::date)
                AND (${toDate}::date IS NULL OR i.issue_date <= ${toDate}::date)
                AND (${allocation} = '' OR i.allocation_status::text = ${allocation})
              LIMIT 500`,
        ) as unknown as Array<{ issueDate: string }>;
      });

      expect(Array.isArray(rows)).toBe(true);
      for (const r of rows) {
        expect(r.issueDate >= fromDate).toBe(true);
        expect(r.issueDate <= toDate).toBe(true);
      }
    });
  },
);
