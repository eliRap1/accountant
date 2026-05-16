import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import TransactionList, { type TransactionRow } from "./TransactionList";

type SearchParams = Promise<{
  businessId?: string;
  from?: string;
  to?: string;
}>;

type BusinessOption = { id: string; legalName: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app.transactions" });
  return { title: t("metaTitle") };
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.transactions");
  const sp = (await searchParams) ?? {};

  const businessId = sp.businessId ?? "";
  const from = sp.from ?? "";
  const to = sp.to ?? "";

  const { businesses, rows } = await withUser(me.appUserId, async (tx) => {
    const bs = (await tx.execute(
      sql`SELECT id, legal_name AS "legalName"
          FROM businesses
          WHERE deleted_at IS NULL
          ORDER BY legal_name ASC`,
    )) as unknown as BusinessOption[];

    const data = (await tx.execute(
      sql`SELECT t.id, t.business_id AS "businessId",
                 b.legal_name AS "businessName",
                 t.direction, t.amount_minor::text AS "amountMinor",
                 t.currency, t.category_code AS "categoryCode",
                 COALESCE(coa.name_he, coa.name_en) AS "categoryName",
                 t.description, t.txn_date AS "txnDate",
                 t.source, fa.name AS "accountName"
          FROM transactions t
          JOIN businesses b ON b.id = t.business_id
          LEFT JOIN financial_accounts fa ON fa.id = t.financial_account_id
          LEFT JOIN chart_of_accounts coa
            ON coa.code = t.category_code
           AND (coa.business_id = t.business_id OR coa.business_id IS NULL)
          WHERE (${businessId} = '' OR t.business_id::text = ${businessId})
            AND (${from} = '' OR t.txn_date >= ${from}::date)
            AND (${to} = '' OR t.txn_date <= ${to}::date)
          ORDER BY t.txn_date DESC, t.created_at DESC
          LIMIT 500`,
    )) as unknown as TransactionRow[];

    return { businesses: bs, rows: data };
  });

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
          href="/transactions/new"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
        >
          {t("addCta")}
        </Link>
      </header>
      <TransactionList
        rows={rows}
        businesses={businesses}
        initialBusinessId={businessId}
        initialFrom={from}
        initialTo={to}
      />
    </div>
  );
}
