"use client";

import { motion } from "framer-motion";
import type { ComponentType } from "react";

// Reusable KPI tile. Mirrors the marketing `<Kpi>` in
// components/site/sections/Dashboard.tsx visually so the in-app
// dashboard feels like the same product the user signed up from.
//
// `subtle=true` mutes the delta colour (used when the delta is an
// estimate / neutral signal rather than positive performance).
type IconComponent = ComponentType<{ size?: number; className?: string }>;

type Props = {
  icon: IconComponent;
  label: string;
  value: string;
  delta?: string;
  subtle?: boolean;
};

export default function KpiCard({ icon: Icon, label, value, delta, subtle }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="rounded-2xl border border-white/5 bg-slate-950/50 p-4"
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
        <Icon size={13} className="text-emerald-400" />
        {label}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span
          className="text-2xl font-semibold tracking-tight text-slate-50"
          dir="ltr"
        >
          {value}
        </span>
        {delta ? (
          <span
            className={`text-xs font-medium ${
              subtle ? "text-slate-400" : "text-emerald-300"
            }`}
          >
            {delta}
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}
