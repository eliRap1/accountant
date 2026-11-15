import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withServiceRole } from "@/lib/db/withServiceRole";
import {
  assertCanBuildAuditPackage,
  AuditPackageAuthorityError,
} from "@/lib/audit/packageBuilder";
import AuditPackageDetailActions from "./AuditPackageDetailActions";

// /[locale]/audit/[id] — detail view of a single audit package, with
// the manifest summary + a download CTA (client-component handles the
// step-up flow and triggers GET /api/audit/[id]/download).

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.audit" });
  return { title: t("detailTitle") };
}

type Manifest = {
  artifactCount?: number;
  invoiceIds?: string[];
  receiptIds?: string[];
  transactionIds?: string[];
  taxFilingIds?: string[];
  payrollRunIds?: string[];
  ownerCompensationIds?: string[];
  bankReconciliationIds?: string[];
  riskFlagIds?: string[];
  sha256OfPlaintextZip?: string;
  generatedAt?: string;
  artifacts?: Array<{
    kind: string;
    refId: string;
    provenance: string;
    bytes: number;
  }>;
};

type PkgRow = {
  id: string;
  businessId: string;
  businessName: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  totalArtifacts: number;
  fileBlobUrl: string | null;
  fileKeyId: string | null;
  manifestJsonb: Manifest;
};

export default async function AuditPackageDetailPage(props: Props) {
  const { id } = await props.params;
  const me = await requireCurrentUser();
  const t = await getTranslations("app.audit");

  // Lookup row via service role (RLS would block engaged accountants).
  const pkg: PkgRow | null = await withServiceRole(async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT ap.id::text AS id,
                 ap.business_id::text AS "businessId",
                 b.legal_name AS "businessName",
                 ap.period_start AS "periodStart",
                 ap.period_end AS "periodEnd",
                 ap.generated_at AS "generatedAt",
                 ap.total_artifacts AS "totalArtifacts",
                 ap.file_blob_url AS "fileBlobUrl",
                 ap.file_key_id AS "fileKeyId",
                 ap.manifest_jsonb AS "manifestJsonb"
            FROM audit_packages ap
            JOIN businesses b ON b.id = ap.business_id
           WHERE ap.id = ${id}::uuid
           LIMIT 1`,
    )) as unknown as PkgRow[];
    return rows[0] ?? null;
  });

  if (!pkg) notFound();

  // Authority gate at the app layer (mirrors the API surface).
  try {
    await assertCanBuildAuditPackage(me.appUserId, pkg.businessId);
  } catch (err) {
    if (err instanceof AuditPackageAuthorityError) {
      notFound();
    }
    throw err;
  }

  const m = pkg.manifestJsonb ?? {};
  const counts: Array<{ label: string; value: number }> = [
    { label: t("counts.invoices"), value: (m.invoiceIds ?? []).length },
    { label: t("counts.receipts"), value: (m.receiptIds ?? []).length },
    { label: t("counts.transactions"), value: (m.transactionIds ?? []).length },
    { label: t("counts.taxFilings"), value: (m.taxFilingIds ?? []).length },
    { label: t("counts.payrollRuns"), value: (m.payrollRunIds ?? []).length },
    {
      label: t("counts.ownerCompensation"),
      value: (m.ownerCompensationIds ?? []).length,
    },
    {
      label: t("counts.bankReconciliations"),
      value: (m.bankReconciliationIds ?? []).length,
    },
    { label: t("counts.riskFlags"), value: (m.riskFlagIds ?? []).length },
  ];

  const isReady = Boolean(pkg.fileBlobUrl && pkg.fileKeyId);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link
        href="/audit"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-emerald-300"
      >
        <ArrowLeft size={14} />
        {t("backToList")}
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          {pkg.businessName}
        </h1>
        <p className="mt-1 text-sm text-slate-400" dir="ltr">
          {pkg.periodStart} → {pkg.periodEnd}
        </p>
      </header>

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="mb-4 text-xs uppercase tracking-[0.18em] text-slate-400">
          {t("manifestSummary")}
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          {counts.map((c) => (
            <div key={c.label}>
              <dt className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                {c.label}
              </dt>
              <dd className="mt-0.5 text-slate-100">{c.value}</dd>
            </div>
          ))}
          <div className="col-span-2 sm:col-span-4">
            <dt className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
              {t("counts.totalArtifacts")}
            </dt>
            <dd className="mt-0.5 text-slate-100">{pkg.totalArtifacts}</dd>
          </div>
          {m.sha256OfPlaintextZip && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                {t("sha256")}
              </dt>
              <dd
                className="mt-0.5 break-all font-mono text-[11px] text-slate-300"
                dir="ltr"
              >
                {m.sha256OfPlaintextZip}
              </dd>
            </div>
          )}
        </dl>

        <div className="mt-6 border-t border-white/10 pt-4">
          <AuditPackageDetailActions packageId={pkg.id} isReady={isReady} />
        </div>
      </section>
    </div>
  );
}
