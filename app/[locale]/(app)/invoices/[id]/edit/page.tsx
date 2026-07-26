import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Lock, ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { IL_2026 } from "@/lib/tax/il/rules-2026";
import { activeThresholdAt } from "@/lib/invoices/allocationThreshold";
import InvoiceForm, {
  type BusinessOption,
  type ClientOption,
  type InvoiceFormInitial,
  type InvoiceLineDraft,
} from "../../InvoiceForm";

type Props = { params: Promise<{ id: string; locale: string }> };

type HeadRow = {
  id: string;
  businessId: string;
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
  vatRate: string;
  currencyAtIssue: string;
  fxRateAtIssue: string | null;
  allocationNumber: string | null;
  cancelledAt: Date | string | null;
  clientId: string | null;
  notesHe: string | null;
  notesEn: string | null;
};

type LineRow = {
  position: number;
  description: string;
  quantity: string;
  unitPriceMinor: string;
  vatRate: string;
};

function minorMajor(amountMinor: string): string {
  const v = BigInt(amountMinor);
  const major = v / 100n;
  const cents = v % 100n;
  return `${major.toString()}.${cents.toString().padStart(2, "0")}`;
}

export default async function EditInvoicePage(props: Props) {
  const { id } = await props.params;
  const me = await requireCurrentUser();
  const t = await getTranslations("app.invoices");

  const { head, lines, businesses, clients } = await withUser(
    me.appUserId,
    async (tx) => {
      const heads = (await tx.execute(
        sql`SELECT i.id, i.business_id AS "businessId",
                   i.invoice_type AS "invoiceType",
                   i.sequential_number AS "sequentialNumber",
                   i.issue_date AS "issueDate",
                   i.due_date AS "dueDate",
                   i.total_minor::text AS "totalMinor",
                   i.vat_rate::text AS "vatRate",
                   i.currency_at_issue AS "currencyAtIssue",
                   i.fx_rate_at_issue::text AS "fxRateAtIssue",
                   i.allocation_number AS "allocationNumber",
                   i.cancelled_at AS "cancelledAt",
                   i.client_id AS "clientId",
                   i.notes_he AS "notesHe",
                   i.notes_en AS "notesEn"
            FROM invoices i
            WHERE i.id = ${id}::uuid
            LIMIT 1`,
      )) as unknown as HeadRow[];
      const head = heads[0] ?? null;

      const ls = head
        ? ((await tx.execute(
            sql`SELECT position, description, quantity::text AS quantity,
                       unit_price_minor::text AS "unitPriceMinor",
                       vat_rate::text AS "vatRate"
                FROM invoice_line_items
                WHERE invoice_id = ${id}::uuid
                ORDER BY position ASC`,
          )) as unknown as LineRow[])
        : [];

      const bs = (await tx.execute(
        sql`SELECT id, legal_name AS "legalName",
                   default_currency AS "defaultCurrency",
                   vat_status::text AS "vatStatus"
            FROM businesses
            WHERE deleted_at IS NULL
            ORDER BY legal_name ASC`,
      )) as unknown as BusinessOption[];

      const cs = (await tx.execute(
        sql`SELECT id, legal_name AS "legalName",
                   business_id AS "businessId"
            FROM clients
            WHERE deleted_at IS NULL
            ORDER BY legal_name ASC`,
      )) as unknown as ClientOption[];

      return { head, lines: ls, businesses: bs, clients: cs };
    },
  );

  if (!head) notFound();

  // Committed-invoice policy: any row that has a sequential number > 0
  // AND is not cancelled is immutable. Show a banner + read-only view.
  // This mirrors the schema's no-gap constraint (db/schema/invoicing.ts
  // — `invoices_internal_sequence_idx`).
  const isCommitted = head.sequentialNumber > 0 && head.cancelledAt === null;
  const isCancelled = head.cancelledAt !== null;

  const lineDrafts: InvoiceLineDraft[] = lines.map((ln) => ({
    description: ln.description,
    quantity: ln.quantity,
    unitPriceMajor: minorMajor(ln.unitPriceMinor),
    vatRate: ln.vatRate,
  }));

  const initial: Partial<InvoiceFormInitial> = {
    id: head.id,
    businessId: head.businessId,
    invoiceType: head.invoiceType,
    issueDate: head.issueDate,
    dueDate: head.dueDate ?? "",
    clientId: head.clientId ?? "",
    currency: head.currencyAtIssue,
    fxRate: head.fxRateAtIssue ?? "",
    notesHe: head.notesHe ?? "",
    notesEn: head.notesEn ?? "",
    allocationNumber: head.allocationNumber ?? "",
    lines: lineDrafts,
  };

  const threshold = activeThresholdAt(new Date()).toString();
  const defaultVatRatePct = IL_2026.vatStandardRate * 100;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/invoices/${id}`}
          className="inline-flex items-center gap-1 text-sm text-slate-300 hover:text-emerald-200 transition-colors"
        >
          <ArrowLeft size={14} />
          {t("backToInvoice")}
        </Link>
      </div>
      {isCommitted ? (
        <div className="glass-strong rounded-2xl p-6 ring-1 ring-amber-400/30">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 flex-shrink-0 text-amber-200" size={18} />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-amber-100">
                {t("edit.lockedTitle")}
              </h2>
              <p className="mt-1 text-xs text-amber-200/90">
                {t("edit.lockedBody")}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Link
                  href={`/invoices/${id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100 transition-colors hover:bg-amber-500/20"
                >
                  {t("edit.viewInsteadCta")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : isCancelled ? (
        <div className="glass-strong rounded-2xl p-6 ring-1 ring-red-400/30">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 flex-shrink-0 text-red-200" size={18} />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-red-200">
                {t("edit.cancelledTitle")}
              </h2>
              <p className="mt-1 text-xs text-red-200/90">
                {t("edit.cancelledBody")}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <InvoiceForm
          mode="edit"
          businesses={businesses}
          clients={clients}
          defaultVatRatePct={defaultVatRatePct}
          thresholdMinorStr={threshold}
          initial={initial}
        />
      )}
    </div>
  );
}
