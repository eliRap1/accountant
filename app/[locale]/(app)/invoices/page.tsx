import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import InvoiceList, { type InvoiceRow } from "./InvoiceList";

type SearchParams = Promise<{
  businessId?: string;
  from?: string;
  to?: string;
  allocation?: string;
}>;

type BusinessOption = { id: string; legalName: string };

type RawInvoiceRow = Omit<InvoiceRow, "cancelledAt"> & {
  cancelledAt: Date | string | null;
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.invoices");
  const sp = (await searchParams) ?? {};

  const businessId = sp.businessId ?? "";
  const from = sp.from ?? "";
  const to = sp.to ?? "";
  const allocation = sp.allocation ?? "";

  // Pass NULL instead of "" for date params so PostgreSQL never attempts
  // to cast an empty string to `date`. The `::date` cast on a bound
  // parameter is evaluated eagerly — even when the short-circuit `'' = ''`
  // branch would make it logically unreachable — causing
  // "invalid input syntax for type date: """.  Switching to NULL + IS NULL
  // guard is safe: `NULL::date` → NULL → `NULL IS NULL` → TRUE (no filter).
  const fromDate: string | null = from || null;
  const toDate: string | null = to || null;

  const { businesses, rows } = await withUser(me.appUserId, async (tx) => {
    const bs = (await tx.execute(
      sql`SELECT id, legal_name AS "legalName"
          FROM businesses
          WHERE deleted_at IS NULL
          ORDER BY legal_name ASC`,
    )) as unknown as BusinessOption[];

    const data = (await tx.execute(
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
    )) as unknown as RawInvoiceRow[];

    const rows: InvoiceRow[] = data.map((r) => ({
      id: r.id,
      businessId: r.businessId,
      businessName: r.businessName,
      invoiceType: r.invoiceType,
      sequentialNumber: r.sequentialNumber,
      issueDate: r.issueDate,
      totalMinor: r.totalMinor,
      currencyAtIssue: r.currencyAtIssue,
      allocationStatus: r.allocationStatus,
      cancelledAt:
        r.cancelledAt === null
          ? null
          : r.cancelledAt instanceof Date
            ? r.cancelledAt.toISOString()
            : String(r.cancelledAt),
      clientName: r.clientName,
    }));

    return { businesses: bs, rows };
  });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
        </div>
        <Link
          href="/invoices/new"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
        >
          {t("addCta")}
        </Link>
      </header>
      <InvoiceList
        rows={rows}
        businesses={businesses}
        initialBusinessId={businessId}
        initialFrom={from}
        initialTo={to}
        initialAllocation={allocation}
      />
    </div>
  );
}
