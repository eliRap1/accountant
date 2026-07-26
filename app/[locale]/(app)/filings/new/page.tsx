import { sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { withServiceRole } from "@/lib/db/withServiceRole";
import EstimatesDisclaimerBanner from "@/components/app/legal/EstimatesDisclaimerBanner.server";
import FilingWizard, {
  type BusinessOption,
  type WizardEntitlements,
} from "./FilingWizard";

// /filings/new — the create wizard.
//
// Server boundary: loads the user's businesses + plan entitlements + the
// auth user's role (admin-vs-user gate for the spec-unverified
// acknowledgement). The client wizard handles all the step state.

type EntitlementBoolRow = { key: string; value_bool: boolean | null };
type RoleRow = { role: string | null };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.filings" });
  return { title: t("metaTitle") };
}

export default async function NewFilingPage() {
  const me = await requireCurrentUser();

  const { businesses, entitlements, isAdmin } = await withUser(
    me.appUserId,
    async (tx) => {
      const bs = (await tx.execute(
        sql`SELECT id::text AS id,
                   legal_name AS "legalName",
                   vat_status::text AS "vatStatus",
                   default_currency AS "defaultCurrency"
              FROM businesses
              WHERE deleted_at IS NULL
              ORDER BY legal_name ASC`,
      )) as unknown as BusinessOption[];

      const entRows = await withServiceRole(async (svc) => {
        return (await svc.execute(
          sql`SELECT pe.key, pe.value_bool
                FROM plan_entitlements pe
                JOIN subscriptions s ON s.plan_id = pe.plan_id
               WHERE s.user_id = ${me.appUserId}::uuid
                 AND s.status IN ('active','trialing')
                 AND pe.key IN ('filings.pcn874', 'filings.form_exports')
               ORDER BY s.created_at DESC`,
        )) as unknown as EntitlementBoolRow[];
      });

      let canPcn = false;
      let canForms = false;
      for (const row of entRows) {
        if (row.key === "filings.pcn874" && row.value_bool) canPcn = true;
        if (row.key === "filings.form_exports" && row.value_bool) canForms = true;
      }
      if (entRows.length === 0) {
        const free = await withServiceRole(async (svc) => {
          return (await svc.execute(
            sql`SELECT key, value_bool
                  FROM plan_entitlements
                  WHERE plan_id = 'free'
                    AND key IN ('filings.pcn874', 'filings.form_exports')`,
          )) as unknown as EntitlementBoolRow[];
        });
        for (const row of free) {
          if (row.key === "filings.pcn874" && row.value_bool) canPcn = true;
          if (row.key === "filings.form_exports" && row.value_bool) canForms = true;
        }
      }

      const roleRows = await withServiceRole(async (svc) => {
        return (await svc.execute(
          sql`SELECT role
                FROM "user"
                WHERE id = ${me.authUserId}
                LIMIT 1`,
        )) as unknown as RoleRow[];
      });
      const role = roleRows[0]?.role ?? null;
      const admin = role === "admin";

      return {
        businesses: bs,
        entitlements: { canPcn, canForms } satisfies WizardEntitlements,
        isAdmin: admin,
      };
    },
  );

  // The spec-acknowledge checkbox is shown when:
  //   - the env is non-production (staging / development), OR
  //   - the current user has role='admin'.
  // In production with a regular user the checkbox is hidden — the
  // generators all throw `SpecNotVerified` which we surface as the
  // localised "specUnverified" error in the wizard's review step.
  const isProduction = process.env["NODE_ENV"] === "production";
  const showAcknowledge = !isProduction || isAdmin;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 space-y-6">
      <EstimatesDisclaimerBanner />
      <FilingWizard
        businesses={businesses}
        entitlements={entitlements}
        showAcknowledgeCheckbox={showAcknowledge}
      />
    </div>
  );
}
