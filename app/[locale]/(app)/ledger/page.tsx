import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import LedgerView, {
  type JournalEntrySummary,
  type LedgerBusinessOption,
} from "./LedgerView";

type SearchParams = Promise<{ businessId?: string }>;

export default async function LedgerPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.ledger");
  const sp = (await searchParams) ?? {};

  const { businesses, entries, hasDoubleEntry } = await withUser(
    me.appUserId,
    async (tx) => {
      const bs = (await tx.execute(
        sql`SELECT id, legal_name AS "legalName",
                   bookkeeping_method AS "bookkeepingMethod"
            FROM businesses
            WHERE deleted_at IS NULL
            ORDER BY legal_name ASC`,
      )) as unknown as LedgerBusinessOption[];

      const dbleEntry = bs.filter((b) => b.bookkeepingMethod === "double_entry");
      const businessId =
        sp.businessId && dbleEntry.find((b) => b.id === sp.businessId)
          ? sp.businessId
          : (dbleEntry[0]?.id ?? "");

      let data: JournalEntrySummary[] = [];
      if (businessId) {
        data = (await tx.execute(
          sql`SELECT je.id, je.entry_date AS "entryDate",
                     je.description, je.source,
                     COALESCE((SELECT SUM(jl.debit_minor)::text
                               FROM journal_lines jl
                               WHERE jl.entry_id = je.id), '0') AS "totalDebit",
                     COALESCE((SELECT SUM(jl.credit_minor)::text
                               FROM journal_lines jl
                               WHERE jl.entry_id = je.id), '0') AS "totalCredit",
                     (SELECT COUNT(*)::int FROM journal_lines jl
                      WHERE jl.entry_id = je.id) AS "lineCount"
              FROM journal_entries je
              WHERE je.business_id = ${businessId}::uuid
              ORDER BY je.entry_date DESC, je.posted_at DESC
              LIMIT 200`,
        )) as unknown as JournalEntrySummary[];
      }

      return {
        businesses: dbleEntry,
        entries: data,
        hasDoubleEntry: dbleEntry.length > 0,
      };
    },
  );

  if (!hasDoubleEntry) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="glass-strong rounded-2xl p-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">
            {t("title")}
          </h1>
          <p className="mt-3 text-sm text-slate-400">
            {t("placeholderDoubleEntryOnly")}
          </p>
          <Link
            href="/businesses"
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
          >
            {t("manageBusinessesCta")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t("subtitle")}</p>
        </div>
        <Link
          href="/ledger/new"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
        >
          {t("addCta")}
        </Link>
      </header>
      <LedgerView
        entries={entries}
        businesses={businesses}
        initialBusinessId={sp.businessId ?? ""}
      />
    </div>
  );
}
