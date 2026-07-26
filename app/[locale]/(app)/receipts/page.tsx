import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";

type SearchParams = Promise<{
  businessId?: string;
  status?: string;
  from?: string;
  to?: string;
}>;

type ReceiptRow = {
  id: string;
  businessId: string;
  businessName: string;
  status: "pending_review" | "approved" | "rejected";
  source: string;
  parsedAmountMinor: string | null;
  parsedDate: string | null;
  categoryCode: string | null;
  hasOcr: boolean;
  createdAt: string;
};

type BusinessOption = { id: string; legalName: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.receipts" });
  return { title: t("metaTitle") };
}

function minorToDisplay(amountMinor: string | null): string {
  if (!amountMinor) return "—";
  const v = BigInt(amountMinor);
  const major = v / 100n;
  const cents = v % 100n;
  return `₪${major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents
    .toString()
    .padStart(2, "0")}`;
}

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.receipts");
  const sp = (await searchParams) ?? {};

  const businessId = sp.businessId ?? "";
  const status = sp.status ?? "";
  const from = sp.from ?? "";
  const to = sp.to ?? "";

  // Pass NULL instead of "" for date params so PostgreSQL never attempts
  // to cast an empty string to `date`. See invoices/page.tsx for the full
  // explanation of this class of bug.
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
            AND (${fromDate}::date IS NULL OR r.parsed_date >= ${fromDate}::date OR (r.parsed_date IS NULL AND r.created_at >= ${fromDate}::date))
            AND (${toDate}::date IS NULL OR r.parsed_date <= ${toDate}::date OR (r.parsed_date IS NULL AND r.created_at <= ${toDate}::date))
          ORDER BY COALESCE(r.parsed_date, r.created_at::date) DESC, r.created_at DESC
          LIMIT 500`,
    )) as unknown as ReceiptRow[];

    return { businesses: bs, rows: data };
  });

  // Group by status — keeps "needs my attention" front and center.
  const groups: Record<ReceiptRow["status"], ReceiptRow[]> = {
    pending_review: [],
    approved: [],
    rejected: [],
  };
  for (const r of rows) {
    groups[r.status].push(r);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
        </div>
        <Link
          href="/receipts/upload"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
        >
          {t("uploadCta")}
        </Link>
      </header>

      <div className="glass mb-6 rounded-2xl p-4">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-4" action="">
          <label className="block">
            <span className="block text-xs uppercase tracking-[0.16em] text-slate-500">
              {t("filter.business")}
            </span>
            <select
              name="businessId"
              defaultValue={businessId}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:border-emerald-400/40 focus:outline-none"
            >
              <option value="">{t("filter.allBusinesses")}</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.legalName}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-[0.16em] text-slate-500">
              {t("filter.status")}
            </span>
            <select
              name="status"
              defaultValue={status}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:border-emerald-400/40 focus:outline-none"
            >
              <option value="">{t("filter.allStatuses")}</option>
              <option value="pending_review">
                {t("status.pending_review")}
              </option>
              <option value="approved">{t("status.approved")}</option>
              <option value="rejected">{t("status.rejected")}</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-[0.16em] text-slate-500">
              {t("filter.from")}
            </span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              dir="ltr"
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:border-emerald-400/40 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-[0.16em] text-slate-500">
              {t("filter.to")}
            </span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              dir="ltr"
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 focus:border-emerald-400/40 focus:outline-none"
            />
          </label>
          <div className="sm:col-span-4 flex items-center gap-2">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-emerald-400"
            >
              {t("filter.apply")}
            </button>
            <Link
              href="/receipts"
              className="inline-flex items-center justify-center rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-white/20"
            >
              {t("filter.clear")}
            </Link>
          </div>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="glass-strong rounded-2xl p-8 text-center">
          <p className="text-sm text-slate-300">{t("emptyState")}</p>
        </div>
      ) : (
        <div className="space-y-8">
          <StatusSection
            title={t("section.pending")}
            rows={groups.pending_review}
            t={t}
            highlight
          />
          <StatusSection
            title={t("section.approved")}
            rows={groups.approved}
            t={t}
          />
          <StatusSection
            title={t("section.rejected")}
            rows={groups.rejected}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

function StatusSection({
  title,
  rows,
  t,
  highlight = false,
}: {
  title: string;
  rows: ReceiptRow[];
  t: (k: string) => string;
  highlight?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2
        className={`mb-3 text-xs uppercase tracking-[0.18em] ${
          highlight ? "text-emerald-300" : "text-slate-500"
        }`}
      >
        {title}{" "}
        <span className="text-slate-500">({rows.length})</span>
      </h2>
      <div className="glass-strong overflow-hidden rounded-2xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <th className="px-4 py-3 text-start">{t("col.date")}</th>
              <th className="px-4 py-3 text-start">{t("col.business")}</th>
              <th className="px-4 py-3 text-start">{t("col.category")}</th>
              <th className="px-4 py-3 text-end">{t("col.amount")}</th>
              <th className="px-4 py-3 text-start">{t("col.ocr")}</th>
              <th className="px-4 py-3 text-end">{t("col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="glass border-b border-white/5 last:border-b-0 transition-colors hover:bg-emerald-500/5"
              >
                <td className="px-4 py-3 text-slate-200" dir="ltr">
                  {r.parsedDate ?? r.createdAt}
                </td>
                <td className="px-4 py-3 text-slate-300">{r.businessName}</td>
                <td className="px-4 py-3 text-slate-300" dir="ltr">
                  {r.categoryCode ?? "—"}
                </td>
                <td
                  className="px-4 py-3 text-end font-medium text-slate-100"
                  dir="ltr"
                >
                  {minorToDisplay(r.parsedAmountMinor)}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {r.hasOcr ? (
                    <span className="inline-flex items-center rounded-md border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-emerald-200">
                      {t("ocr.applied")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-amber-200">
                      {t("ocr.pending")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-end">
                  <Link
                    href={`/receipts/${r.id}`}
                    className="inline-flex items-center justify-center rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
                  >
                    {t("col.view")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
