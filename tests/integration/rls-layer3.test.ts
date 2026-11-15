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

// RLS Layer 3 — tax filings + payroll + compliance + audit packages.
//
// Same isolation model as 0005 / rls-layer2:
//   * A and B own separate businesses
//   * A inserts a row of every Layer-3 table for businessA
//   * B sees zero rows from any of A's tables
//   * after engagement(A's biz, B) is accepted, B reads through (except
//     audit_packages which is owner-only by policy)
//   * after revoke, B loses access again
//
// We deliberately exercise the parent-EXISTS-gated tables
// (form_101_declarations via payroll_employees,
//  pension_contributions via payroll_runs,
//  client_wht_certificates via clients) so the policy expression is
// confirmed end-to-end, not just at the direct-business-id layer.

const HAS_DB = isRealNeonDb();
const describeOrSkip = HAS_DB ? describe : describe.skip;

const TAG_PREFIX = `rls3-${randomUUID().slice(0, 8)}-`;

type Seed = {
  authUserAId: string;
  authUserBId: string;
  appUserAId: string;
  appUserBId: string;
  businessAId: string;
  businessBId: string;
  clientAId: string;
  payrollEmployeeAId: string;
  payrollRunAId: string;
};

const state: Partial<Seed> = {};

if (!HAS_DB) {
  console.warn(
    "[tests/integration/rls-layer3] SKIPPING — DATABASE_URL_UNPOOLED is not a Neon URL.",
  );
}

