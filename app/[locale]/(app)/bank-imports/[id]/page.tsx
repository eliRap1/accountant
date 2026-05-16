import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { sql, and, between, eq } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";
import { transactions } from "@/db/schema/money-flows";
import { fingerprintTransaction } from "@/lib/recon/dedup";
import ParseReview, {
  type ReviewRow,
} from "@/components/app/bank-imports/ParseReview";

// Bank-import review page. Loads the parsed rows from the JSONB column,
// computes dedup-warning state for each row by querying transactions
// for the row's fingerprint, then renders the ParseReview client
// component with the augmented data.
//
// Performance note: we batch the dedup probe by collecting all unique
// (date, amount) tuples once and running one SQL query per import. For
// a 200-row monthly statement this is one query, not 200.

type ImportRow = {
  id: string;
  businessId: string;
  bank: string;
  sourceFormat: string;
  fileName: string | null;
  status: string;
  rows: Array<{
    txnDate: string;
    amountMinor: string;
    currency: string;
    description: string;
    counterparty: string;
  }>;
  warnings: string[];
};

type AccountOption = { id: string; name: string };

export default async function BankImportReviewPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const me = await requireCurrentUser();
  const t = await getTranslations("app.bankImports");

  const data = await withUser(me.appUserId, async (tx) => {
    const importRows = (await tx.execute(
      sql`SELECT i.id::text AS id,
                 i.business_id::text AS "businessId",
                 i.bank,
                 i.source_format::text AS "sourceFormat",
                 i.file_name AS "fileName",
                 i.status::text AS status,
                 i.parsed_transactions_jsonb AS rows,
                 i.error_jsonb AS "errorJsonb"
            FROM bank_statement_imports i
           WHERE i.id = ${id}::uuid
           LIMIT 1`,
    )) as unknown as Array<
      Omit<ImportRow, "warnings"> & {
        errorJsonb: { warnings?: string[] };
      }
    >;
    const imp = importRows[0];
    if (!imp) return null;

    const warnings = Array.isArray(imp.errorJsonb?.warnings)
      ? imp.errorJsonb.warnings
      : [];

    // Compute dedup-warning state. Build an in-memory fingerprint map
    // for every parsed row, then probe transactions across the union
    // date window with a single query bounded to this business.
    const fingerprints = imp.rows.map((r) =>
      fingerprintTransaction({
        amountMinor: BigInt(r.amountMinor),
        txnDate: new Date(`${r.txnDate}T00:00:00Z`),
        counterparty: r.counterparty,
      }),
    );

    const reviewRows: ReviewRow[] = [];

    if (imp.rows.length > 0) {
      const allDates = imp.rows.map((r) => r.txnDate).sort();
      const minDate = new Date(`${allDates[0]}T00:00:00Z`);
      minDate.setUTCDate(minDate.getUTCDate() - 2);
      const maxDate = new Date(`${allDates[allDates.length - 1]}T00:00:00Z`);
      maxDate.setUTCDate(maxDate.getUTCDate() + 2);

      const existing = (await tx
        .select({
          amountMinor: transactions.amountMinor,
          txnDate: transactions.txnDate,
          description: transactions.description,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.businessId, imp.businessId),
            between(
              transactions.txnDate,
              minDate.toISOString().slice(0, 10),
              maxDate.toISOString().slice(0, 10),
            ),
          ),
        )) as Array<{
        amountMinor: bigint;
        txnDate: string;
        description: string | null;
      }>;

      // Build a fingerprint → existing row index for quick lookup.
      const existingFp = new Map<
        string,
        { txnDate: string; description: string | null }
      >();
      for (const e of existing) {
        const fp = fingerprintTransaction({
          amountMinor: e.amountMinor,
          txnDate: new Date(`${e.txnDate}T00:00:00Z`),
          counterparty: e.description ?? "",
        });
        existingFp.set(fp, { txnDate: e.txnDate, description: e.description });
      }

      imp.rows.forEach((r, idx) => {
        const fp = fingerprints[idx]!;
        const dup = existingFp.get(fp) ?? null;
        reviewRows.push({
          index: idx,
          txnDate: r.txnDate,
          amountMinor: r.amountMinor,
          currency: r.currency,
          description: r.description,
          counterparty: r.counterparty,
          duplicateOf: dup,
        });
      });
    }

    const accounts = (await tx.execute(
      sql`SELECT id::text AS id, name
            FROM financial_accounts
           WHERE business_id = ${imp.businessId}::uuid
             AND deleted_at IS NULL
           ORDER BY name ASC`,
    )) as unknown as AccountOption[];

    return { imp, reviewRows, warnings, accounts };
  });

  if (!data) notFound();
  const { imp, reviewRows, warnings, accounts } = data;
  const isCommitted = imp.status !== "pending";

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
          {t("reviewTitle")}
        </h1>
        <p className="mt-1 text-sm text-slate-400" dir="ltr">
          {imp.bank} · {imp.sourceFormat} · {imp.fileName ?? "—"}
        </p>
      </header>

      {isCommitted && (
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {t("alreadyCommitted")}
        </div>
      )}

      <ParseReview
        importId={imp.id}
        rows={reviewRows}
        accounts={accounts}
        warnings={warnings}
      />
    </div>
  );
}
