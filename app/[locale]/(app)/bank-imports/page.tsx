import { getTranslations } from "next-intl/server";
import { sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireCurrentUser } from "@/lib/auth/serverSession";
import { withUser } from "@/lib/db/withUser";

// Bank-imports list — surfaces every import the operator has uploaded
// for the businesses they own, with status + row count + commit
// timestamp. The +New button takes them through the upload wizard.

type ImportRow = {
  id: string;
  bank: string;
  sourceFormat: string;
  fileName: string | null;
  rowCount: number | null;
  status: string;
  importedAt: string;
  committedAt: string | null;
  businessName: string;
};

export default async function BankImportsPage() {
  const me = await requireCurrentUser();
  const t = await getTranslations("app.bankImports");

  const rows = await withUser(me.appUserId, async (tx) => {
    const data = (await tx.execute(
      sql`SELECT i.id::text AS id,
                 i.bank,
                 i.source_format::text AS "sourceFormat",
                 i.file_name AS "fileName",
                 i.row_count AS "rowCount",
                 i.status::text AS status,
                 i.imported_at::text AS "importedAt",
                 i.committed_at::text AS "committedAt",
                 b.legal_name AS "businessName"
            FROM bank_statement_imports i
            JOIN businesses b ON b.id = i.business_id
           ORDER BY i.imported_at DESC
           LIMIT 100`,
    )) as unknown as ImportRow[];
    return data;
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
          href="/bank-imports/upload"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400"
        >
          <Plus size={14} />
          {t("addCta")}
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center text-sm text-slate-400">
          {t("emptyState")}
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <th className="px-4 py-3 text-start">{t("col.importedAt")}</th>
                <th className="px-4 py-3 text-start">{t("col.business")}</th>
                <th className="px-4 py-3 text-start">{t("col.bank")}</th>
                <th className="px-4 py-3 text-start">{t("col.format")}</th>
                <th className="px-4 py-3 text-start">{t("col.fileName")}</th>
                <th className="px-4 py-3 text-end">{t("col.rowCount")}</th>
                <th className="px-4 py-3 text-start">{t("col.status")}</th>
                <th className="px-4 py-3 text-end">{t("col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-white/5">
                  <td className="px-4 py-3 text-slate-300" dir="ltr">
                    {r.importedAt.slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-4 py-3 text-slate-200">{r.businessName}</td>
                  <td className="px-4 py-3 text-slate-200">{r.bank}</td>
                  <td className="px-4 py-3 text-slate-300" dir="ltr">
                    {r.sourceFormat}
                  </td>
                  <td className="px-4 py-3 text-slate-300" dir="ltr">
                    {r.fileName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-end text-slate-300" dir="ltr">
                    {r.rowCount ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Link
                      href={`/bank-imports/${r.id}`}
                      className="text-emerald-300 hover:text-emerald-200"
                    >
                      {t("col.view")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colour =
    status === "committed"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
      : status === "rejected"
        ? "border-red-400/40 bg-red-500/10 text-red-200"
        : "border-amber-400/40 bg-amber-500/10 text-amber-100";
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] ${colour}`}
    >
      {status}
    </span>
  );
}