describeOrSkip("RLS Layer 3 — tax-filings / payroll / compliance", () => {
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
      if (!aUid || !bUid) throw new Error("seed: missing user ids");

      const insertedBizA = await tx
        .insert(businesses)
        .values({
          ownerUserId: aUid,
          legalName: `${TAG_PREFIX}biz-A`,
          vatId: `${TAG_PREFIX}vat-A`,
          entityType: "hevra_baam",
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
          entityType: "hevra_baam",
          vatStatus: "osek_morshe",
          bookkeepingMethod: "double_entry",
        })
        .returning({ id: businesses.id });
      const aBid = insertedBizA[0]?.id;
      const bBid = insertedBizB[0]?.id;
      if (!aBid || !bBid) throw new Error("seed: missing business ids");

      // Seed a client for businessA so we can attach client_wht_certificates.
      const clientRows = (await tx.execute(
        sql`INSERT INTO clients (business_id, legal_name) VALUES (${aBid}, ${`${TAG_PREFIX}client-A`}) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const clientAId = clientRows[0]!.id;

      // Seed a payroll_employee + payroll_run for businessA so we can
      // attach form_101_declarations + pension_contributions.
      const employeeRows = (await tx.execute(
        sql`INSERT INTO payroll_employees
              (business_id, national_id_kind, start_date, bituach_leumi_class)
            VALUES (${aBid}, 'teudat_zehut', CURRENT_DATE, 'employee_regular')
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const payrollEmployeeAId = employeeRows[0]!.id;

      const runRows = (await tx.execute(
        sql`INSERT INTO payroll_runs
              (business_id, period_label, period_start, period_end)
            VALUES (${aBid}, '2026-01', '2026-01-01', '2026-01-31')
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const payrollRunAId = runRows[0]!.id;

      state.authUserAId = aAuthId;
      state.authUserBId = bAuthId;
      state.appUserAId = aUid;
      state.appUserBId = bUid;
      state.businessAId = aBid;
      state.businessBId = bBid;
      state.clientAId = clientAId;
      state.payrollEmployeeAId = payrollEmployeeAId;
      state.payrollRunAId = payrollRunAId;
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
        await tx.execute(
          sql`DELETE FROM businesses WHERE owner_user_id = ${id}`,
        );
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
  // tax_filings — direct business_id, owner mutates, accountant reads.
  // ============================================================================
  it("tax_filings: B cannot see A's filing", async () => {
    const filingId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO tax_filings
              (business_id, kind, period_start, period_end, generated_by_user_id)
            VALUES (${state.businessAId}, 'pcn874', '2026-01-01', '2026-01-31', ${state.appUserAId})
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM tax_filings WHERE id = ${filingId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);

    const seenByA = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM tax_filings WHERE id = ${filingId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByA.length).toBe(1);
  });

  it("tax_filings: B cannot INSERT into A's business", async () => {
    await expect(
      withUser(state.appUserBId!, async (tx) => {
        await tx.execute(
          sql`INSERT INTO tax_filings
                (business_id, kind, period_start, period_end, generated_by_user_id)
              VALUES (${state.businessAId}, 'pcn874', '2026-02-01', '2026-02-28', ${state.appUserBId})`,
        );
      }),
    ).rejects.toThrow();
  });

  // ============================================================================
  // tax_advances
  // ============================================================================
  it("tax_advances: isolation", async () => {
    const advId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO tax_advances
              (business_id, period_start, period_end, declared_revenue_minor, rate_pct, amount_due_minor)
            VALUES (${state.businessAId}, '2026-01-01', '2026-01-31', 4000000, 8.50, 340000)
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM tax_advances WHERE id = ${advId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);
  });

  // ============================================================================
  // client_wht_certificates — gated via clients.business_id.
  // ============================================================================
  it("client_wht_certificates: isolation via parent client", async () => {
    const certId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO client_wht_certificates
              (client_id, rate_pct, valid_from)
            VALUES (${state.clientAId}, 3.00, '2026-01-01')
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM client_wht_certificates WHERE id = ${certId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);
  });

  // ============================================================================
  // supplier_wht_rates
  // ============================================================================
  it("supplier_wht_rates: isolation", async () => {
    const rateId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO supplier_wht_rates
              (business_id, rate_pct, valid_from)
            VALUES (${state.businessAId}, 5.00, '2026-01-01')
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM supplier_wht_rates WHERE id = ${rateId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);
  });

  // ============================================================================
  // payroll_employees + payroll_runs
  // ============================================================================
  it("payroll_employees: isolation", async () => {
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM payroll_employees WHERE id = ${state.payrollEmployeeAId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);
  });

  it("payroll_runs: isolation", async () => {
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM payroll_runs WHERE id = ${state.payrollRunAId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);
  });

  // ============================================================================
  // form_101_declarations — gated via payroll_employees.business_id.
  // ============================================================================
  it("form_101_declarations: isolation via parent employee", async () => {
    const declId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO form_101_declarations
              (payroll_employee_id, fiscal_year)
            VALUES (${state.payrollEmployeeAId}, 2026)
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM form_101_declarations WHERE id = ${declId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);
  });

  // ============================================================================
  // pension_contributions — gated via payroll_runs.business_id.
  // ============================================================================
  it("pension_contributions: isolation via parent run", async () => {
    const contribId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO pension_contributions
              (payroll_run_id, payroll_employee_id, employee_contribution_minor, employer_contribution_minor)
            VALUES (${state.payrollRunAId}, ${state.payrollEmployeeAId}, 60000, 80000)
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM pension_contributions WHERE id = ${contribId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);
  });

  // ============================================================================
  // severance_provisions
  // ============================================================================
  it("severance_provisions: isolation", async () => {
    const provId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO severance_provisions
              (business_id, payroll_employee_id, period_start, period_end, accrued_minor)
            VALUES (${state.businessAId}, ${state.payrollEmployeeAId}, '2026-01-01', '2026-01-31', 50000)
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM severance_provisions WHERE id = ${provId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);
  });

  // ============================================================================
  // owner_compensation — owner_user_id check on INSERT
  // ============================================================================
  it("owner_compensation: isolation + INSERT requires owner_user_id = self", async () => {
    const ocId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO owner_compensation
              (business_id, owner_user_id, kind, amount_minor, period_start, period_end)
            VALUES (${state.businessAId}, ${state.appUserAId}, 'salary', 1500000, '2026-01-01', '2026-01-31')
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM owner_compensation WHERE id = ${ocId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);

    // A cannot insert claiming B as owner.
    await expect(
      withUser(state.appUserAId!, async (tx) => {
        await tx.execute(
          sql`INSERT INTO owner_compensation
                (business_id, owner_user_id, kind, amount_minor, period_start, period_end)
              VALUES (${state.businessAId}, ${state.appUserBId}, 'salary', 1, '2026-01-01', '2026-01-31')`,
        );
      }),
    ).rejects.toThrow();
  });

  // ============================================================================
  // risk_flags
  // ============================================================================
  it("risk_flags: isolation", async () => {
    const flagId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO risk_flags
              (business_id, kind, severity)
            VALUES (${state.businessAId}, 'round_number', 'info')
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM risk_flags WHERE id = ${flagId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);
  });

  // ============================================================================
  // inventory_counts — counted_by_user_id check
  // ============================================================================
  it("inventory_counts: isolation + counted_by must be self", async () => {
    const cntId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO inventory_counts
              (business_id, count_date, total_value_minor, counted_by_user_id)
            VALUES (${state.businessAId}, '2026-01-31', 250000, ${state.appUserAId})
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });
    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM inventory_counts WHERE id = ${cntId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByB.length).toBe(0);
  });

  // ============================================================================
  // audit_packages — owner-only (engaged accountant should NOT see).
  // ============================================================================
  it("audit_packages: owner-only — engaged accountant CANNOT see", async () => {
    // A inserts an audit package.
    const pkgId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO audit_packages
              (business_id, period_start, period_end, generated_by_user_id, total_artifacts)
            VALUES (${state.businessAId}, '2026-01-01', '2026-01-31', ${state.appUserAId}, 0)
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });

    // Engage B (clean any prior engagement).
    await withServiceRole(async (tx) => {
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

    const seenByB = (await withUser(state.appUserBId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM audit_packages WHERE id = ${pkgId}`,
      );
    })) as unknown as Array<{ id: string }>;
    // Engaged accountant should NOT see audit packages (owner-only).
    expect(seenByB.length).toBe(0);

    // Owner still sees.
    const seenByA = (await withUser(state.appUserAId!, async (tx) => {
      return tx.execute(
        sql`SELECT id FROM audit_packages WHERE id = ${pkgId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(seenByA.length).toBe(1);
  });

  // ============================================================================
  // Engagement read-through — once B is engaged on A's business, B sees
  // A's tax_filings; after revoke, B loses access.
  // ============================================================================
  it("engagement: B gains read access to tax_filings after acceptance, loses on revoke", async () => {
    const filingId = await withUser(state.appUserAId!, async (tx) => {
      const rows = (await tx.execute(
        sql`INSERT INTO tax_filings
              (business_id, kind, period_start, period_end, generated_by_user_id)
            VALUES (${state.businessAId}, 'form_102', '2026-02-01', '2026-02-28', ${state.appUserAId})
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    });

    // Ensure B has an active engagement (clean any prior).
    let engagementId = "";
    await withServiceRole(async (tx) => {
      await tx.execute(
        sql`DELETE FROM accountant_engagements WHERE business_id = ${state.businessAId} AND accountant_user_id = ${state.appUserBId}`,
      );
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
        sql`SELECT id FROM tax_filings WHERE id = ${filingId}`,
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
        sql`SELECT id FROM tax_filings WHERE id = ${filingId}`,
      );
    })) as unknown as Array<{ id: string }>;
    expect(afterRevoke.length).toBe(0);
  });
});
