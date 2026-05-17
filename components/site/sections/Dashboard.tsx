"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
  Area,
  AreaChart,
} from "recharts";
import { TrendingUp, Activity, PieChart, ArrowUpRight } from "lucide-react";

type Row = { month: string; revenue: number; ebitda: number };

const rawData = [
  { idx: 0, revenue: 142, ebitda: 28 },
  { idx: 1, revenue: 168, ebitda: 36 },
  { idx: 2, revenue: 154, ebitda: 33 },
  { idx: 3, revenue: 201, ebitda: 48 },
  { idx: 4, revenue: 232, ebitda: 59 },
  { idx: 5, revenue: 248, ebitda: 67 },
  { idx: 6, revenue: 276, ebitda: 78 },
  { idx: 7, revenue: 311, ebitda: 92 },
  { idx: 8, revenue: 342, ebitda: 104 },
  { idx: 9, revenue: 389, ebitda: 121 },
  { idx: 10, revenue: 412, ebitda: 134 },
  { idx: 11, revenue: 458, ebitda: 152 },
];

export default function Dashboard() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const parallax = useTransform(scrollYProgress, [0, 1], [40, -40]);
  const t = useTranslations("dashboard");
  const uid = useId();
  const barFillId = `${uid}-barFill`;
  const barFillDimId = `${uid}-barFillDim`;
  const areaFillId = `${uid}-areaFill`;
  // `months` is an array — next-intl returns it via raw() or by reading
  // the JSON literal. We use the typed-translation helper to get the
  // array out and fall back to month index if anything goes sideways.
  const months = t.raw("months") as string[];

  const [hovered, setHovered] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const data: Row[] = rawData.map((d) => ({
    month: months[d.idx] ?? "",
    revenue: d.revenue,
    ebitda: d.ebitda,
  }));

  const total = data.reduce((acc, d) => acc + d.revenue, 0);
  const last = data[data.length - 1]!;
  const first = data[0]!;
  const yoy = ((last.revenue - first.revenue) / first.revenue) * 100;

  function CustomTooltip({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ value: number; payload: Row }>;
    label?: string;
  }) {
    if (!active || !payload || !payload.length) return null;
    const row = payload[0]!.payload;
    return (
      <div className="glass-strong rounded-xl px-3.5 py-2.5 text-xs">
        <div className="mb-1 text-slate-400" dir="ltr">
          {label} {t("fy")}
        </div>
        <div className="flex items-center gap-2 text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {t("revenue")}:{" "}
          <span className="text-slate-100 font-semibold" dir="ltr">
            ${row.revenue}k
          </span>
        </div>
        <div className="flex items-center gap-2 text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          {t("ebitda")}:{" "}
          <span className="text-slate-100 font-semibold" dir="ltr">
            ${row.ebitda}k
          </span>
        </div>
      </div>
    );
  }

  return (
    <section
      ref={ref}
      id="dashboard"
      className="relative mx-auto w-full max-w-7xl px-6 py-32"
    >
      <motion.div
        style={{ y: parallax }}
        className="mb-12 flex flex-col items-start gap-3 md:flex-row md:items-end md:justify-between"
      >
        <div className="max-w-xl">
          <span className="text-xs uppercase tracking-[0.22em] text-emerald-400">
            {t("eyebrow")}
          </span>
          <h2 className="mt-3 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-50 sm:text-5xl md:text-6xl">
            {t("title1")} <span className="text-gradient">{t("titleAccent")}</span>
          </h2>
          <p className="mt-4 text-slate-400">{t("desc")}</p>
        </div>
        <a
          href="/sign-up"
          className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-slate-200 hover:text-white transition-colors"
        >
          {t("cta")} <ArrowUpRight size={15} />
        </a>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 60 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="glass-strong relative overflow-hidden rounded-3xl p-6 sm:p-8"
      >
        <div className="pointer-events-none absolute -end-20 -top-24 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Kpi
            icon={TrendingUp}
            label={t("kpiArr")}
            value={`$${((last.revenue * 12) / 1000).toFixed(1)}M`}
            delta="+18.4%"
          />
          <Kpi icon={Activity} label={t("kpiGm")} value="74.2%" delta="+3.1 pts" />
          <Kpi
            icon={PieChart}
            label={t("kpiEbitda")}
            value={`$${data.reduce((a, d) => a + d.ebitda, 0)}k`}
            delta="+62%"
          />
          <Kpi
            icon={TrendingUp}
            label={t("kpiYoy")}
            value={`${yoy.toFixed(0)}%`}
            delta={t("kpiYoyDelta")}
            subtle
          />
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-white/5 bg-slate-950/50 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-200">{t("barTitle")}</h3>
              <span className="text-xs text-slate-500" dir="ltr">
                {t("fy")} · ${(total / 1000).toFixed(2)}M
              </span>
            </div>
            <div className="h-72" dir="ltr">
              {mounted && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data}
                    onMouseMove={(s) =>
                      setHovered(
                        typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : null
                      )
                    }
                    onMouseLeave={() => setHovered(null)}
                    margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id={barFillId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.55} />
                      </linearGradient>
                      <linearGradient id={barFillDimId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.18} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 4" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tickLine={false}
                      axisLine={false}
                      stroke="#64748b"
                      fontSize={11}
                    />
                    <YAxis tickLine={false} axisLine={false} stroke="#64748b" fontSize={11} />
                    <Tooltip
                      cursor={{ fill: "rgba(16,185,129,0.06)" }}
                      content={<CustomTooltip />}
                    />
                    <Bar dataKey="revenue" radius={[6, 6, 2, 2]} animationDuration={1100}>
                      {data.map((_, i) => (
                        <Cell
                          key={i}
                          fill={
                            hovered === null || hovered === i
                              ? `url(#${barFillId})`
                              : `url(#${barFillDimId})`
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-white/5 bg-slate-950/50 p-4 sm:p-5">
              <h3 className="mb-2 text-sm font-medium text-slate-200">{t("areaTitle")}</h3>
              <div className="h-44" dir="ltr">
                {mounted && (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={data}
                      margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id={areaFillId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.55} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="ebitda"
                        stroke="#34d399"
                        strokeWidth={2}
                        fill={`url(#${areaFillId})`}
                        animationDuration={1300}
                      />
                      <XAxis dataKey="month" hide />
                      <YAxis hide />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-slate-950/50 p-5">
              <h3 className="mb-3 text-sm font-medium text-slate-200">{t("cashTitle")}</h3>
              <ul className="space-y-3">
                {[
                  { label: t("cashOperating"), pct: 64, value: "$2.1M" },
                  { label: t("cashReserve"), pct: 22, value: "$720k" },
                  { label: t("cashInvestment"), pct: 14, value: "$460k" },
                ].map((r) => (
                  <li key={r.label} className="text-xs">
                    <div className="mb-1 flex justify-between text-slate-400">
                      <span>{r.label}</span>
                      <span className="text-slate-200" dir="ltr">
                        {r.value}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${r.pct}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  delta,
  subtle,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  delta: string;
  subtle?: boolean;
}) {
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
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-2xl font-semibold tracking-tight text-slate-50" dir="ltr">
          {value}
        </span>
        <span className={`text-xs font-medium ${subtle ? "text-slate-400" : "text-emerald-300"}`}>
          {delta}
        </span>
      </div>
    </motion.div>
  );
}
