import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { FileArchive } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withServiceRole } from "@/lib/db/withServiceRole";
import AuditPackageList, { type AuditPackageRow } from "./AuditPackageList";

// /[locale]/audit — list every audit package the current user can see,
// across every business they own OR every business they have an
// accountant engagement on with filings + ledger scopes.
//
// We service-role this lookup because the owner-only RLS on
// audit_packages would otherwise hide rows from an engaged accountant
// even though Council § Q3 says they're allowed to read. The query
// re-imposes the same authority gate at the SELECT predicate.

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.audit" });
  return { title: t("metaTitle") };
}

export default async function AuditPage(_props: Props) {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.audit");

  const rows: AuditPackageRow[] = await withServiceRole(async (tx) => {
    const result = (await tx.execute(
      sql`SELECT
            ap.id::text AS id,
            ap.business_id::text AS "businessId",
            b.legal_name AS "businessName",
            ap.period_start AS "periodStart",
            ap.period_end AS "periodEnd",
            ap.generated_at AS "generatedAt",
            ap.total_artifacts AS "totalArtifacts",
            ap.file_blob_url AS "fileBlobUrl",
            ap.file_key_id AS "fileKeyId"
          FROM audit_packages ap
          JOIN businesses b ON b.id = ap.business_id
          WHERE (
            b.owner_user_id = ${me.appUserId}::uuid
            OR EXISTS (
              SELECT 1
                FROM accountant_engagements e
               WHERE e.business_id = ap.business_id
                 AND e.accountant_user_id = ${me.appUserId}::uuid
                 AND e.accepted_at IS NOT NULL
                 AND e.revoked_at IS NULL
                 AND e.role = 'accountant'
                 AND (e.scopes_jsonb->>'filings')::boolean IS TRUE
                 AND (e.scopes_jsonb->>'ledger')::boolean IS TRUE
            )
          )
          AND b.deleted_at IS NULL
          ORDER BY ap.generated_at DESC
          LIMIT 100`,
    )) as unknown as AuditPackageRow[];
    return result;
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-emerald-300">
            <FileArchive size={18} aria-hidden />
            <span className="text-[11px] uppercase tracking-[0.22em] text-emerald-300/80">
              {t("eyebrow")}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            {t("subtitle")}
          </p>
        </div>
        <Link
          href="/audit/new"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
        >
          {t("addCta")}
        </Link>
      </header>

      <AuditPackageList rows={rows} />
    </div>
  );
}
