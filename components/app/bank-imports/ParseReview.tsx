"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { SelectField } from "@/components/app/ui/Field";
import DedupBanner from "./DedupBanner";
import { commitImport } from "@/app/[locale]/(app)/bank-imports/actions";

export type ReviewRow = {
  index: number;
  txnDate: string;
  amountMinor: string;
  currency: string;
  description: string;
  counterparty: string;
  duplicateOf: { txnDate: string; description: string | null } | null;
};

function minorToDisplay(amountMinor: string, currency: string): string {
  const v = BigInt(amountMinor);
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const major = abs / 100n;
  const cents = abs % 100n;
  const majorStr = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${majorStr}.${cents.toString().padStart(2, "0")} ${currency}`;
}

export default function ParseReview({
  importId,
  rows,
  accounts,
  warnings,
}: {
  importId: string;
  rows: ReviewRow[];
  accounts: Array<{ id: string; name: string }>;
  warnings: string[];
}): React.ReactNode {
  const t = useTranslations("app.bankImports");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  // Default: deselect any row flagged as duplicate.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(rows.filter((r) => !r.duplicateOf).map((r) => r.index)),
  );
  const [error, setError] = useState<string | null>(null);

  function toggleAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.index)));
    }
  }

  function toggle(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function commit() {
    if (selected.size === 0) {
      setError(t("errors.noRowsSelected"));
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("importId", importId);
    fd.set("financialAccountId", accountId);
    fd.set(
      "selectedIndicesJson",
      JSON.stringify(Array.from(selected).sort((a, b) => a - b)),
    );
    startTransition(async () => {
      const result = await commitImport(fd);
      if ("error" in result) {
        setError(result.error);
      } else {
        router.push("/transactions");
      }
    });
  }

  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {warnings.map((w, i) => (
            <p key={i} dir="ltr">
              {w}
            </p>
          ))}
        </div>
      )}

      <div className="glass rounded-2xl p-4">
        <SelectField
          label={t("financialAccount")}
          name="financialAccountId"
          value={accountId}
          onChange={setAccountId}
          options={[
            { value: "", label: t("accountUnallocated") },
            ...accounts.map((a) => ({ value: a.id, label: a.name })),
          ]}
          disabled={pending}
        />
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <th className="px-3 py-3">
                <input
                  type="checkbox"
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={toggleAll}
                  aria-label={t("col.toggleAll")}
                />
              </th>
              <th className="px-3 py-3 text-start">{t("col.date")}</th>
              <th className="px-3 py-3 text-end">{t("col.amount")}</th>
              <th className="px-3 py-3 text-start">{t("col.description")}</th>
              <th className="px-3 py-3 text-start">{t("col.dedup")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.index} className="border-b border-white/5">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.index)}
                    onChange={() => toggle(r.index)}
                    aria-label={t("col.toggleRow")}
                  />
                </td>
                <td className="px-3 py-2 text-slate-300" dir="ltr">
                  {r.txnDate}
                </td>
                <td
                  className={`px-3 py-2 text-end ${BigInt(r.amountMinor) < 0n ? "text-red-200" : "text-emerald-200"}`}
                  dir="ltr"
                >
                  {minorToDisplay(r.amountMinor, r.currency)}
                </td>
                <td className="px-3 py-2 text-slate-200">{r.description}</td>
                <td className="px-3 py-2">
                  <DedupBanner duplicateOf={r.duplicateOf} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            {t("noRowsParsed")}
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={commit}
          disabled={pending || rows.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium tracking-tight text-slate-950 shadow-[0_10px_40px_-10px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-60"
        >
          {pending ? t("committing") : t("commitCta", { count: selected.size })}
        </button>
      </div>
    </div>
  );
}
