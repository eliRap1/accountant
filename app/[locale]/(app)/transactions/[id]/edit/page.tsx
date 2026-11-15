import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import TransactionForm, {
  type BusinessOption,
  type FinancialAccountOption,
  type ChartOfAccountsOption,
  type TransactionFormValues,
} from "../../TransactionForm";

type Props = { params: Promise<{ id: string; locale: string }> };

type Row = {
  id: string;
  businessId: string;
  financialAccountId: string | null;
  direction: "income" | "expense" | "transfer";
  amountMinor: string;
  currency: string;
  categoryCode: string | null;
  description: string | null;
  txnDate: string;
};

function minorToMajor(amountMinor: string): string {
  const v = BigInt(amountMinor);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const major = abs / 100n;
  const cents = abs % 100n;
  return `${sign}${major.toString()}.${cents.toString().padStart(2, "0")}`;
}

export default async function EditTransactionPage(props: Props) {
  const { id } = await props.params;
  const me = await requireCurrentUser();

  const { row, businesses, accounts, categories } = await withUser(
    me.appUserId,
    async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT id, business_id AS "businessId",
                   financial_account_id AS "financialAccountId",
                   direction,
                   amount_minor::text AS "amountMinor",
                   currency, category_code AS "categoryCode",
                   description, txn_date AS "txnDate"
            FROM transactions
            WHERE id = ${id}::uuid
            LIMIT 1`,
      )) as unknown as Row[];

      const bs = (await tx.execute(
        sql`SELECT id, legal_name AS "legalName",
                   default_currency AS "defaultCurrency"
            FROM businesses
            WHERE deleted_at IS NULL
            ORDER BY legal_name ASC`,
      )) as unknown as BusinessOption[];

      const ac = (await tx.execute(
        sql`SELECT id, name, currency, business_id AS "businessId"
            FROM financial_accounts
            WHERE closed_at IS NULL
            ORDER BY name ASC`,
      )) as unknown as FinancialAccountOption[];

      const cat = (await tx.execute(
        sql`SELECT code, name_he AS "nameHe", name_en AS "nameEn",
                   type, business_id AS "businessId"
            FROM chart_of_accounts
            WHERE is_active = true
            ORDER BY code ASC`,
      )) as unknown as ChartOfAccountsOption[];

      return {
        row: rows[0] ?? null,
        businesses: bs,
        accounts: ac,
        categories: cat,
      };
    },
  );

  if (!row) notFound();

  const initial: Partial<TransactionFormValues> = {
    id: row.id,
    businessId: row.businessId,
    financialAccountId: row.financialAccountId ?? "",
    direction: row.direction,
    amountMajor: minorToMajor(row.amountMinor),
    currency: row.currency,
    categoryCode: row.categoryCode ?? "",
    description: row.description ?? "",
    txnDate: row.txnDate,
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <TransactionForm
        mode="edit"
        businesses={businesses}
        accounts={accounts}
        categories={categories}
        initial={initial}
      />
    </div>
  );
}
