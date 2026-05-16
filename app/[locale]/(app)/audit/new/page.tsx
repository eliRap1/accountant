import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withServiceRole } from "@/lib/db/withServiceRole";
import NewAuditPackageForm from "./NewAuditPackageForm";

// /[locale]/audit/new — period picker → triggers /api/audit/build →
// poll status → "download" handoff. Lists every business the current
// user is authorized to build for (owner OR engagement with both
// filings & ledger scopes); the form picks one and a period window.

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.audit" });
  return { title: t("newTitle") };
}

type BusinessOption = { id: string; legalName: string };

export default async function NewAuditPackagePage(_props: Props) {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.audit");

  // Pull every business the user is authorized to build packages for
  // (same predicate as the list page). Service-role so the engaged
  // path bypasses owner-only RLS on `businesses` — they're allowed
  // to see the business name when the engagement is active.
  const businesses: BusinessOption[] = await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT id::text AS id, legal_name AS "legalName"
            FROM businesses b
           WHERE b.deleted_at IS NULL
             AND (
               b.owner_user_id = ${me.appUserId}::uuid
               OR EXISTS (
                 SELECT 1
                   FROM accountant_engagements e
                  WHERE e.business_id = b.id
                    AND e.accountant_user_id = ${me.appUserId}::uuid
                    AND e.accepted_at IS NOT NULL
                    AND e.revoked_at IS NULL
                    AND e.role = 'accountant'
                    AND (e.scopes_jsonb->>'filings')::boolean IS TRUE
                    AND (e.scopes_jsonb->>'ledger')::boolean IS TRUE
               )
             )
           ORDER BY legal_name ASC`,
    )) as unknown as BusinessOption[];
    return rows;
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          {t("newTitle")}
        </h1>
        <p className="mt-1 text-sm text-slate-400">{t("formIntro")}</p>
      </header>

      {businesses.length === 0 ? (
        <div className="glass-strong rounded-2xl p-6 text-center">
          <p className="text-sm text-slate-300">{t("noBusinessYet")}</p>
        </div>
      ) : (
        <NewAuditPackageForm businesses={businesses} />
      )}
    </div>
  );
}
