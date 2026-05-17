import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { FileDown, Ban } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import CancelInvoiceButton from "./CancelInvoiceButton";

type Props = { params: Promise<{ id: string; locale: string }> };

type HeadRow = {
  id: string;
  businessId: string;
  businessName: string;
  invoiceType:
    | "tax_invoice"
    | "tax_invoice_receipt"
    | "receipt"
    | "credit_note"
    | "proforma"
    | "debit_note"
    | "self_invoice";
  sequentialNumber: number;
  issueDate: string;
  dueDate: string | null;
  totalMinor: string;
  subtotalMinor: string;
  vatMinor: string;
  vatRate: string;
  currencyAtIssue: string;
  allocationStatus: string;
  allocationNumber: string | null;
  cancelledAt: Date | string | null;
  cancellationReason: string | null;
  parentInvoiceId: string | null;
  clientId: string | null;
  clientName: string | null;
  notesHe: string | null;
  notesEn: string | null;
};

type LineRow = {
  position: number;
  description: string;
  quantity: string;
  unitPriceMinor: string;
  vatRate: string;
  lineTotalMinor: string;
};

function minorToDisplay(amountMinor: string, currency: string): string {
  const v = BigInt(amountMinor);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const major = abs / 100n;
  const cents = abs % 100n;
  const majorStr = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${majorStr}.${cents.toString().padStart(2, "0")} ${currency}`;
}

export default async function InvoiceDetailPage(props: Props) {
  const { id, locale } = await props.params;
  const me = await requireCurrentUser();
  const t = await getTranslations("app.invoices");
  const typeLangKey = locale === "he-IL" ? "he" : "en";

  const { head, lines } = await withUser(me.appUserId, async (tx) => {
    const heads = (await tx.execute(
      sql`SELECT i.id, i.business_id AS "businessId",
                 b.legal_name AS "businessName",
                 i.invoice_type AS "invoiceType",
                 i.sequential_number AS "sequentialNumber",
                 i.issue_date AS "issueDate",
                 i.due_date AS "dueDate",
                 i.total_minor::text AS "totalMinor",
                 i.subtotal_minor::text AS "subtotalMinor",
                 i.vat_minor::text AS "vatMinor",
                 i.vat_rate::text AS "vatRate",
                 i.currency_at_issue AS "currencyAtIssue",
                 i.allocation_status::text AS "allocationStatus",
                 i.allocation_number AS "allocationNumber",
                 i.cancelled_at AS "cancelledAt",
                 i.cancellation_reason AS "cancellationReason",
                 i.parent_invoice_id AS "parentInvoiceId",
                 i.client_id AS "clientId",
                 c.legal_name AS "clientName",
                 i.notes_he AS "notesHe",
                 i.notes_en AS "notesEn"
          FROM invoices i
          JOIN businesses b ON b.id = i.business_id
          LEFT JOIN clients c ON c.id = i.client_id
          WHERE i.id = ${id}::uuid
          LIMIT 1`,
    )) as unknown as HeadRow[];
    const head = heads[0] ?? null;
    if (!head) return { head: null, lines: [] as LineRow[] };

    const ls = (await tx.execute(
      sql`SELECT position, description, quantity::text AS quantity,
                 unit_price_minor::text AS "unitPriceMinor",
                 vat_rate::text AS "vatRate",
                 line_total_minor::text AS "lineTotalMinor"
          FROM invoice_line_items
          WHERE invoice_id = ${id}::uuid
          ORDER BY position ASC`,
    )) as unknown as LineRow[];

    return { head, lines: ls };
  });

  if (!head) notFound();

  const isCancelled = head.cancelledAt !== null;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t(`types.option.${head.invoiceType}.${typeLangKey}`)} #{head.sequentialNumber}
          </h1>
          <p className="mt-1 text-sm text-slate-400" dir="ltr">
            {head.issueDate} · {head.businessName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/invoices/${head.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
          >
            <FileDown size={14} />
            {t("downloadPdf")}
          </a>
          {!isCancelled && head.invoiceType !== "credit_note" ? (
            <CancelInvoiceButton invoiceId={head.id} />
          ) : null}
        </div>
      </header>

      {isCancelled ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <Ban size={14} />
          <span>
            {t("cancelledBanner")}{" "}
            {head.cancellationReason ? (
              <span className="text-red-200/80">— {head.cancellationReason}</span>
            ) : null}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {t("immutableBanner")}
        </div>
      )}

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("detail.headerSection")}
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
          <DescRow label={t("detail.business")}>{head.businessName}</DescRow>
          <DescRow label={t("detail.client")}>
            {head.clientName ?? t("clientNone")}
          </DescRow>
          <DescRow label={t("issueDate")}>
            <span dir="ltr">{head.issueDate}</span>
          </DescRow>
          <DescRow label={t("dueDate")}>
            <span dir="ltr">{head.dueDate ?? "—"}</span>
          </DescRow>
          <DescRow label={t("detail.allocationStatus")}>
            <span>{t(`allocationStatus.${head.allocationStatus}`)}</span>
          </DescRow>
          <DescRow label={t("detail.allocationNumber")}>
            <span dir="ltr">{head.allocationNumber ?? "—"}</span>
          </DescRow>
          {head.parentInvoiceId ? (
            <DescRow label={t("detail.parentInvoice")}>
              <Link
                href={`/invoices/${head.parentInvoiceId}`}
                className="text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline"
              >
                {head.parentInvoiceId.slice(0, 8)}…
              </Link>
            </DescRow>
          ) : null}
        </dl>
      </section>

      <section className="glass-strong rounded-2xl p-6">
        <h2 className="text-sm font-medium tracking-tight text-slate-200">
          {t("detail.lines")}
        </h2>
        {lines.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            {t("detail.linesEmpty")}
          </p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <th className="px-2 py-2 text-start">#</th>
                <th className="px-2 py-2 text-start">
                  {t("line.description")}
                </th>
                <th className="px-2 py-2 text-end">{t("line.quantity")}</th>
                <th className="px-2 py-2 text-end">{t("line.unitPrice")}</th>
                <th className="px-2 py-2 text-end">{t("line.vatRate")}</th>
                <th className="px-2 py-2 text-end">{t("line.lineTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln) => (
                <tr key={ln.position} className="border-b border-white/5">
                  <td className="px-2 py-2 text-slate-400" dir="ltr">
                    {ln.position}
                  </td>
                  <td className="px-2 py-2 text-slate-200">{ln.description}</td>
                  <td className="px-2 py-2 text-end text-slate-300" dir="ltr">
                    {ln.quantity}
                  </td>
                  <td className="px-2 py-2 text-end text-slate-300" dir="ltr">
                    {minorToDisplay(ln.unitPriceMinor, head.currencyAtIssue)}
                  </td>
                  <td className="px-2 py-2 text-end text-slate-300" dir="ltr">
                    {ln.vatRate}%
                  </td>
                  <td className="px-2 py-2 text-end text-slate-100" dir="ltr">
                    {minorToDisplay(ln.lineTotalMinor, head.currencyAtIssue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-4 grid grid-cols-1 gap-2 border-t border-white/10 pt-4 sm:grid-cols-3">
          <SummaryCell label={t("totals.subtotal")}>
            <span dir="ltr">
              {minorToDisplay(head.subtotalMinor, head.currencyAtIssue)}
            </span>
          </SummaryCell>
          <SummaryCell label={t("totals.vat") + ` (${head.vatRate}%)`}>
            <span dir="ltr">
              {minorToDisplay(head.vatMinor, head.currencyAtIssue)}
            </span>
          </SummaryCell>
          <SummaryCell label={t("totals.total")}>
            <span className="text-emerald-200 font-medium" dir="ltr">
              {minorToDisplay(head.totalMinor, head.currencyAtIssue)}
            </span>
          </SummaryCell>
        </div>
      </section>

      {(head.notesHe || head.notesEn) && (
        <section className="glass-strong rounded-2xl p-6">
          <h2 className="text-sm font-medium tracking-tight text-slate-200">
            {t("detail.notes")}
          </h2>
          {head.notesHe ? (
            <p
              className="mt-2 whitespace-pre-line text-sm text-slate-300"
              dir="rtl"
            >
              {head.notesHe}
            </p>
          ) : null}
          {head.notesEn ? (
            <p
              className="mt-2 whitespace-pre-line text-sm text-slate-300"
              dir="ltr"
            >
              {head.notesEn}
            </p>
          ) : null}
        </section>
      )}
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

function SummaryCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
        {label}
      </span>
      <p className="mt-0.5 text-slate-100">{children}</p>
    </div>
  );
}
