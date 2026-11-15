import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { FileDown, CheckCircle2 } from "lucide-react";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import EstimatesDisclaimerBanner from "@/components/app/legal/EstimatesDisclaimerBanner.server";
import MarkSubmittedForm from "./MarkSubmittedForm";
import type { FilingKind, FilingStatus } from "../FilingList";

// /filings/:id — the per-row detail surface.
//
// Renders provenance (inputs jsonb), totals (totals jsonb), the
// download CTA (links to /api/filings/:id/download which is step-up
// gated), and an inline asmachta-paste form for marking the filing as
// submitted. The download button does NOT inline-decrypt — it sends the
// operator through the step-up modal flow.
//
// We never call this state "filed". Only "ready for portal upload",
// "downloaded", or "submitted to portal".

type Props = { params: Promise<{ id: string; locale: string }> };

type HeadRow = {
  id: string;
  businessId: string;
  businessName: string;
  kind: FilingKind;
  periodStart: string;
  periodEnd: string;
  generatedAt: Date | string;
  status: FilingStatus;
  submittedAt: Date | string | null;
  submittedAsmachta: string | null;
  fileMime: string | null;
  totalsJsonb: Record<string, unknown> | null;
  inputsJsonb: {
    invoiceIds?: string[];
    receiptIds?: string[];
    transactionIds?: string[];
    payrollRunIds?: string[];
    meta?: Record<string, unknown>;
  } | null;
  generatedByEmail: string | null;
};

export default async function FilingDetailPage(props: Props) {
  const { id } = await props.params;
  const me = await requireCurrentUser();
  const t = await getTranslations("app.filings");

  const head = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT tf.id::text AS id,
                 tf.business_id::text AS "businessId",
                 b.legal_name AS "businessName",
                 tf.kind::text AS kind,
                 tf.period_start::text AS "periodStart",
                 tf.period_end::text AS "periodEnd",
                 tf.generated_at AS "generatedAt",
                 tf.status::text AS status,
                 tf.submitted_at AS "submittedAt",
                 tf.submitted_asmachta AS "submittedAsmachta",
                 tf.file_mime AS "fileMime",
                 tf.totals_jsonb AS "totalsJsonb",
                 tf.inputs_jsonb AS "inputsJsonb",
                 (SELECT au.email FROM users u
                    JOIN "user" au ON au.id = u.auth_user_id
                   WHERE u.id = tf.generated_by_user_id
                   LIMIT 1) AS "generatedByEmail"
            FROM tax_filings tf
            JOIN businesses b ON b.id = tf.business_id
           WHERE tf.id = ${id}::uuid
           LIMIT 1`,
    )) as unknown as HeadRow[];
    return rows[0] ?? null;
  });

  if (!head) notFound();

  const generatedAtIso =
    head.generatedAt instanceof Date
      ? head.generatedAt.toISOString()
      : String(head.generatedAt);
  const submittedAtIso =
    head.submittedAt === null
      ? null
      : head.submittedAt instanceof Date
        ? head.submittedAt.toISOString()
        : String(head.submittedAt);

  const totals = head.totalsJsonb ?? {};
  const inputs = head.inputsJsonb ?? {};
  const invoiceCount = inputs.invoiceIds?.length ?? 0;
  const receiptCount = inputs.receiptIds?.length ?? 0;
  const transactionCount = inputs.transactionIds?.length ?? 0;
  const noInputs = invoiceCount + receiptCount + transactionCount === 0;
  const isSubmitted = head.status === "submitted";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 space-y-6">
      <EstimatesDisclaimerBanner />

      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t(`kindLabel.${head.kind}`)}
          </h1>
          <p className="mt-1 text-sm text-slate-400" dir="ltr">
            {head.periodStart} → {head.periodEnd} · {head.businessName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/filings/${head.id}/download`}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
          >
            <FileDown size={14} />
            {t("detail.downloadCta")}
          </a>
        </div>
      </header>

      {isSubmitted ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <CheckCircle2 size={14} className="text-amber-300" />
          {t("detail.submittedBanner")}
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200">
          {t("readyForPortalUpload")} — {t("neverFiled")}
        </div>
      )}

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("detail.headerSection")}
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
          <DescRow label={t("detail.business")}>{head.businessName}</DescRow>
          <DescRow label={t("detail.kind")}>
            {t(`kindLabel.${head.kind}`)}
          </DescRow>
          <DescRow label={t("detail.period")}>
            <span dir="ltr">
              {head.periodStart} → {head.periodEnd}
            </span>
          </DescRow>
          <DescRow label={t("detail.generatedAt")}>
            <span dir="ltr">{generatedAtIso.slice(0, 19).replace("T", " ")}</span>
          </DescRow>
          {head.generatedByEmail ? (
            <DescRow label={t("detail.generatedBy")}>
              <span dir="ltr">{head.generatedByEmail}</span>
            </DescRow>
          ) : null}
        </dl>
      </section>

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("detail.totalsSection")}
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          {Object.entries(totals).map(([k, v]) => (
            <DescRow key={k} label={k}>
              <span dir="ltr" className="text-slate-100">
                {formatScalar(v)}
              </span>
            </DescRow>
          ))}
          {Object.keys(totals).length === 0 ? (
            <p className="text-xs text-slate-500">—</p>
          ) : null}
        </dl>
      </section>

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("detail.inputsSection")}
        </h2>
        {noInputs ? (
          <p className="mt-3 text-xs text-slate-500">{t("detail.inputsEmpty")}</p>
        ) : (
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <DescRow label={t("detail.inputsInvoiceCount")}>
              <span dir="ltr">{invoiceCount}</span>
            </DescRow>
            <DescRow label={t("detail.inputsReceiptCount")}>
              <span dir="ltr">{receiptCount}</span>
            </DescRow>
            <DescRow label={t("detail.inputsTransactionCount")}>
              <span dir="ltr">{transactionCount}</span>
            </DescRow>
          </dl>
        )}
      </section>

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("detail.submittedHeading")}
        </h2>
        {isSubmitted ? (
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <DescRow label={t("detail.submittedAtLabel")}>
              <span dir="ltr">
                {submittedAtIso?.slice(0, 19).replace("T", " ") ?? "—"}
              </span>
            </DescRow>
            <DescRow label={t("detail.submittedAsmachtaLabel")}>
              <span dir="ltr">{head.submittedAsmachta ?? "—"}</span>
            </DescRow>
          </dl>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-slate-400">
              {t("detail.markSubmittedHelp")}
            </p>
            <MarkSubmittedForm filingId={head.id} />
          </div>
        )}
      </section>
    </div>
  );
}

function DescRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.16em] text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-slate-200">{children}</dd>
    </div>
  );
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "bigint") return v.toString();
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
