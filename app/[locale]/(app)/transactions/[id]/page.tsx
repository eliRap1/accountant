import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Pencil } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";

type Props = { params: Promise<{ id: string; locale: string }> };

type Row = {
  id: string;
  businessName: string;
  direction: "income" | "expense" | "transfer";
  amountMinor: string;
  currency: string;
  categoryCode: string | null;
  categoryName: string | null;
  description: string | null;
  txnDate: string;
  source: string;
  accountName: string | null;
  createdAt: string;
};

function minorToDisplay(amountMinor: string, currency: string): string {
  const v = BigInt(amountMinor);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const major = abs / 100n;
  const cents = abs % 100n;
  return `${sign}${major.toString()}.${cents.toString().padStart(2, "0")} ${currency}`;
}

export default async function TransactionDetailPage(props: Props) {
  const { id } = await props.params;
  const me = await requireCurrentUser();
  const t = await getTranslations("app.transactions");

  const row = await withUser(me.appUserId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT t.id, b.legal_name AS "businessName",
                 t.direction,
                 t.amount_minor::text AS "amountMinor",
                 t.currency, t.category_code AS "categoryCode",
                 COALESCE(coa.name_he, coa.name_en) AS "categoryName",
                 t.description, t.txn_date AS "txnDate",
                 t.source, fa.name AS "accountName",
                 t.created_at AS "createdAt"
          FROM transactions t
          JOIN businesses b ON b.id = t.business_id
          LEFT JOIN financial_accounts fa ON fa.id = t.financial_account_id
          LEFT JOIN chart_of_accounts coa
            ON coa.code = t.category_code
           AND (coa.business_id = t.business_id OR coa.business_id IS NULL)
          WHERE t.id = ${id}::uuid
          LIMIT 1`,
    )) as unknown as Row[];
    return rows[0] ?? null;
  });

  if (!row) notFound();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t(`directionOption.${row.direction}`)} · {minorToDisplay(row.amountMinor, row.currency)}
          </h1>
          <p className="mt-1 text-sm text-slate-400" dir="ltr">
            {row.txnDate} · {row.businessName}
          </p>
        </div>
        <Link
          href={`/transactions/${row.id}/edit`}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
        >
          <Pencil size={14} />
          {t("col.edit")}
        </Link>
      </header>

      <section className="glass-strong rounded-2xl p-6">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 text-sm">
          <DescRow label={t("col.business")}>{row.businessName}</DescRow>
          <DescRow label={t("col.account")}>
            {row.accountName ?? t("accountUnallocated")}
          </DescRow>
          <DescRow label={t("col.category")}>
            {row.categoryCode ? (
              <span dir="ltr">
                {row.categoryCode}
                {row.categoryName ? ` · ${row.categoryName}` : ""}
              </span>
            ) : (
              "—"
            )}
          </DescRow>
          <DescRow label={t("source")}>
            <span dir="ltr">{row.source}</span>
          </DescRow>
          <DescRow label={t("description")}>
            {row.description ?? "—"}
          </DescRow>
        </dl>
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
