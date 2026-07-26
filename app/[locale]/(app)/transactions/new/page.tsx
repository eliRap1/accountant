import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import TransactionForm, {
  type BusinessOption,
  type FinancialAccountOption,
  type ChartOfAccountsOption,
} from "../TransactionForm";

export default async function NewTransactionPage() {
  const me = await requireCurrentUser();
  const { businesses, accounts, categories } = await withUser(
    me.appUserId,
    async (tx) => {
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

      return { businesses: bs, accounts: ac, categories: cat };
    },
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <TransactionForm
        mode="new"
        businesses={businesses}
        accounts={accounts}
        categories={categories}
      />
    </div>
  );
}
