"use client";

import { motion } from "framer-motion";

// Reusable summary tile for the tax surface. Mirrors `KpiCard` visually
// but is purpose-built for tax data: emphasis vs muted variants, an
// optional helper line, and `dir="ltr"` on the value so the ILS amount
// reads correctly in both RTL and LTR contexts.

export type TaxSummaryCardProps = {
  label: string;
  value: string;
  helper?: string;
  tone?: "default" | "emphasis" | "muted";
};

const TONE_STYLES: Record<
  NonNullable<TaxSummaryCardProps["tone"]>,
  { border: string; bg: string }
> = {
  default: { border: "border-white/5", bg: "bg-slate-950/50" },
  emphasis: { border: "border-emerald-500/30", bg: "bg-emerald-500/5" },
  muted: { border: "border-slate-700/40", bg: "bg-slate-900/40" },
};

export default function TaxSummaryCard({
  label,
  value,
  helper,
  tone = "default",
}: TaxSummaryCardProps) {
  const t = TONE_STYLES[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className={`rounded-2xl border ${t.border} ${t.bg} p-4`}
    >
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p
        className="mt-2 text-2xl font-semibold tracking-tight text-slate-50"
        dir="ltr"
      >
        {value}
      </p>
      {helper ? (
        <p className="mt-1 text-xs text-slate-400">{helper}</p>
      ) : null}
    </motion.div>
  );
}
