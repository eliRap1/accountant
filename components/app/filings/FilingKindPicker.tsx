"use client";

import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { ReactNode } from "react";

// Tile-grid picker for the seven tax-filing kinds.
//
// Each tile shows the form's name, a short description, and a status
// chip. Tiles whose entitlement is locked render dim with a padlock and
// link to `/billing`; selected tiles render with an emerald glow.
//
// The component itself is presentational — selection state is owned by
// the wizard parent. The list of which tiles are locked is computed
// server-side from `plan_entitlements` and threaded in via `lockedKinds`.

export type FilingKind =
  | "pcn874"
  | "form_6111"
  | "form_102"
  | "form_1301"
  | "form_1214"
  | "form_126"
  | "form_856";

const ALL_KINDS: FilingKind[] = [
  "pcn874",
  "form_6111",
  "form_102",
  "form_1301",
  "form_1214",
  "form_126",
  "form_856",
];

type Props = {
  value: FilingKind | "";
  onChange: (kind: FilingKind) => void;
  lockedKinds: ReadonlyArray<FilingKind>;
  disabled?: boolean;
};

export default function FilingKindPicker({
  value,
  onChange,
  lockedKinds,
  disabled,
}: Props): ReactNode {
  const t = useTranslations("app.filings");
  const lockedSet = new Set(lockedKinds);

  return (
    <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <legend className="mb-2 block text-sm text-slate-300">
        {t("wizard.kindLegend")}
      </legend>
      {ALL_KINDS.map((kind) => {
        const isLocked = lockedSet.has(kind);
        const isSelected = value === kind;
        const planLabel =
          kind === "pcn874" ? t("planName.solo") : t("planName.plus");
        const lockedDesc = t("kindLockedDesc", { plan: planLabel });

        if (isLocked) {
          return (
            <div
              key={kind}
              aria-disabled
              className="glass relative flex h-full cursor-not-allowed flex-col gap-2 rounded-2xl border border-white/5 p-4 opacity-60"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-200">
                  {t(`kindLabel.${kind}`)}
                </span>
                <Lock size={14} className="text-slate-500" />
              </div>
              <p className="text-xs text-slate-400">
                {t(`kindDesc.${kind}`)}
              </p>
              <p className="text-[11px] uppercase tracking-[0.16em] text-amber-300/80">
                {lockedDesc}
              </p>
              <Link
                href="/billing"
                className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-300 underline-offset-2 hover:underline"
              >
                {t("upgradeCta")}
              </Link>
            </div>
          );
        }

        return (
          <button
            key={kind}
            type="button"
            disabled={disabled}
            onClick={() => onChange(kind)}
            aria-pressed={isSelected}
            className={`group relative flex h-full flex-col gap-2 rounded-2xl border p-4 text-start transition-colors ${
              isSelected
                ? "border-emerald-400/60 bg-emerald-500/10 shadow-[0_18px_50px_-20px_rgba(16,185,129,0.6)]"
                : "border-white/10 bg-slate-950/40 hover:border-white/20 hover:bg-white/5"
            } disabled:opacity-60`}
          >
            <span className="text-sm font-semibold text-slate-100">
              {t(`kindLabel.${kind}`)}
            </span>
            <span className="text-xs text-slate-400">
              {t(`kindDesc.${kind}`)}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}
