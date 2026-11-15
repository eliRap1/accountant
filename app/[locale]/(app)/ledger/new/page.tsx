import { sql } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import JournalEntryForm, {
  type LedgerBusinessOption,
  type ChartOfAccountsOption,
} from "./JournalEntryForm";

export default async function NewJournalEntryPage() {
  const me = await requireCurrentUser();
  const { businesses, categories } = await withUser(
    me.appUserId,
    async (tx) => {
      const bs = (await tx.execute(
        sql`SELECT id, legal_name AS "legalName",
                   bookkeeping_method AS "bookkeepingMethod"
            FROM businesses
            WHERE deleted_at IS NULL
              AND bookkeeping_method = 'double_entry'::bookkeeping_method
            ORDER BY legal_name ASC`,
      )) as unknown as LedgerBusinessOption[];

      const cat = (await tx.execute(
        sql`SELECT code, name_he AS "nameHe", name_en AS "nameEn",
                   type, business_id AS "businessId"
            FROM chart_of_accounts
            WHERE is_active = true
            ORDER BY code ASC`,
      )) as unknown as ChartOfAccountsOption[];

      return { businesses: bs, categories: cat };
    },
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <JournalEntryForm businesses={businesses} categories={categories} />
    </div>
  );
}
